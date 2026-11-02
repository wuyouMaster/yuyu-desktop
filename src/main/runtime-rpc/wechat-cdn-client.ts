import { createHash } from 'node:crypto'
import { z } from 'zod'
import { RuntimeRpcError, type RuntimeJson } from '../../shared/runtime-rpc'
import { wechatStorageDescriptionSchema } from '../../shared/wechat-storage-protocol'
import type { DatabaseRpcTransport } from './wechat-database-client'
const maxBytes = 64 * 1024 * 1024
const chunkBytes = 512 * 1024
const methods = ['cdn.open', 'cdn.write', 'cdn.finish', 'cdn.read', 'cdn.close']
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const handle = z.string().regex(/^[a-f0-9]{48}$/)
const result = z
  .object({
    size: z.number().int().positive().max(maxBytes),
    sha256: z.string().regex(/^[a-f0-9]{64}$/)

  })
  .strict()
function check<T>(schema: z.ZodType<T>, value: unknown, code = 'INVALID_RUNTIME_RESPONSE'): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new RuntimeRpcError(code)
  return parsed.data
}
/** Only protocol framing and integrity checking. No cipher implementation or native library binding. */
export class WechatCDNClient {
  private ready?: Promise<void>
  constructor(private readonly rpc: DatabaseRpcTransport) {}
  private capabilities(signal?: AbortSignal) {
    this.ready ??= (async () => {
      const description = check(
        wechatStorageDescriptionSchema,
        await this.rpc.callAsync('runtime.describe', {}, { signal }),
        'INCOMPATIBLE_RUNTIME'
      )
      if (methods.some((method) => !description.methods.includes(method)))
        throw new RuntimeRpcError('CAPABILITY_UNAVAILABLE')
    })().catch((error) => {
      this.ready = undefined
      throw error
    })
    return this.ready
  }
  async decrypt(input: Buffer, key: string, signal?: AbortSignal) {
    if (!Buffer.isBuffer(input) || !input.length || input.length > maxBytes || input.length % 16 || !/^[a-f0-9]{32}$/i.test(key))
      throw new RuntimeRpcError('INVALID_ARGUMENT')
    await this.capabilities(signal)
    const call = (method: string, params: RuntimeJson, cancel = signal) =>
      this.rpc.callAsync(method, params, { signal: cancel, timeoutMs: 35000 })
    const { jobId } = check(
      z.object({ jobId: handle }).strict(),
      await call('cdn.open', {
        key, mode: 'aes-128-cbc-keyiv', stripPadding: true,
        inputBytes: input.length,
        sha256: digest(input)
      })
    )
    let data: Buffer | undefined
    let success = false
    try {
      for (let offset = 0; offset < input.length; offset += chunkBytes)
        check(
          z.literal(true),
          await call('cdn.write', {
            jobId,
            offset,
            data: input.subarray(offset, offset + chunkBytes).toString('base64')
          })
        )
      const info = check(result, await call('cdn.finish', { jobId }))
      data = Buffer.alloc(info.size)
      for (let offset = 0; offset < data.length; ) {
        const length = Math.min(chunkBytes, data.length - offset)
        const chunk = check(
          z
            .object({
              offset: z.literal(offset),
              data: z.string().max(Math.ceil(chunkBytes / 3) * 4),
              eof: z.boolean()
            })
            .strict(),
          await call('cdn.read', { jobId, offset, length })
        )
        const bytes = Buffer.from(chunk.data, 'base64')
        try {
          if (
            bytes.length !== length ||
            bytes.toString('base64') !== chunk.data ||
            chunk.eof !== (offset + length === data.length)
          )
            throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
          bytes.copy(data, offset)
        } finally {
          bytes.fill(0)
        }
        offset += length
      }
      if (digest(data) !== info.sha256) throw new RuntimeRpcError('MEDIA_OUTPUT_INTEGRITY_FAILED')
      if (signal?.aborted) throw new RuntimeRpcError('CANCELLED')
      success = true
      return data
    } finally {
      try {
        // Cleanup must not inherit an already-aborted operation signal.
        check(
          z.literal(true),
          await this.rpc.callAsync('cdn.close', { jobId }, { timeoutMs: 5000 })
        )
      } catch (error) {
        success = false
        throw error
      } finally {
        if (!success) data?.fill(0)
      }
    }
  }
}
