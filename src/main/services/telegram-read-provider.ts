import type {
  ConversationQuery,
  MessageAroundQuery,
  MessageQuery,
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
  MessageContent,
  Participant
} from '../../shared/domain-entities'
import { parseEntityId, serializeEntityId, type EntityId } from '../../shared/entity-id'
import type {
  TelegramExportConversation,
  TelegramExportDocument,
  TelegramExportMessage,
  TelegramExportParticipant,
  TelegramRuntimeMedia
} from '../../shared/telegram-export'

const SOURCE = 'telegram'

const idFor = (account: string, native: string): EntityId =>
  serializeEntityId({ source: SOURCE, account, native })

const accountIdFor = (account: string): EntityId => idFor(account, 'account')

function cursorFor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url')
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      offset?: unknown
    }
    if (!Number.isInteger(value.offset) || (value.offset as number) < 0) throw new Error()
    return value.offset as number
  } catch {
    throw new Error('Telegram 分页游标无效')
  }
}

function chatNative(id: string): string {
  return 'chat/' + id
}

function messageNative(chatId: string, messageId: string): string {
  return 'message/' + chatId + '/' + messageId
}

function participantNative(id: string): string {
  return 'user/' + id
}

function mediaKind(message: TelegramExportMessage): Asset['assetKind'] | undefined {
  const value = (message.mediaType || '').toLowerCase()
  if (value === 'animation') return message.mimeType?.startsWith('image/') ? 'image' : 'video'
  if (value.includes('sticker')) return 'sticker'
  if (value.includes('photo') || value.includes('image')) return 'image'
  if (value.includes('video') || value.includes('round')) return 'video'
  if (value.includes('voice') || value.includes('audio')) return 'audio'
  if (value || message.fileName) return 'file'
  return undefined
}

function contentFor(
  message: TelegramExportMessage,
  account: string,
  chatId: string
): MessageContent {
  const runtime = message.extensions?.telegram as
    | { origin?: string; media?: string; caption?: string }
    | undefined
  if (runtime?.origin === 'runtime' && runtime.media) {
    const assetId = idFor(account, 'asset/' + messageNative(chatId, message.id))
    const kind = mediaKind(message)
    if (runtime.media === 'photo' || kind === 'image')
      return { type: 'image', assetId, extensions: { telegram: runtime } }
    if (kind === 'audio' || kind === 'video')
      return {
        type: kind,
        assetId,
        durationMs:
          message.durationSeconds === undefined ? undefined : message.durationSeconds * 1000,
        extensions: { telegram: runtime }
      }
    if (kind === 'sticker') return { type: 'sticker', assetId, extensions: { telegram: runtime } }
    if (runtime.media === 'document')
      return { type: 'file', assetId, name: message.fileName, extensions: { telegram: runtime } }
    return { type: 'unknown', platformType: 'Telegram 未解析媒体', raw: { telegram: runtime } }
  }
  if (message.location) {
    return {
      type: 'location',
      latitude: message.location.latitude,
      longitude: message.location.longitude,
      label: message.location.label,
      extensions: { telegram: message.extensions }
    }
  }
  if (message.type !== 'message' && (message.actionText || message.text || message.action)) {
    return {
      type: 'system',
      text: message.actionText || message.text || message.action || 'Telegram 系统事件',
      extensions: { telegram: message.extensions }
    }
  }
  if (message.text) return { type: 'text', text: message.text }
  const kind = mediaKind(message)
  if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'sticker') {
    const assetId = idFor(account, 'asset/' + messageNative(chatId, message.id))
    if (kind === 'audio') {
      return {
        type: 'audio',
        assetId,
        durationMs:
          message.durationSeconds === undefined ? undefined : message.durationSeconds * 1000,
        extensions: { telegram: message.extensions }
      }
    }
    if (kind === 'video') {
      return {
        type: 'video',
        assetId,
        durationMs:
          message.durationSeconds === undefined ? undefined : message.durationSeconds * 1000,
        extensions: { telegram: message.extensions }
      }
    }
    return { type: kind, assetId, extensions: { telegram: message.extensions } }
  }
  if (kind === 'file') {
    return {
      type: 'file',
      assetId: idFor(account, 'asset/' + messageNative(chatId, message.id)),
      name: message.fileName,
      extensions: { telegram: { ...message.extensions, mimeType: message.mimeType } }
    }
  }
  return {
    type: 'unknown',
    platformType: message.type || 'unknown',
    raw: { telegram: message.extensions }
  }
}

export class TelegramReadProvider implements ReadProvider {
  readonly source = SOURCE
  readonly accountId: EntityId
  private readonly assets = new Map<
    string,
    {
      assetKind: Asset['assetKind']
      name?: string
      mimeType?: string
      durationMs?: number
      media?: TelegramRuntimeMedia
    }
  >()

  constructor(
    private document: TelegramExportDocument,
    private readonly options: {
      resolveMedia?: (media: TelegramRuntimeMedia) => Promise<
        | {
            uri: string
            mimeType: string
            byteLength: number
            thumbnailUri?: string
            previewOnly?: boolean
          }
        | undefined
      >
    } = {}
  ) {
    this.accountId = accountIdFor(document.accountKey)
    this.replaceDocument(document)
  }

  replaceDocument(document: TelegramExportDocument): void {
    if (accountIdFor(document.accountKey) !== this.accountId)
      throw new Error('Telegram 快照不属于当前账号')
    this.document = document
    this.assets.clear()
    for (const conversation of document.conversations) {
      for (const message of conversation.messages) {
        const kind = mediaKind(message)
        if (!kind) continue
        this.assets.set('asset/' + messageNative(conversation.id, message.id), {
          assetKind: kind,
          media: message.runtimeMedia,
          ...(message.fileName ? { name: message.fileName } : {}),
          ...(message.mimeType ? { mimeType: message.mimeType } : {}),
          ...(message.durationSeconds !== undefined
            ? { durationMs: message.durationSeconds * 1000 }
            : {})
        })
      }
    }
  }

  get capabilities(): ProviderCapabilities {
    return {
      supportsRecall: false,
      supportsPayment: false,
      canSend: false,
      hasGroupNicknames: false,
      supportsRealtime: false,
      supportsLazyAssets: Boolean(this.options.resolveMedia)
    }
  }

  health(): ProviderHealth {
    if (this.document.origin === 'runtime') {
      return {
        state: 'degraded',
        available: true,
        capturedAt: this.document.capturedAt,
        message:
          'Telegram 本地快照 · 已采集的会话和消息不是完整历史；可对选定会话或当前账号补载，媒体按需读取本地缓存。读取时间：' +
          new Date(this.document.capturedAt!).toLocaleString('zh-CN')
      }
    }
    return {
      state: 'ready',
      available: true,
      message: '已加载 Telegram Desktop 导出：' + this.document.sourceFileName
    }
  }

  async listAccounts(): Promise<Page<Account>> {
    return {
      items: [
        {
          kind: 'account',
          id: this.accountId,
          nativeRef: { source: SOURCE, account: this.document.accountKey, native: 'account' },
          source: SOURCE,
          displayName: this.document.accountLabel
        }
      ]
    }
  }

  async listConversations(query: ConversationQuery = {}): Promise<Page<Conversation>> {
    if (query.accountId && query.accountId !== this.accountId) {
      throw new Error('会话不属于当前 Telegram 账号')
    }
    const limit = Math.max(1, Math.min(query.limit ?? 100, 500))
    const offset = parseCursor(query.cursor)
    const filtered = this.document.conversations.filter(
      (conversation) => !query.kind || conversation.kind === query.kind
    )
    const items = filtered
      .slice(offset, offset + limit)
      .map((conversation) => this.mapConversation(conversation))
    const nextOffset = offset + items.length
    return {
      items,
      ...(nextOffset < filtered.length ? { nextCursor: cursorFor(nextOffset) } : {})
    }
  }

  async listParticipants(accountId: EntityId): Promise<Page<Participant>> {
    if (accountId !== this.accountId) throw new Error('联系人不属于当前 Telegram 账号')
    const byId = new Map<string, TelegramExportParticipant>()
    for (const conversation of this.document.conversations) {
      for (const participant of conversation.participants) byId.set(participant.id, participant)
    }
    return {
      items: Array.from(byId.values()).map((participant) => this.mapParticipant(participant))
    }
  }

  async listMemberships(conversationId: EntityId): Promise<Page<Membership>> {
    const conversation = this.conversationForId(conversationId)
    if (this.document.origin === 'runtime')
      throw new Error('Telegram 本地快照只包含消息发送者，尚未读取群成员关系。')
    return {
      items: conversation.participants.map((participant) => ({
        kind: 'membership',
        id: idFor(
          this.document.accountKey,
          'membership/' + JSON.stringify([conversation.id, participant.id])
        ),
        nativeRef: {
          source: SOURCE,
          account: this.document.accountKey,
          native: participantNative(participant.id)
        },
        conversationId,
        participantId: idFor(this.document.accountKey, participantNative(participant.id)),
        nickname: participant.displayName,
        role: 'member'
      }))
    }
  }

  async listMessages(query: MessageQuery): Promise<Page<Message>> {
    const conversation = this.conversationForId(query.conversationId)
    const limit = Math.max(1, Math.min(query.limit ?? 100, 500))
    const offset = parseCursor(query.cursor)
    const filtered = conversation.messages
      .slice()
      .sort(
        (left, right) =>
          (left.dateMs || 0) - (right.dateMs || 0) ||
          left.id.localeCompare(right.id, 'en', { numeric: true })
      )
      .filter((message) => {
        if (query.startTime !== undefined && (message.dateMs || 0) < query.startTime) return false
        if (query.endTime !== undefined && (message.dateMs || 0) > query.endTime) return false
        return true
      })
    const items = filtered
      .slice(offset, offset + limit)
      .map((message) => this.mapMessage(conversation, message))
    const nextOffset = offset + items.length
    return {
      items,
      ...(nextOffset < filtered.length ? { nextCursor: cursorFor(nextOffset) } : {})
    }
  }

  async listMessagesAround(query: MessageAroundQuery): Promise<MessagesAroundPage> {
    const radiusSeconds = Math.max(1, Math.min(query.radiusSeconds ?? 300, 3600))
    if (query.anchorTime === undefined) {
      return { items: [], found: false, radiusSeconds, truncated: false }
    }
    const page = await this.listMessages({
      conversationId: query.conversationId,
      startTime: query.anchorTime - radiusSeconds * 1000,
      endTime: query.anchorTime + radiusSeconds * 1000,
      limit: 500
    })
    return {
      items: page.items,
      found: page.items.some((item) => item.id === query.messageId),
      radiusSeconds,
      truncated: Boolean(page.nextCursor)
    }
  }

  async resolveAsset(assetId: EntityId): Promise<Asset> {
    const parsed = parseEntityId(assetId)
    if (parsed.source !== SOURCE || parsed.account !== this.document.accountKey) {
      throw new Error('附件不属于当前 Telegram 账号')
    }
    const metadata = this.assets.get(parsed.native)
    const media =
      metadata?.media && this.options.resolveMedia
        ? await this.options.resolveMedia(metadata.media)
        : undefined
    return {
      kind: 'asset',
      id: assetId,
      nativeRef: parsed,
      assetKind: metadata?.assetKind || 'file',
      state: media ? 'available' : 'unavailable',
      ...(metadata?.name ? { name: metadata.name } : {}),
      ...(metadata?.mimeType ? { mimeType: metadata.mimeType } : {}),
      ...(metadata?.durationMs !== undefined ? { durationMs: metadata.durationMs } : {}),
      ...(media ?? {}),
      extensions: {
        telegram: {
          previewOnly: media?.previewOnly === true,
          reason:
            this.document.origin === 'runtime'
              ? media
                ? 'telegram_runtime_cache'
                : 'telegram_runtime_media_not_cached'
              : 'telegram_export_media_not_copied'
        }
      }
    }
  }

  private conversationForId(id: EntityId): TelegramExportConversation {
    const parsed = parseEntityId(id)
    if (parsed.source !== SOURCE || parsed.account !== this.document.accountKey) {
      throw new Error('会话不属于当前 Telegram 账号')
    }
    const conversationId = parsed.native.startsWith('chat/')
      ? parsed.native.slice('chat/'.length)
      : parsed.native
    const conversation = this.document.conversations.find((item) => item.id === conversationId)
    if (!conversation) throw new Error('Telegram 会话不存在')
    return conversation
  }

  private mapConversation(conversation: TelegramExportConversation): Conversation {
    return {
      kind: 'conversation',
      id: idFor(this.document.accountKey, chatNative(conversation.id)),
      nativeRef: {
        source: SOURCE,
        account: this.document.accountKey,
        native: chatNative(conversation.id)
      },
      conversationKind: conversation.kind,
      accountId: this.accountId,
      title: conversation.title,
      affiliation: { kind: 'unknown' },
      extensions: conversation.extensions
    }
  }

  private mapParticipant(participant: TelegramExportParticipant): Participant {
    return {
      kind: 'participant',
      id: idFor(this.document.accountKey, participantNative(participant.id)),
      nativeRef: {
        source: SOURCE,
        account: this.document.accountKey,
        native: participantNative(participant.id)
      },
      participantKind: participant.kind || 'unknown',
      displayName: participant.displayName,
      aliases: participant.username ? ['@' + participant.username] : undefined
    }
  }

  private mapMessage(
    conversation: TelegramExportConversation,
    message: TelegramExportMessage
  ): Message {
    const id = idFor(this.document.accountKey, messageNative(conversation.id, message.id))
    const senderId = message.senderId
      ? idFor(this.document.accountKey, participantNative(message.senderId))
      : undefined
    const replyToId = message.replyToMessageId
      ? idFor(this.document.accountKey, messageNative(conversation.id, message.replyToMessageId))
      : undefined
    const outgoing = message.outgoing || message.senderId === this.document.accountNativeId
    return {
      kind: 'message',
      id,
      nativeRef: {
        source: SOURCE,
        account: this.document.accountKey,
        native: messageNative(conversation.id, message.id)
      },
      accountId: this.accountId,
      conversationId: idFor(this.document.accountKey, chatNative(conversation.id)),
      senderId,
      sentAt: message.dateMs,
      direction: outgoing ? 'outgoing' : senderId ? 'incoming' : 'unknown',
      content: contentFor(message, this.document.accountKey, conversation.id),
      replyToId,
      extensions: {
        telegram: {
          ...(message.extensions?.telegram && typeof message.extensions.telegram === 'object'
            ? (message.extensions.telegram as Record<string, unknown>)
            : {}),
          ...(message.senderName ? { senderName: message.senderName } : {})
        }
      }
    }
  }
}
