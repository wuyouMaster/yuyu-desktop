import { Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import type { RuntimeRpcClientOptions } from './client'
import {
  encodeRuntimeRpcFrame,
  RuntimeRpcFrameReader,
  RuntimeRpcError,
  RUNTIME_RPC_MAX_FRAME_BYTES,
  type RuntimeJson,
  type RuntimeRpcRequest
} from '../../shared/runtime-rpc'

interface Task {
  request: RuntimeRpcRequest
  buffer: SharedArrayBuffer
  deadline: number
  sideEffect: boolean
}
interface AsyncTask {
  task: Task
  resolve(value: RuntimeJson): void
  reject(error: Error): void
  cleanup(): void
}
type CallOptions = { timeoutMs?: number; signal?: AbortSignal; sideEffect?: boolean }

/** One worker owns ONE persistent native process for both sync and async ports.
 * Sync compatibility blocks only the calling thread; the worker continues draining
 * native I/O and preserves handles/session ownership. Never respawn after failure.
 */
export class RuntimeRpcBridgeClient {
  private readonly worker: Worker
  private readonly pending = new Map<string, AsyncTask>()
  private closed = false
  private failure?: string
  private stopping?: Promise<void>
  private exited = false
  private readonly shutdownGraceMs: number
  private cleanupFailure?: string
  private usedSideEffects = false
  private cleanupReported = false
  constructor(workerPath: string, options: RuntimeRpcClientOptions) {
    this.shutdownGraceMs = options.shutdownGraceMs ?? 1000
    if (
      !Number.isInteger(this.shutdownGraceMs) ||
      this.shutdownGraceMs < 100 ||
      this.shutdownGraceMs > 10000
    )
      throw new RuntimeRpcError('INVALID_ARGUMENT')
    this.worker = new Worker(workerPath, { workerData: options })
    this.worker.on('message', (message: { id?: string; type?: string; code?: string }) => {
      if (message.type === 'closed') this.cleanupReported = true
      if (message.type === 'closed' && message.code)
        this.cleanupFailure = 'RUNTIME_CLEANUP_UNCONFIRMED'
      const pending = this.pending.get(message.id ?? '')
      if (!pending) return
      this.pending.delete(pending.task.request.id)
      pending.cleanup()
      try {
        pending.resolve(this.read(pending.task))
      } catch (error) {
        pending.reject(error as Error)
      }
    })
    this.worker.on('error', () => this.fail('BRIDGE_FAILED'))
    this.worker.on('exit', () => {
      this.exited = true
      if (this.usedSideEffects && !this.cleanupReported)
        this.cleanupFailure = 'RUNTIME_CLEANUP_UNCONFIRMED'
      this.fail('BRIDGE_EXITED')
    })
  }
  private fail(code: string): void {
    this.failure ??= code
    for (const entry of this.pending.values()) {
      entry.cleanup()
      Atomics.store(new Int32Array(entry.task.buffer, 0, 2), 0, 2)
      entry.reject(new RuntimeRpcError(code, entry.task.sideEffect))
    }
    this.pending.clear()
  }
  private prepare(method: string, params: RuntimeJson, options: CallOptions): Task {
    if (this.closed) throw new RuntimeRpcError('RUNTIME_CLOSED')
    if (this.failure) throw new RuntimeRpcError(this.failure)
    if (options.signal?.aborted) throw new RuntimeRpcError('CANCELLED')
    if (this.pending.size >= 16) throw new RuntimeRpcError('TOO_MANY_REQUESTS')
    const timeout = options.timeoutMs ?? 30_000
    if (!Number.isSafeInteger(timeout) || timeout <= 0)
      throw new RuntimeRpcError('INVALID_DEADLINE')
    const request: RuntimeRpcRequest = {
      protocol: 1,
      type: 'request',
      id: randomUUID(),
      method,
      params
    }
    encodeRuntimeRpcFrame(request)
    this.usedSideEffects ||= !!options.sideEffect
    return {
      request,
      buffer: new SharedArrayBuffer(8 + RUNTIME_RPC_MAX_FRAME_BYTES + 1),
      deadline: Date.now() + timeout,
      sideEffect: !!options.sideEffect
    }
  }
  private read(task: Task): RuntimeJson {
    const control = new Int32Array(task.buffer, 0, 2)
    const size = Atomics.load(control, 1)
    if (Atomics.load(control, 0) !== 1 || size < 1 || size > RUNTIME_RPC_MAX_FRAME_BYTES + 1)
      throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE', task.sideEffect)
    const reader = new RuntimeRpcFrameReader()
    const replies = reader.push(Buffer.from(new Uint8Array(task.buffer, 8, size)))
    reader.end()
    const reply = replies[0]
    if (
      replies.length !== 1 ||
      reply.id !== task.request.id ||
      (reply.type !== 'result' && reply.type !== 'error')
    )
      throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE', task.sideEffect)
    if (reply.type === 'error') throw new RuntimeRpcError(reply.code, reply.resultUnknown)
    return reply.value
  }
  private cancel(task: Task): void {
    Atomics.store(new Int32Array(task.buffer, 0, 2), 0, 2)
    this.worker.postMessage({ type: 'cancel', id: task.request.id })
  }
  call(method: string, params: RuntimeJson, options: CallOptions = {}): RuntimeJson {
    const task = this.prepare(method, params, options)
    this.worker.postMessage({ type: 'call', ...task })
    const control = new Int32Array(task.buffer, 0, 2)
    while (Atomics.load(control, 0) === 0) {
      const remaining = task.deadline - Date.now()
      if (remaining <= 0 || Atomics.wait(control, 0, 0, remaining) === 'timed-out') {
        this.cancel(task)
        throw new RuntimeRpcError('DEADLINE_EXCEEDED', task.sideEffect)
      }
    }
    return this.read(task)
  }
  callAsync(method: string, params: RuntimeJson, options: CallOptions = {}): Promise<RuntimeJson> {
    let task: Task
    try {
      task = this.prepare(method, params, options)
    } catch (error) {
      return Promise.reject(error)
    }
    return new Promise((resolve, reject) => {
      const cancel = (code: string): void => {
        const entry = this.pending.get(task.request.id)
        if (!entry) return
        this.pending.delete(task.request.id)
        entry.cleanup()
        this.cancel(task)
        reject(new RuntimeRpcError(code, task.sideEffect))
      }
      const abort = (): void => cancel('CANCELLED')
      const timer = setTimeout(
        () => cancel('DEADLINE_EXCEEDED'),
        Math.max(1, task.deadline - Date.now())
      )
      this.pending.set(task.request.id, {
        task,
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer)
          options.signal?.removeEventListener('abort', abort)
        }
      })
      options.signal?.addEventListener('abort', abort, { once: true })
      this.worker.postMessage({ type: 'call', ...task })
    })
  }
  close(): Promise<void> {
    if (this.stopping) return this.stopping
    this.closed = true
    this.fail('RUNTIME_CLOSED')
    if (this.exited) {
      this.stopping = this.cleanupFailure
        ? Promise.reject(new RuntimeRpcError(this.cleanupFailure, true))
        : Promise.resolve()
      return this.stopping
    }
    this.stopping = new Promise((resolve, reject) => {
      const kill = setTimeout(() => {
        this.cleanupFailure = 'RUNTIME_CLEANUP_UNCONFIRMED'
        void this.worker.terminate()
      }, this.shutdownGraceMs + 1000)
      this.worker.once('exit', () => {
        clearTimeout(kill)
        if (this.cleanupFailure) reject(new RuntimeRpcError(this.cleanupFailure, true))
        else resolve()
      })
      this.worker.postMessage({ type: 'close' })
    })
    return this.stopping
  }
}
