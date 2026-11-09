import { z } from 'zod'
import type {
  ConversationQuery,
  MessageQuery,
  MessageAroundQuery,
  MessagesAroundPage,
  Page,
  ProviderCapabilities,
  ProviderHealth,
  ReadProvider
} from '../../shared/data-source'
import type {
  Account,
  Asset,
  Conversation,
  Membership,
  Message,
  Participant
} from '../../shared/domain-entities'
import { parseEntityId, serializeEntityId, type EntityId } from '../../shared/entity-id'
import {
  telegramMacOSSourceSchema,
  telegramMacOSKeySchema,
  telegramMacOSPeerSchema,
  type TelegramMacOSSource,
  type TelegramMacOSMessage
} from '../../shared/telegram-macos-protocol'
import type { TelegramMacOSClient } from '../runtime-rpc/telegram-macos-client'

const cursorSchema = z
  .object({
    candidateId: z.string(),
    kind: z.enum(['conversations', 'messages']),
    peerId: telegramMacOSPeerSchema.optional(),
    value: z.string()
  })
  .strict()

function pageLimit(value: number | undefined, maximum: number): number {
  if (value === undefined) return Math.min(50, maximum)
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('分页数量无效')
  return Math.min(value, maximum)
}

export class TelegramMacOSReadProvider implements ReadProvider {
  readonly source = 'telegram'
  readonly accountId: EntityId
  readonly accountLabel = 'Telegram macOS 本地快照'
  private closed = false
  private closing?: Promise<void>
  private readonly options: TelegramMacOSSource

  constructor(
    options: TelegramMacOSSource,
    private readonly client: Pick<TelegramMacOSClient, 'conversations' | 'messages' | 'close'>
  ) {
    this.options = telegramMacOSSourceSchema.parse(options)
    this.accountId = this.id(this.options.candidateId)
  }

  readonly capabilities: ProviderCapabilities = {
    supportsRecall: false,
    supportsPayment: false,
    canSend: false,
    hasGroupNicknames: false,
    supportsRealtime: false,
    supportsLazyAssets: false
  }

  health(): ProviderHealth {
    return this.closed
      ? { state: 'offline', available: false, message: '本地快照已断开。' }
      : {
          state: 'degraded',
          available: true,
          message:
            '仅按需读取 Telegram macOS 本地快照；会话名称、成员目录、媒体文件及发送暂不支持。会话按本地标识分页。'
        }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Telegram macOS 数据源已切换或断开，请重新连接。')
  }

  private ref(native: string) {
    return { source: this.source, account: this.options.candidateId, native }
  }

  private id(native: string): EntityId {
    return serializeEntityId(this.ref(native))
  }

  private native(id: EntityId): string {
    this.assertOpen()
    const ref = parseEntityId(id)
    if (ref.source !== this.source || ref.account !== this.options.candidateId)
      throw new Error('数据不属于当前 Telegram macOS 账号')
    return ref.native
  }

  private peer(conversationId: EntityId): string {
    const native = this.native(conversationId)
    if (!native.startsWith('peer/')) throw new Error('Telegram macOS 会话标识无效')
    return telegramMacOSPeerSchema.parse(native.slice(5))
  }

  private cursor(
    kind: 'conversations' | 'messages',
    value: string | undefined,
    peerId?: string
  ): string | undefined {
    if (value === undefined) return undefined
    return Buffer.from(
      JSON.stringify({ candidateId: this.options.candidateId, kind, value, peerId })
    ).toString('base64url')
  }

  private before(
    cursor: string | undefined,
    kind: 'conversations' | 'messages',
    peerId?: string
  ): string | undefined {
    if (cursor === undefined) return undefined
    try {
      if (!cursor || cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error()
      const parsed = cursorSchema.parse(
        JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
      )
      if (
        parsed.candidateId !== this.options.candidateId ||
        parsed.kind !== kind ||
        parsed.peerId !== peerId
      )
        throw new Error()
      return (kind === 'messages' ? telegramMacOSKeySchema : telegramMacOSPeerSchema).parse(
        parsed.value
      )
    } catch {
      throw new Error('Telegram macOS 分页游标不属于当前账号或会话')
    }
  }

  async listAccounts(): Promise<Page<Account>> {
    this.assertOpen()
    return {
      items: [
        {
          kind: 'account',
          id: this.accountId,
          nativeRef: this.ref(this.options.candidateId),
          source: this.source,
          displayName: this.accountLabel
        }
      ]
    }
  }

  async listConversations(query: ConversationQuery = {}): Promise<Page<Conversation>> {
    this.assertOpen()
    if (query.accountId && query.accountId !== this.accountId) throw new Error('会话不属于当前账号')
    if (query.kind && query.kind !== 'unknown')
      throw new Error('Telegram macOS 暂不支持会话类型筛选')
    const page = await this.client.conversations({
      ...this.options,
      limit: pageLimit(query.limit, 200),
      beforePeer: this.before(query.cursor, 'conversations')
    })
    this.assertOpen()
    return {
      items: page.items.map((item) => ({
        kind: 'conversation',
        id: this.id('peer/' + item.peerId),
        nativeRef: this.ref('peer/' + item.peerId),
        conversationKind: 'unknown',
        accountId: this.accountId,
        title: `会话 ${item.peerId}`,
        affiliation: { kind: 'unknown' },
        extensions: { telegramMacOS: { scope: page.scope, lastTimestamp: item.lastTimestamp } }
      })),
      nextCursor: this.cursor('conversations', page.nextPeer)
    }
  }

  private message(item: TelegramMacOSMessage): Message {
    const native = JSON.stringify(['message', item.peerId, item.key])
    const media = { mediaCount: item.mediaCount, media: item.media ?? [], available: false }
    return {
      kind: 'message',
      id: this.id(native),
      nativeRef: this.ref(native),
      accountId: this.accountId,
      conversationId: this.id('peer/' + item.peerId),
      senderId: item.authorId ? this.id('author/' + item.authorId) : undefined,
      sentAt: item.timestamp * 1000,
      direction: 'unknown',
      content:
        item.text || !item.mediaCount
          ? { type: 'text', text: item.text }
          : { type: 'unknown', platformType: 'telegram-macos-media', raw: media },
      extensions: {
        telegramMacOS: {
          scope: 'local-snapshot',
          ...media,
          mediaAvailable: false,
          namespace: item.namespace,
          messageId: item.id
        }
      }
    }
  }

  async listMessages(query: MessageQuery): Promise<Page<Message>> {
    const peerId = this.peer(query.conversationId)
    for (const value of [query.startTime, query.endTime])
      if (value !== undefined && !Number.isFinite(value)) throw new Error('消息时间范围无效')
    if (
      query.startTime !== undefined &&
      query.endTime !== undefined &&
      query.startTime > query.endTime
    )
      throw new Error('消息时间范围无效')
    const page = await this.client.messages({
      ...this.options,
      peerId,
      limit: pageLimit(query.limit, 50),
      beforeKey: this.before(query.cursor, 'messages', peerId)
    })
    this.assertOpen()
    // Key pagination is not a wall-clock ordering guarantee. Preserve the cursor
    // even when every row in this page falls outside a requested time window.
    const items = page.items
      .map((item) => this.message(item))
      .filter(
        (item) =>
          (query.startTime === undefined || item.sentAt! >= query.startTime) &&
          (query.endTime === undefined || item.sentAt! <= query.endTime)
      )
    return { items, nextCursor: this.cursor('messages', page.nextKey, peerId) }
  }

  async listParticipants(accountId: EntityId): Promise<Page<Participant>> {
    this.native(accountId)
    throw new Error('Telegram macOS 暂不支持联系人目录读取')
  }
  async listMemberships(conversationId: EntityId): Promise<Page<Membership>> {
    this.peer(conversationId)
    throw new Error('Telegram macOS 暂不支持会话成员目录读取')
  }
  async listMessagesAround(query: MessageAroundQuery): Promise<MessagesAroundPage> {
    this.peer(query.conversationId)
    throw new Error('Telegram macOS 暂不支持按消息定位上下文，请使用分页读取')
  }
  async resolveAsset(assetId: EntityId): Promise<Asset> {
    this.native(assetId)
    throw new Error('Telegram macOS 当前仅支持媒体元数据，暂不能读取媒体文件')
  }

  dispose(): Promise<void> {
    this.closed = true
    return (this.closing ??= this.client.close())
  }
}
