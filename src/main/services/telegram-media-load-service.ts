import type { Asset } from '../../shared/domain-entities'
import type { TelegramExportDocument, TelegramRuntimeMedia } from '../../shared/telegram-export'
import { TelegramMediaCacheError } from './telegram-storage-runtime'

/** A preview is useful, but does not prove that the attachment has finished loading. */
export function isCompleteTelegramAsset(asset: Asset): boolean {
  const details = asset.extensions?.telegram
  return Boolean(
    asset.state === 'available' &&
    asset.uri &&
    !(details && typeof details === 'object' && 'previewOnly' in details && details.previewOnly)
  )
}

function mediaIdentity(media: TelegramRuntimeMedia): string {
  // Compare all verified references, independent of their enumeration order.
  // A changed attachment must be requested again, never resolved from the old document.
  return JSON.stringify([
    media.kind,
    media.id,
    media.sizeBytes,
    media.width,
    media.height,
    media.durationMs,
    media.dataCenterId,
    media.cacheRefs
      .map((ref) => [ref.role, ref.keyHigh, ref.keyLow, ref.sizeBytes, ref.width, ref.height])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  ])
}

function pause(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, 1000)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

/** Wait for verified local bytes after navigation; never guess a client download control. */
export class TelegramMediaLoadService {
  constructor(
    private readonly options: {
      pause?: (signal: AbortSignal) => Promise<void>
      now?: () => number
      attempts?: number
      timeoutMs?: number
    } = {}
  ) {}

  async wait(input: {
    connected: TelegramExportDocument
    located: TelegramExportDocument
    peerId: string
    messageId: string
    media: TelegramRuntimeMedia
    signal: AbortSignal
    assertCurrent: () => void
    read: () => Promise<TelegramExportDocument>
    resolve: (document: TelegramExportDocument) => Promise<Asset>
    download?: (document: TelegramExportDocument) => Promise<void>
  }): Promise<Asset> {
    const now = this.options.now ?? Date.now
    const deadline = now() + (this.options.timeoutMs ?? 20000)
    // One shared allowance for additional cache rounds and runtime re-samples,
    // including retries of the final identity check. Never reset it per read.
    let retriesLeft = (this.options.attempts ?? 8) - 1
    const expectedMedia = mediaIdentity(input.media)
    const assertCurrent = (): void => {
      input.signal.throwIfAborted()
      input.assertCurrent()
    }
    const validate = (document: TelegramExportDocument): void => {
      assertCurrent()
      if (
        document.origin !== 'runtime' ||
        document.accountKey !== input.connected.accountKey ||
        document.accountNativeId !== input.connected.accountNativeId ||
        !input.connected.runtime ||
        document.runtime?.pid !== input.connected.runtime.pid ||
        document.runtime?.activeSelfId !== input.connected.accountNativeId ||
        document.runtime?.activePeerId !== input.peerId
      )
        throw new Error('Telegram 进程、账号或当前会话已变化，已停止加载附件')
      const chat = document.conversations.find((value) => value.id === input.peerId)
      const message = chat?.messages.find((value) => value.id === input.messageId)
      if (
        !chat?.runtimeHistory?.blockMessageIds?.includes(input.messageId) ||
        !message?.runtimeMedia ||
        mediaIdentity(message.runtimeMedia) !== expectedMedia
      )
        throw new Error('Telegram 附件已变化或消息不在当前加载范围，请刷新消息后重试')
    }
    const canRetry = (): boolean => retriesLeft > 0 && now() < deadline
    const pauseForRetry = async (): Promise<void> => {
      --retriesLeft
      await (this.options.pause ?? pause)(input.signal)
      assertCurrent()
    }
    const read = async (): Promise<TelegramExportDocument> => {
      for (;;) {
        assertCurrent()
        let fresh: TelegramExportDocument
        try {
          fresh = await input.read()
        } catch (error) {
          assertCurrent()
          if (
            typeof error !== 'object' ||
            error === null ||
            !('code' in error) ||
            error.code !== 'layout_or_snapshot_changed' ||
            !canRetry()
          )
            throw error
          await pauseForRetry()
          if (now() >= deadline) throw error
          continue
        }
        // Keep validation outside the catch: only native snapshot races retry,
        // never cancellation, context/identity changes or other consumer errors.
        validate(fresh)
        return fresh
      }
    }
    let document = input.located
    let preview: Asset | undefined
    let downloadRequested = false
    for (;;) {
      validate(document)
      let asset: Asset
      try {
        asset = await input.resolve(document)
      } catch (error) {
        assertCurrent()
        // Telegram may be writing the binlog while downloading. Re-sample only
        // this explicit race; corruption, size mismatch and unsafe paths fail.
        if (!(error instanceof TelegramMediaCacheError) || error.code !== 'changed' || !canRetry())
          throw error
        await pauseForRetry()
        document = await read()
        if (now() >= deadline) throw error
        continue
      }
      assertCurrent()
      // Keep a verified preview while waiting for its original; do not replace
      // it with a transient cache miss during Telegram's binlog update.
      if (asset.state === 'available' && asset.uri) preview = asset
      const complete = isCompleteTelegramAsset(asset)
      if (
        !complete &&
        !downloadRequested &&
        input.download &&
        input.media.cacheRefs.some((ref) => ref.role === 'full')
      ) {
        // Identity has been verified above. One request only; later rounds prove
        // complete bytes and revalidate identity, never infer success from submit.
        downloadRequested = true
        await input.download(document)
        assertCurrent()
        document = await read()
        continue
      }
      if (complete || input.media.cacheRefs.length === 0 || !canRetry()) {
        // The cache read is asynchronous. Recheck native identity and the exact
        // message/media before returning bytes, including a preview on timeout.
        // This mandatory read may finish after the budget; extra reads may not start then.
        await read()
        return complete ? asset : (preview ?? asset)
      }
      await pauseForRetry()
      document = await read()
      if (now() >= deadline) return preview ?? asset
    }
  }
}
