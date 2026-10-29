import type { Readable, Writable } from 'node:stream'
import {
  encodeRuntimeRpcFrame,
  RuntimeRpcError,
  RuntimeRpcFrameReader,
  type RuntimeJson,
  type RuntimeRpcResponse
} from '../../shared/runtime-rpc'

export interface RuntimeRpcMethod {
  sideEffect?: boolean
  run(params: RuntimeJson, signal: AbortSignal): Promise<RuntimeJson> | RuntimeJson
}

/** Portable host transport; application-specific implementation stays in private runtime repos. */
export function serveRuntimeRpc(options: {
  input: Readable
  output: Writable
  methods: Readonly<Record<string, RuntimeRpcMethod>>
  maxPending?: number
  dispose?: () => Promise<void> | void
}): { finished: Promise<void> } {
  const methods = new Map(Object.entries(options.methods))
  const active = new Map<string, { abort: AbortController; work: Promise<void> }>()
  const reader = new RuntimeRpcFrameReader()
  let ended = false
  let finishing: Promise<void> | undefined
  let finish!: () => void
  const finished = new Promise<void>((resolve) => {
    finish = resolve
  })
  const reply = (frame: RuntimeRpcResponse): void => {
    if (!ended && !options.output.destroyed) options.output.write(encodeRuntimeRpcFrame(frame))
  }
  const stop = (): Promise<void> => {
    if (finishing) return finishing
    ended = true
    for (const task of active.values()) task.abort.abort()
    finishing = (async () => {
      await Promise.allSettled([...active.values()].map((task) => task.work))
      await options.dispose?.()
    })().finally(finish)
    // The caller can await finished without an unhandled rejection from cleanup.
    finishing.catch(() => undefined)
    return finishing
  }
  options.output.on('error', () => {
    void stop()
  })
  options.input.on('error', () => {
    void stop()
  })
  options.input.on('end', () => {
    // Any incomplete request is discarded; the caller observes EOF, never success.
    try {
      reader.end()
    } catch {
      /* Protocol ends; no arguments echoed. */
    }
    void stop()
  })
  options.input.on('data', (chunk: Buffer) => {
    if (ended) return
    try {
      for (const frame of reader.push(chunk)) {
        if (frame.type === 'cancel') {
          active.get(frame.id)?.abort.abort()
          continue
        }
        if (frame.type !== 'request' || active.has(frame.id))
          throw new RuntimeRpcError('INVALID_FRAME')
        const method = methods.get(frame.method)
        if (!method || active.size >= (options.maxPending ?? 64)) {
          reply({
            protocol: 1,
            type: 'error',
            id: frame.id,
            code: method ? 'TOO_MANY_REQUESTS' : 'METHOD_UNAVAILABLE',
            resultUnknown: false
          })
          continue
        }
        const abort = new AbortController()
        const work = Promise.resolve()
          .then(async () => {
            if (abort.signal.aborted) throw new RuntimeRpcError('CANCELLED')
            return method.run(frame.params, abort.signal)
          })
          .then((value) => {
            if (abort.signal.aborted) throw new RuntimeRpcError('CANCELLED', !!method.sideEffect)
            reply({ protocol: 1, type: 'result', id: frame.id, value })
          })
          .catch((error: unknown) => {
            reply({
              protocol: 1,
              type: 'error',
              id: frame.id,
              code: error instanceof RuntimeRpcError ? error.code : 'OPERATION_FAILED',
              resultUnknown:
                error instanceof RuntimeRpcError ? error.resultUnknown : !!method.sideEffect
            })
          })
          .finally(() => {
            active.delete(frame.id)
          })
        active.set(frame.id, { abort, work })
      }
    } catch {
      options.input.destroy()
      options.output.destroy()
      void stop()
    }
  })
  return { finished }
}
