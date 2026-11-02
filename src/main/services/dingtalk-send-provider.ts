import type { ProviderCapabilities, ProviderHealth, SendProvider, SendRequest, SendResult } from '../../shared/data-source'
import type { EntityId } from '../../shared/entity-id'
import { parseEntityId, serializeEntityId } from '../../shared/entity-id'
import { DingtalkNativeSendService } from './dingtalk-native-send-service'

const SOURCE = 'dingtalk'

const accountIdFor = (account: string): EntityId =>
  serializeEntityId({ source: SOURCE, account, native: account })

export interface DingtalkSendProviderOptions {
  account: string
  sender: DingtalkNativeSendService
}

export class DingtalkSendProvider implements SendProvider {
  readonly source = SOURCE
  readonly accountId: EntityId
  readonly contextAware = true as const

  constructor(private readonly options: DingtalkSendProviderOptions) {
    this.accountId = accountIdFor(options.account)
  }

  get capabilities(): ProviderCapabilities {
    const status = this.options.sender.currentStatus
    return {
      supportsRecall: false,
      supportsPayment: false,
      canSend: Boolean(status?.state === 'experimental' && status.textEntry),
      hasGroupNicknames: true,
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
    let target
    try {
      target = parseEntityId(request.conversationId)
    } catch {
      return { accepted: false, error: '会话标识无效' }
    }
    if (target.source !== SOURCE || target.account !== this.options.account) {
      return { accepted: false, error: '会话不属于当前钉钉账号' }
    }
    if (!request.content || !['text', 'image', 'audio'].includes(request.content.type)) {
      return { accepted: false, error: '钉钉当前只支持文字、图片和语音发送' }
    }
    if (request.content.type === 'text' && !request.content.text.trim()) {
      return { accepted: false, error: '文字内容不能为空' }
    }
    try {
      return await this.options.sender.send(target.native, request.content)
    } catch {
      return { accepted: false, error: '未能确认发送结果，请先检查目标会话' }
    }
  }
}
