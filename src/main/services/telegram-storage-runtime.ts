import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  TelegramStorageClient,
  type TelegramCacheSession
} from '../runtime-rpc/telegram-storage-client'
import {
  createApplicationRuntime,
  applicationCacheDirectory
} from '../runtime-rpc/application-runtimes'
import { RuntimeRpcError } from '../../shared/runtime-rpc'
import type {
  TelegramCacheReference,
  TelegramExpectedMedia
} from '../../shared/telegram-storage-protocol'
export const telegramDataRoot = () =>
  join(homedir(), 'Library/Application Support/Telegram Desktop/tdata')
function client() {
  const rpc = createApplicationRuntime('telegram')
  return new TelegramStorageClient({ call: rpc.callAsync.bind(rpc), close: () => rpc.close() })
}
export async function inspectTelegramStorage(root: string) {
  const runtime = client()
  try {
    return await runtime.inspect(root)
  } finally {
    await runtime.close()
  }
}
export class TelegramMediaCacheError extends Error {
  constructor(readonly code: string) {
    super(`telegram_cache_${code}`)
  }
}
export class TelegramMediaCache {
  private runtime?: TelegramStorageClient
  private session?: Promise<TelegramCacheSession>
  private closed = false
  private closing?: Promise<void>
  constructor(private readonly options: { slot: number; account: string; dataRoot?: string }) {}
  async resolve(refs: TelegramCacheReference[], media: TelegramExpectedMedia) {
    if (this.closed) throw new TelegramMediaCacheError('unavailable')
    this.runtime ??= client()
    this.session ??= this.runtime.openCache({
      ...this.options,
      dataRoot: this.options.dataRoot ?? telegramDataRoot(),
      cacheOutputRoot: applicationCacheDirectory('telegram')
    })
    try {
      return await (await this.session).resolve(refs, media)
    } catch (error) {
      if (error instanceof RuntimeRpcError && error.code.startsWith('telegram_cache_'))
        throw new TelegramMediaCacheError(error.code.slice('telegram_cache_'.length))
      throw error
    }
  }
  dispose(): Promise<void> {
    this.closed = true
    return (this.closing ??= (async () => {
      try {
        await (await this.session)?.dispose()
      } finally {
        await this.runtime?.close()
      }
    })())
  }
}
