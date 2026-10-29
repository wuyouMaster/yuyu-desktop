/** Public stdio protocol. No native handles, executable code or credentials in argv. */
export const RUNTIME_RPC_VERSION = 1 as const
export const RUNTIME_RPC_MAX_FRAME_BYTES = 8 * 1024 * 1024
export type RuntimeJson =
  | null
  | boolean
  | number
  | string
  | RuntimeJson[]
  | { [key: string]: RuntimeJson }
export type RuntimeRpcRequest = {
  protocol: 1
  type: 'request'
  id: string
  method: string
  params: RuntimeJson
}
export type RuntimeRpcCancel = { protocol: 1; type: 'cancel'; id: string }
export type RuntimeRpcResponse =
  | { protocol: 1; type: 'result'; id: string; value: RuntimeJson }
  | { protocol: 1; type: 'error'; id: string; code: string; resultUnknown: boolean }
export type RuntimeRpcFrame = RuntimeRpcRequest | RuntimeRpcCancel | RuntimeRpcResponse

export class RuntimeRpcError extends Error {
  constructor(
    readonly code: string,
    readonly resultUnknown = false
  ) {
    // Error text is a protocol code; never include arguments, keys, paths or child stderr.
    super(code)
    this.name = 'RuntimeRpcError'
  }
}

function isJson(value: unknown, depth = 0): value is RuntimeJson {
  if (depth > 64) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((item) => isJson(item, depth + 1))
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    return false
  return Object.values(value).every((item) => isJson(item, depth + 1))
}

export function assertRuntimeJson(value: unknown): asserts value is RuntimeJson {
  if (!isJson(value)) throw new RuntimeRpcError('INVALID_VALUE')
}

export function parseRuntimeRpcFrame(line: string): RuntimeRpcFrame {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    throw new RuntimeRpcError('INVALID_FRAME')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RuntimeRpcError('INVALID_FRAME')
  const frame = value as Record<string, unknown>
  if (
    frame.protocol !== RUNTIME_RPC_VERSION ||
    typeof frame.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(frame.id)
  )
    throw new RuntimeRpcError('INVALID_FRAME')
  const keys = Object.keys(frame).sort().join(',')
  if (frame.type === 'cancel' && keys === 'id,protocol,type') return frame as RuntimeRpcCancel
  if (
    frame.type === 'request' &&
    keys === 'id,method,params,protocol,type' &&
    typeof frame.method === 'string' &&
    /^[a-z][a-zA-Z0-9_.]{0,95}$/.test(frame.method) &&
    isJson(frame.params)
  ) {
    return frame as RuntimeRpcRequest
  }
  if (frame.type === 'result' && keys === 'id,protocol,type,value' && isJson(frame.value)) {
    return frame as RuntimeRpcResponse
  }
  if (
    frame.type === 'error' &&
    keys === 'code,id,protocol,resultUnknown,type' &&
    typeof frame.code === 'string' &&
    /^[A-Z][A-Z0-9_]{0,63}$/.test(frame.code) &&
    typeof frame.resultUnknown === 'boolean'
  )
    return frame as RuntimeRpcResponse
  throw new RuntimeRpcError('INVALID_FRAME')
}

/** Incremental UTF-8 framing, including split multibyte characters and bounded partial lines. */
export class RuntimeRpcFrameReader {
  private pending = Buffer.alloc(0)
  push(chunk: Buffer): RuntimeRpcFrame[] {
    const frames: RuntimeRpcFrame[] = []
    let start = 0
    for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, start)) {
      if (this.pending.length + end - start > RUNTIME_RPC_MAX_FRAME_BYTES)
        throw new RuntimeRpcError('FRAME_TOO_LARGE')
      const line = Buffer.concat([this.pending, chunk.subarray(start, end)])
      const text = new TextDecoder('utf-8', { fatal: true }).decode(line)
      frames.push(parseRuntimeRpcFrame(text))
      this.pending = Buffer.alloc(0)
      start = end + 1
    }
    if (this.pending.length + chunk.length - start > RUNTIME_RPC_MAX_FRAME_BYTES)
      throw new RuntimeRpcError('FRAME_TOO_LARGE')
    this.pending = Buffer.concat([this.pending, chunk.subarray(start)])
    return frames
  }
  end(): void {
    if (this.pending.length) throw new RuntimeRpcError('TRUNCATED_FRAME')
  }
}

export function encodeRuntimeRpcFrame(frame: RuntimeRpcFrame): string {
  // Outbound validation rejects non-finite numbers and accidental undefined/function values.
  if (frame.type === 'request') assertRuntimeJson(frame.params)
  if (frame.type === 'result') assertRuntimeJson(frame.value)
  const text = JSON.stringify(frame)
  parseRuntimeRpcFrame(text)
  if (Buffer.byteLength(text) > RUNTIME_RPC_MAX_FRAME_BYTES)
    throw new RuntimeRpcError('FRAME_TOO_LARGE')
  return text + '\n'
}
