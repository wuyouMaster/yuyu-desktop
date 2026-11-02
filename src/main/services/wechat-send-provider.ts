import type {
  ProviderCapabilities,
  ProviderHealth,
  SendProvider,
  SendRequest,
  SendResult
} from '../../shared/data-source'
import type {
  PersonalWechatSendRequest,
  PersonalWechatSendResult,
  PersonalWechatSenderStatus
} from '../../shared/personal-wechat'
import { parseEntityId, serializeEntityId, type EntityId } from '../../shared/entity-id'

const SOURCE = 'wechat'

export interface PersonalWechatSenderLike {
  getStatus(): Promise<PersonalWechatSenderStatus>
  send(request: PersonalWechatSendRequest): Promise<PersonalWechatSendResult>
}

export interface WechatSendProviderOptions {
  account: string
  sender: PersonalWechatSenderLike
}

const accountIdFor = (account: string): EntityId =>
  serializeEntityId({ source: SOURCE, account, native: account })

const unavailableHealth = (): ProviderHealth => ({
  state: 'degraded',
  available: false,
  message: '微信发送能力尚未检查'
})

function capabilitiesFor(status: PersonalWechatSenderStatus | undefined): ProviderCapabilities {
  return {
    supportsRecall: false,
    supportsPayment: false,
    canSend: Boolean(status?.canSendText),
    hasGroupNicknames: false,
    supportsRealtime: false,
    supportsLazyAssets: false
  }
}

function healthFor(status: PersonalWechatSenderStatus | undefined): ProviderHealth {
  if (!status) return unavailableHealth()
  if (status.canSendText) {
    return { state: 'ready', available: true, message: status.message }
  }
  return {
    state: status.state === 'error' ? 'offline' : 'degraded',
    available: false,
    message: status.error || status.message
  }
}

/**
 * The unified write boundary intentionally accepts opaque conversation ids.
 * Only this adapter translates them back to a WeChat-native target wxid.
 */
export class WechatSendProvider implements SendProvider {
  readonly source = SOURCE
  readonly accountId: EntityId
  private status: PersonalWechatSenderStatus | undefined
  private failure: string | undefined

  constructor(private readonly options: WechatSendProviderOptions) {
    this.accountId = accountIdFor(options.account)
  }

  get capabilities(): ProviderCapabilities {
    return capabilitiesFor(this.status)
  }

  health(): ProviderHealth {
    return this.failure
      ? { state: 'offline', available: false, message: this.failure }
      : healthFor(this.status)
  }

  async refresh(): Promise<void> {
    try {
      this.status = await this.options.sender.getStatus()
      this.failure = undefined
    } catch (error) {
      this.status = undefined
      this.failure = error instanceof Error ? error.message : '微信发送状态检测失败'
    }
  }

  async send(request: SendRequest): Promise<SendResult> {
    if (!request || typeof request.conversationId !== 'string') {
      return { accepted: false, error: '会话标识无效' }
    }
    let target
    try {
      target = parseEntityId(request.conversationId)
    } catch (error) {
      return {
        accepted: false,
        error: error instanceof Error ? error.message : '会话标识无效'
      }
    }
    if (target.source !== SOURCE || target.account !== this.options.account) {
      return { accepted: false, error: '会话不属于当前微信账号' }
    }

    if (request.content?.type !== 'text') {
      return { accepted: false, error: '当前统一发送入口只支持文字消息' }
    }
    if (typeof request.content.text !== 'string' || !request.content.text.trim()) {
      return { accepted: false, error: '文字内容不能为空' }
    }
    const text = request.content.text.trim()

    try {
      const result = await this.options.sender.send({
        type: 'text',
        to: target.native,
        isGroup: target.native.endsWith('@chatroom'),
        text
      })
      this.status = result.status
      this.failure = undefined
      return {
        accepted: result.success,
        ...(!result.success
          ? { error: result.error || result.status.message || '微信发送失败' }
          : {})
      }
    } catch (error) {
      this.status = undefined
      this.failure = error instanceof Error ? error.message : '微信发送调用异常'
      // The backend may already have submitted the message. Never retry here.
      return { accepted: false, error: '未能确认发送结果，请先检查目标会话。' + this.failure }
    }
  }
}
