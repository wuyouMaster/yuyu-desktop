import { parentPort, workerData } from 'node:worker_threads'
import { RuntimeRpcClient, type RuntimeRpcClientOptions } from './client'
import {
  encodeRuntimeRpcFrame,
  RuntimeRpcError,
  type RuntimeRpcRequest
} from '../../shared/runtime-rpc'

if (!parentPort) throw new Error('WORKER_REQUIRED')
const port = parentPort
const client = new RuntimeRpcClient(workerData as RuntimeRpcClientOptions)
const active = new Map<string, AbortController>()
let closing = false

port.on(
  'message',
  async (message: {
    type: 'call' | 'cancel' | 'close'
    request: RuntimeRpcRequest
    buffer: SharedArrayBuffer
    deadline: number
    sideEffect?: boolean
    id?: string
  }) => {
    if (message.type === 'close') {
      closing = true
      for (const controller of active.values()) controller.abort()
      await client.close()
      port.close()
      return
    }
    if (message.type === 'cancel') {
      active.get(message.id ?? '')?.abort()
      return
    }
    if (message.type !== 'call') return
    const { request, buffer } = message
    const control = new Int32Array(buffer, 0, 2)
    const payload = new Uint8Array(buffer, 8)
    const controller = new AbortController()
    active.set(request.id, controller)
    let encoded: string
    try {
      if (closing) throw new RuntimeRpcError('RUNTIME_CLOSED')
      const remaining = Math.floor(message.deadline - Date.now())
      if (remaining <= 0) throw new RuntimeRpcError('DEADLINE_EXCEEDED')
      const value = await client.call(request.method, request.params, {
        timeoutMs: remaining,
        signal: controller.signal,
        sideEffect: message.sideEffect
      })
      encoded = encodeRuntimeRpcFrame({ protocol: 1, type: 'result', id: request.id, value })
    } catch (error) {
      const failure =
        error instanceof RuntimeRpcError
          ? error
          : new RuntimeRpcError('BRIDGE_FAILED', !!message.sideEffect)
      encoded = encodeRuntimeRpcFrame({
        protocol: 1,
        type: 'error',
        id: request.id,
        code: failure.code,
        resultUnknown: failure.resultUnknown
      })
    } finally {
      active.delete(request.id)
    }
    // The parent may have timed out. Never reuse a request buffer for a later call.
    if (Atomics.load(control, 0) !== 0) return
    const bytes = Buffer.from(encoded)
    payload.set(bytes)
    Atomics.store(control, 1, bytes.length)
    Atomics.store(control, 0, 1)
    Atomics.notify(control, 0)
    port.postMessage({ id: request.id })
  }
)
