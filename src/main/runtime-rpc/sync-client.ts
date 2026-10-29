import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  encodeRuntimeRpcFrame,
  RuntimeRpcError,
  RuntimeRpcFrameReader,
  RUNTIME_RPC_MAX_FRAME_BYTES,
  type RuntimeJson
} from '../../shared/runtime-rpc'

/** Stateless, read-only compatibility for existing synchronous ports.
 * Stateful database/cache connections must use the persistent client instead.
 * The executable is selected by the verified runtime store, never renderer input.
 */
export class RuntimeRpcSyncClient {
  constructor(
    private readonly executable: string,
    private readonly options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}
  ) {
    if (
      options.timeoutMs !== undefined &&
      (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)
    )
      throw new RuntimeRpcError('INVALID_ARGUMENT')
  }

  call(method: string, params: RuntimeJson): RuntimeJson {
    const id = randomUUID()
    const input = encodeRuntimeRpcFrame({ protocol: 1, type: 'request', id, method, params })
    const result = spawnSync(this.executable, ['--once'], {
      input,
      timeout: this.options.timeoutMs ?? 30_000,
      maxBuffer: RUNTIME_RPC_MAX_FRAME_BYTES + 1,
      windowsHide: true,
      env: this.options.env,
      stdio: ['pipe', 'pipe', 'ignore']
    })
    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code
      throw new RuntimeRpcError(code === 'ETIMEDOUT' ? 'TIMEOUT' : 'TRANSPORT_FAILED')
    }
    if (result.status !== 0 || result.signal) throw new RuntimeRpcError('RUNTIME_EXITED')
    const reader = new RuntimeRpcFrameReader()
    let frames
    try {
      frames = reader.push(result.stdout)
      reader.end()
    } catch {
      throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
    }
    const reply = frames[0]
    if (
      frames.length !== 1 ||
      reply.id !== id ||
      (reply.type !== 'result' && reply.type !== 'error')
    )
      throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
    if (reply.type === 'error') throw new RuntimeRpcError(reply.code, reply.resultUnknown)
    return reply.value
  }
}
