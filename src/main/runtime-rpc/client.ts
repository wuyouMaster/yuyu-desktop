import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  encodeRuntimeRpcFrame,
  RuntimeRpcError,
  RuntimeRpcFrameReader,
  type RuntimeJson,
  type RuntimeRpcResponse
} from '../../shared/runtime-rpc'

export interface RuntimeRpcClientOptions {
  executable: string
  args?: string[]
  env?: NodeJS.ProcessEnv
  maxPending?: number
}
interface Pending {
  resolve(value: RuntimeJson): void
  reject(error: Error): void
  cleanup(): void
  sideEffect: boolean
}

/** One version-pinned child per client. Never retries operations or switches providers. */
export class RuntimeRpcClient {
  private child?: ChildProcessWithoutNullStreams
  private readonly pending = new Map<string, Pending>()
  private closed = false
  private failure?: RuntimeRpcError
  private stopping?: Promise<void>
  constructor(private readonly options: RuntimeRpcClientOptions) {}

  private start(): ChildProcessWithoutNullStreams {
    if (this.closed) throw new RuntimeRpcError('RUNTIME_CLOSED')
    if (this.failure) throw this.failure
    if (this.child) return this.child
    const child = spawn(this.options.executable, this.options.args ?? [], {
      env: this.options.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false
    })
    this.child = child
    const reader = new RuntimeRpcFrameReader()
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        for (const frame of reader.push(chunk)) {
          if (frame.type !== 'result' && frame.type !== 'error')
            throw new RuntimeRpcError('UNEXPECTED_FRAME')
          this.receive(frame)
        }
      } catch {
        this.fail(new RuntimeRpcError('INVALID_RUNTIME_RESPONSE'))
        child.kill()
      }
    })
    // Drain without exposing potentially sensitive diagnostics to UI or logs.
    child.stderr.resume()
    child.stdin.on('error', () => this.fail(new RuntimeRpcError('RUNTIME_TRANSPORT_FAILED')))
    child.on('error', () => this.fail(new RuntimeRpcError('RUNTIME_START_FAILED')))
    child.on('close', () => {
      try {
        reader.end()
      } catch {
        this.fail(new RuntimeRpcError('TRUNCATED_FRAME'))
      }
      this.fail(new RuntimeRpcError('RUNTIME_EXITED'))
    })
    return child
  }

  private receive(frame: RuntimeRpcResponse): void {
    const task = this.pending.get(frame.id)
    // Late results after cancellation do not revive an already failed request.
    if (!task) return
    this.pending.delete(frame.id)
    task.cleanup()
    if (frame.type === 'result') task.resolve(frame.value)
    else task.reject(new RuntimeRpcError(frame.code, frame.resultUnknown))
  }

  private fail(error: RuntimeRpcError): void {
    this.failure ??= error
    for (const task of this.pending.values()) {
      task.cleanup()
      task.reject(new RuntimeRpcError(error.code, task.sideEffect))
    }
    this.pending.clear()
  }

  call(
    method: string,
    params: RuntimeJson,
    options: {
      timeoutMs?: number
      signal?: AbortSignal
      sideEffect?: boolean
    } = {}
  ): Promise<RuntimeJson> {
    const timeoutMs = options.timeoutMs ?? 30_000
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
      return Promise.reject(new RuntimeRpcError('INVALID_DEADLINE'))
    if (options.signal?.aborted) return Promise.reject(new RuntimeRpcError('CANCELLED'))
    if (this.pending.size >= (this.options.maxPending ?? 64))
      return Promise.reject(new RuntimeRpcError('TOO_MANY_REQUESTS'))
    const id = randomUUID()
    let data: string
    let child: ChildProcessWithoutNullStreams
    try {
      data = encodeRuntimeRpcFrame({ protocol: 1, type: 'request', id, method, params })
      child = this.start()
    } catch (error) {
      return Promise.reject(error)
    }
    return new Promise((resolve, reject) => {
      const cancel = (code: string): void => {
        const task = this.pending.get(id)
        if (!task) return
        this.pending.delete(id)
        task.cleanup()
        // Cancellation is best effort, never evidence that a side effect did not happen.
        if (!child.stdin.destroyed)
          child.stdin.write(encodeRuntimeRpcFrame({ protocol: 1, type: 'cancel', id }))
        reject(new RuntimeRpcError(code, !!options.sideEffect))
      }
      const onAbort = (): void => cancel('CANCELLED')
      const timer = setTimeout(() => cancel('DEADLINE_EXCEEDED'), timeoutMs)
      this.pending.set(id, {
        resolve,
        reject,
        sideEffect: !!options.sideEffect,
        cleanup: () => {
          clearTimeout(timer)
          options.signal?.removeEventListener('abort', onAbort)
        }
      })
      options.signal?.addEventListener('abort', onAbort, { once: true })
      child.stdin.write(data)
    })
  }

  close(): Promise<void> {
    if (this.stopping) return this.stopping
    this.closed = true
    this.fail(new RuntimeRpcError('RUNTIME_CLOSED'))
    const child = this.child
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
    this.stopping = new Promise((resolve) => {
      const kill = setTimeout(() => child.kill('SIGKILL'), 1000)
      child.once('close', () => {
        clearTimeout(kill)
        resolve()
      })
      child.stdin.end()
    })
    return this.stopping
  }
}
