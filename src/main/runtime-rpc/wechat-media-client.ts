import { z } from 'zod'
import { RuntimeRpcError, type RuntimeJson } from '../../shared/runtime-rpc'
import { wechatStorageDescriptionSchema } from '../../shared/wechat-storage-protocol'
import type { DatabaseRpcTransport } from './wechat-database-client'

const maxBytes = 4 * 1024 * 1024
const encoded = z
  .string()
  .max(Math.ceil(maxBytes / 3) * 4)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
const resultSchema = z
  .object({
    data: encoded,
    mime: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp', 'image/wxgf']),
    md5: z.string().regex(/^[a-f0-9]{32}$/),
    diagnostic: z.enum(['SUCCESS', 'DIRECT_IMAGE', 'WXGF_REQUIRES_DECODER']),
    requiresDecoder: z.boolean()
  })
  .strict()
  .refine(
    (v) =>
      v.requiresDecoder === (v.mime === 'image/wxgf') &&
      v.requiresDecoder === (v.diagnostic === 'WXGF_REQUIRES_DECODER')
  )
const optionsSchema = z
  .object({
    aesKey: z
      .string()
      .max(64)
      .regex(/^[\x00-\x7f]*$/)
      .default(''),
    xorKey: z.number().int().min(0).max(255).default(0),
    expectedMd5: z
      .string()
      .regex(/^(?:[a-f0-9]{32})?$/i)
      .default('')
  })
  .strict()
function check<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new RuntimeRpcError(code)
  return parsed.data
}

/** Bounded byte-only media operations; no cipher implementation in the app. */
export class WechatMediaClient {
  private methods?: Set<string>
  constructor(private readonly rpc: DatabaseRpcTransport) {}
  private require(method: string): void {
    if (!this.methods)
      this.methods = new Set(
        check(
          wechatStorageDescriptionSchema,
          this.rpc.call('runtime.describe', {}),
          'INCOMPATIBLE_RUNTIME'
        ).methods
      )
    if (!this.methods.has(method)) throw new RuntimeRpcError('CAPABILITY_UNAVAILABLE')
  }
  private data(input: Uint8Array): string {
    if (!input.byteLength || input.byteLength > maxBytes)
      throw new RuntimeRpcError('MEDIA_SIZE_LIMIT')
    return Buffer.from(input).toString('base64')
  }
  decode(input: Uint8Array, options: z.input<typeof optionsSchema> = {}) {
    const data = this.data(input)
    const parsed = check(optionsSchema, options, 'INVALID_ARGUMENT')
    this.require('media.decode')
    return this.result(this.rpc.call('media.decode', { data, options: parsed }))
  }
  async decodeAsync(
    input: Uint8Array,
    options: z.input<typeof optionsSchema> = {},
    signal?: AbortSignal
  ) {
    const data = this.data(input)
    const parsed = check(optionsSchema, options, 'INVALID_ARGUMENT')
    this.require('media.decode')
    return this.result(
      await this.rpc.callAsync('media.decode', { data, options: parsed }, { signal })
    )
  }
  private result(value: RuntimeJson) {
    const parsed = check(resultSchema, value, 'INVALID_RUNTIME_RESPONSE')
    const data = Buffer.from(parsed.data, 'base64')
    if (data.length > maxBytes || data.toString('base64') !== parsed.data)
      throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
    return { ...parsed, data }
  }
  decryptCDN(
    input: Uint8Array,
    key: string,
    mode: 'aes-128-cbc-keyiv' | 'aes-128-ecb' = 'aes-128-cbc-keyiv',
    stripPadding = true
  ): Buffer {
    const data = this.data(input)
    if (
      !/^[a-f0-9]{32}$/i.test(key) ||
      !['aes-128-cbc-keyiv', 'aes-128-ecb'].includes(mode) ||
      input.length % 16
    )
      throw new RuntimeRpcError('INVALID_ARGUMENT')
    this.require('media.decryptCDN')
    const result = check(
      encoded,
      this.rpc.call('media.decryptCDN', { data, key, mode, stripPadding }),
      'INVALID_RUNTIME_RESPONSE'
    )
    const decoded = Buffer.from(result, 'base64')
    if (decoded.length > maxBytes || decoded.toString('base64') !== result)
      throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
    return decoded
  }
}
