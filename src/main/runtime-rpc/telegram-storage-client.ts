import { RuntimeRpcClient } from './client'
import { RuntimeRpcError, type RuntimeJson } from '../../shared/runtime-rpc'
import {
  telegramStorageDescriptionSchema,
  telegramStorageInspectionSchema,
  telegramCacheOptionsSchema,
  telegramCacheReferenceSchema,
  telegramExpectedMediaSchema,
  telegramCacheResultSchema,
  type TelegramCacheOptions,
  type TelegramCacheReference,
  type TelegramExpectedMedia
} from '../../shared/telegram-storage-protocol'
import { z } from 'zod'

const requiredMethods = ['storage.inspect']
const sessionSchema = z.object({ session: z.string().uuid() }).strict()
// Omit validated optional fields; generic transport never silently accepts undefined values.
const dto = (value: unknown): RuntimeJson => JSON.parse(JSON.stringify(value)) as RuntimeJson

export class TelegramStorageClient {
  private ready?: Promise<void>
  private methods = new Set<string>()
  constructor(private readonly rpc: Pick<RuntimeRpcClient, 'call' | 'close'>) {}
  private handshake(): Promise<void> {
    this.ready ??= this.rpc.call('runtime.describe', {}).then((value) => {
      const parsed = telegramStorageDescriptionSchema.safeParse(value)
      if (
        !parsed.success ||
        requiredMethods.some((method) => !parsed.data.methods.includes(method))
      )
        throw new RuntimeRpcError('INCOMPATIBLE_RUNTIME')
      this.methods = new Set(parsed.data.methods)
    })
    return this.ready
  }
  async inspect(root: string): Promise<z.infer<typeof telegramStorageInspectionSchema>> {
    await this.handshake()
    const value = await this.rpc.call('storage.inspect', { root })
    const result = telegramStorageInspectionSchema.safeParse(value)
    if (!result.success) throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
    return result.data
  }
  async openCache(options: TelegramCacheOptions): Promise<TelegramCacheSession> {
    const params = telegramCacheOptionsSchema.parse(options)
    await this.handshake()
    if (['cache.open', 'cache.resolve', 'cache.close'].some((method) => !this.methods.has(method)))
      throw new RuntimeRpcError('CAPABILITY_UNAVAILABLE')
    const result = sessionSchema.safeParse(await this.rpc.call('cache.open', dto(params)))
    if (!result.success) throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
    return new TelegramCacheSession(this.rpc, result.data.session)
  }
  close(): Promise<void> {
    return this.rpc.close()
  }
}

export class TelegramCacheSession {
  private disposed = false
  private closing?: Promise<void>
  constructor(
    private readonly rpc: Pick<RuntimeRpcClient, 'call' | 'close'>,
    private readonly session: string
  ) {}
  async resolve(
    refs: readonly TelegramCacheReference[],
    media: TelegramExpectedMedia
  ): Promise<Exclude<z.infer<typeof telegramCacheResultSchema>, null> | undefined> {
    if (this.disposed) throw new RuntimeRpcError('SESSION_CLOSED')
    const params = dto({
      session: this.session,
      refs: z.array(telegramCacheReferenceSchema).max(128).parse(refs),
      media: telegramExpectedMediaSchema.parse(media)
    })
    const result = telegramCacheResultSchema.safeParse(await this.rpc.call('cache.resolve', params))
    if (!result.success) throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
    return result.data ?? undefined
  }
  dispose(): Promise<void> {
    this.disposed = true
    this.closing ??= this.rpc.call('cache.close', { session: this.session }).then((value) => {
      if (value !== null) throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
    })
    return this.closing
  }
}
