import type {
  ProviderCapabilities,
  ProviderHealth,
  SendProvider,
  SendRequest,
  SendResult
} from '../../shared/data-source'
import type { EntityId } from '../../shared/entity-id'
import { parseEntityId, serializeEntityId } from '../../shared/entity-id'
import type { TelegramExportDocument } from '../../shared/telegram-export'
import {
  TelegramDesktopSendService,
  type TelegramDesktopTarget
} from './telegram-desktop-send-service'

const SOURCE = 'telegram'

const accountIdFor = (account: string): EntityId =>
  serializeEntityId({ source: SOURCE, account, native: 'account' })

export interface TelegramSendProviderOptions {
  account: string
  document: TelegramExportDocument
  sender: TelegramDesktopSendService
}

export class TelegramSendProvider implements SendProvider {
  readonly source = SOURCE
  readonly accountId: EntityId

  constructor(private readonly options: TelegramSendProviderOptions) {
    this.accountId = accountIdFor(options.account)
  }

  get capabilities(): ProviderCapabilities {
    const status = this.options.sender.currentStatus
    return {
      supportsRecall: false,
      supportsPayment: false,
      canSend: status?.state === 'ready' && status.textEntry === true,
      hasGroupNicknames: false,
      supportsRealtime: false,
      supportsLazyAssets: false
    }
  }

  health(): ProviderHealth {
    return this.options.sender.health()
  }

  async refresh(): Promise<void> {
    await this.options.sender.refresh()
  }

  async send(request: SendRequest): Promise<SendResult> {
    let targetId
    try {
      targetId = parseEntityId(request.conversationId)
    } catch {
      return { accepted: false, error: '会话标识无效' }
    }
    if (targetId.source !== SOURCE || targetId.account !== this.options.account) {
      return { accepted: false, error: '会话不属于当前 Telegram 账号' }
    }
    if (request.content.type !== 'text') {
      return { accepted: false, error: 'Telegram 当前只支持文字发送' }
    }
    const text = request.content.text.trim()
    if (!text) return { accepted: false, error: '文字内容不能为空' }
    const conversationId = targetId.native.startsWith('chat/')
      ? targetId.native.slice('chat/'.length)
      : targetId.native
    const conversation = this.options.document.conversations.find(
      (item) => item.id === conversationId
    )
    if (!conversation) return { accepted: false, error: 'Telegram 会话不存在' }
    if (conversation.kind === 'channel') {
      return { accepted: false, error: 'Telegram 频道不支持从这里发送消息' }
    }
    const extensions = conversation.extensions?.telegram
    const telegram =
      extensions && typeof extensions === 'object' ? (extensions as Record<string, unknown>) : {}
    const username = typeof telegram.username === 'string' ? telegram.username : undefined
    const target: TelegramDesktopTarget = {
      nativeId: conversation.id,
      title: conversation.title,
      kind: conversation.kind,
      ...(username ? { username } : {})
    }
    try {
      return await this.options.sender.send(target, text)
    } catch {
      return { accepted: false, error: '未能确认发送结果，请检查 Telegram 目标会话' }
    }
  }
}
