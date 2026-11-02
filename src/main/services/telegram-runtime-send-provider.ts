import type {
  ProviderCapabilities,
  ProviderHealth,
  SendProvider,
  SendRequest,
  SendResult
} from '../../shared/data-source'
import { parseEntityId, serializeEntityId, type EntityId } from '../../shared/entity-id'
import type { TelegramRuntimeSendService } from './telegram-runtime-send-service'

export interface TelegramRuntimeSendProviderOptions {
  account: string
  sender: Pick<TelegramRuntimeSendService, 'account' | 'health' | 'refresh' | 'send'> &
    Partial<
      Pick<
        TelegramRuntimeSendService,
        'sendImage' | 'sendFile' | 'sendSticker' | 'sendAlbum' | 'sendVoice'
      >
    >
}

/** Independent from export providers; the service re-reads runtime identity and
 * the target on every send. A cached document cannot authorize native dispatch.
 */
export class TelegramRuntimeSendProvider implements SendProvider {
  readonly source = 'telegram'
  readonly accountId: EntityId

  constructor(private readonly options: TelegramRuntimeSendProviderOptions) {
    this.accountId = serializeEntityId({
      source: this.source,
      account: options.account,
      native: 'account'
    })
  }

  get capabilities(): ProviderCapabilities {
    return {
      supportsRecall: false,
      supportsPayment: false,
      canSend: this.health().available,
      hasGroupNicknames: false,
      supportsRealtime: false,
      supportsLazyAssets: false
    }
  }

  health(): ProviderHealth {
    if (
      this.options.sender.account !== this.options.account ||
      !/^telegram-local:[a-f0-9]{24}$/.test(this.options.account)
    )
      return { state: 'degraded', available: false, message: 'Telegram runtime 发送账号不匹配' }
    return this.options.sender.health()
  }

  async refresh(): Promise<void> {
    if (this.options.sender.account === this.options.account) await this.options.sender.refresh()
  }

  async send(request: SendRequest): Promise<SendResult> {
    let target
    try {
      target = parseEntityId(request.conversationId)
    } catch {
      return { accepted: false, error: '会话标识无效' }
    }
    if (
      target.source !== this.source ||
      target.account !== this.options.account ||
      this.options.sender.account !== this.options.account ||
      !/^telegram-local:[a-f0-9]{24}$/.test(this.options.account)
    )
      return { accepted: false, error: '会话不属于当前 Telegram runtime 账号' }
    if (!['text', 'image', 'file', 'sticker', 'audio'].includes(request.content.type))
      return {
        accepted: false,
        error: 'Telegram runtime 支持文字及收藏夹图片、文件、语音、贴纸和相册发送'
      }
    if (!/^chat\/[1-9][0-9]{0,19}$/.test(target.native))
      return { accepted: false, error: 'Telegram runtime 会话标识无效' }
    const peerId = target.native.slice('chat/'.length)
    try {
      const content = request.content
      const caption =
        content.type === 'image' || content.type === 'file'
          ? ((content.extensions?.telegram as { caption?: string } | undefined)?.caption ?? '')
          : ''
      const result =
        content.type === 'text'
          ? await this.options.sender.send(peerId, content.text)
          : content.type === 'audio' && content.localPath && this.options.sender.sendVoice
            ? await this.options.sender.sendVoice(peerId, content.localPath)
            : content.type === 'image' && content.localPaths && this.options.sender.sendAlbum
              ? await this.options.sender.sendAlbum(peerId, content.localPaths, caption)
              : content.type === 'image' && content.localPath && this.options.sender.sendImage
                ? await this.options.sender.sendImage(peerId, content.localPath, caption)
                : content.type === 'sticker' && content.localPath && this.options.sender.sendSticker
                  ? await this.options.sender.sendSticker(peerId, content.localPath)
                  : content.type === 'file' && content.localPath && this.options.sender.sendFile
                    ? await this.options.sender.sendFile(peerId, content.localPath, caption)
                    : { accepted: false, error: '请选择支持的本地附件' }
      if (!result.accepted) return { accepted: false, error: result.error }
      if (
        !result.nativeMessageId ||
        !/^[1-9][0-9]{0,9}$/.test(result.nativeMessageId) ||
        BigInt(result.nativeMessageId) >= 1n << 31n
      )
        return { accepted: false, error: 'Telegram runtime 消息结果缺少有效的确认 ID' }
      return {
        accepted: true,
        messageId: serializeEntityId({
          source: this.source,
          account: this.options.account,
          native: 'message/' + peerId + '/' + result.nativeMessageId
        })
      }
    } catch {
      return { accepted: false, error: '未能确认发送结果，请检查 Telegram 目标会话；不会自动重试' }
    }
  }
}
