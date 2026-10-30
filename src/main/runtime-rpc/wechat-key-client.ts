import { z } from 'zod'
import { RuntimeRpcError, type RuntimeJson } from '../../shared/runtime-rpc'
import { wechatStorageDescriptionSchema } from '../../shared/wechat-storage-protocol'
import type { DatabaseRpcTransport } from './wechat-database-client'

/** Give a native helper time to restore the target before the host is terminated.
 * This changes shutdown cleanup only; operation/test deadlines remain unchanged. */
export const KEY_RUNTIME_SHUTDOWN_GRACE_MS = 7000
const identity = z
  .object({
    platform: z.string().min(1),
    arch: z.string().min(1),
    version: z.string().min(1),
    build: z.string().min(1),
    imageSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    imageUuid: z.string().uuid()
  })
  .strict()
const accountResult = z
  .object({
    success: z.literal(true),
    key: z.string().regex(/^[a-f0-9]{64}$/),
    keyKind: z.literal('account'),
    profile: z.string().min(1),
    verified: z.literal(true)
  })
  .strict()
const imageResult = z
  .object({
    success: z.literal(true),
    xorKey: z.number().int().min(0).max(255),
    aesKey: z.string().regex(/^[a-f0-9]{16}$/),
    verified: z.literal(true)
  })
  .strict()
function check<T>(schema: z.ZodType<T>, value: unknown, code = 'INVALID_RUNTIME_RESPONSE'): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new RuntimeRpcError(code)
  return result.data
}
/** Main-process only. No password, key, profile offsets, private derivation or helper path in UI. */
export class WechatKeyClient {
  private methods?: Set<string>
  constructor(private readonly rpc: DatabaseRpcTransport) {}
  private async require(method: string): Promise<void> {
    if (!this.methods)
      this.methods = new Set(
        check(
          wechatStorageDescriptionSchema,
          await this.rpc.callAsync('runtime.describe', {}),
          'INCOMPATIBLE_RUNTIME'
        ).methods
      )
    if (!this.methods.has(method)) throw new RuntimeRpcError('CAPABILITY_UNAVAILABLE')
  }
  async inspect(pid: number) {
    check(z.number().int().min(1).max(0x7fffffff), pid, 'INVALID_ARGUMENT')
    await this.require('key.inspect')
    return check(identity, await this.rpc.callAsync('key.inspect', { pid }))
  }
  async captureDatabase(pid: number, root: string, timeoutMs: number, signal?: AbortSignal) {
    check(z.number().int().min(1).max(0x7fffffff), pid, 'INVALID_ARGUMENT')
    check(z.string().min(1), root, 'INVALID_ARGUMENT')
    check(z.number().int().min(1).max(300000), timeoutMs, 'INVALID_ARGUMENT')
    await this.require('key.captureDatabase')
    return check(
      accountResult,
      await this.rpc.callAsync(
        'key.captureDatabase',
        { pid, root, timeoutMs },
        { timeoutMs: timeoutMs + KEY_RUNTIME_SHUTDOWN_GRACE_MS, signal, sideEffect: true }
      )
    )
  }
  async verifyImage(
    data: Uint8Array,
    code: number,
    account: string,
    expectedMd5: string,
    signal?: AbortSignal
  ) {
    check(z.number().int().min(1).max(0xffffffff), code, 'INVALID_ARGUMENT')
    check(z.string().min(1).max(256), account, 'INVALID_ARGUMENT')
    check(z.string().regex(/^[a-f0-9]{32}$/i), expectedMd5, 'INVALID_ARGUMENT')
    if (!data.byteLength || data.byteLength > 4 * 1024 * 1024)
      throw new RuntimeRpcError('MEDIA_SIZE_LIMIT')
    await this.require('key.verifyImage')
    const input: RuntimeJson = {
      data: Buffer.from(data).toString('base64'),
      code,
      account,
      expectedMd5
    }
    return check(imageResult, await this.rpc.callAsync('key.verifyImage', input, { signal }))
  }
}
