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
import { DingtalkStore, type DingtalkStoreRow } from './dingtalk-store'

const SOURCE = 'dingtalk'

const idFor = (account: string, native: string): EntityId =>
  serializeEntityId({ source: SOURCE, account, native })

const accountIdFor = (account: string): EntityId => idFor(account, account)

function text(row: DingtalkStoreRow, index: number, store: DingtalkStore): string {
  return store.decode(row[index] || '')
}

function numberValue(row: DingtalkStoreRow, index: number): number | undefined {
  const value = Number(row[index])
  return Number.isFinite(value) && row[index] !== '' ? value : undefined
}

function boolValue(row: DingtalkStoreRow, index: number): boolean | undefined {
  const value = Number(row[index])
  return value === 0 || value === 1 ? value === 1 : undefined
}

function parseJson(value: string): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function messageNative(cid: string, mid: string): string {
  return JSON.stringify(['message', cid, mid])
}

function parseMessageNative(native: string): { cid: string; mid: string } {
  const value: unknown = JSON.parse(native)
  if (!Array.isArray(value) || value.length !== 3 || value[0] !== 'message') {
    throw new Error('钉钉消息标识无效')
  }
  if (typeof value[1] !== 'string' || typeof value[2] !== 'string') {
    throw new Error('钉钉消息标识无效')
  }
  return { cid: value[1], mid: value[2] }
}

function cursorFor(createdAt: number | undefined, mid: string): string | undefined {
  if (createdAt === undefined) return undefined
  return Buffer.from(JSON.stringify({ createdAt, mid }), 'utf8').toString('base64url')
}

function parseCursor(cursor: string | undefined): { createdAt: number; mid: string } | undefined {
  if (!cursor) return undefined
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      createdAt?: unknown
      mid?: unknown
    }
    if (!Number.isFinite(value.createdAt) || typeof value.mid !== 'string' || !value.mid) {
      throw new Error('钉钉消息分页游标无效')
    }
    return { createdAt: value.createdAt as number, mid: value.mid }
  } catch {
    throw new Error('钉钉消息分页游标无效')
  }
}

function mapContent(
  contentType: number | undefined,
  decrypted: boolean,
  contentText: string,
  account: string,
  cid: string,
  mid: string
): MessageContent {
  const raw = parseJson(contentText)
  if (contentType === 1 && decrypted && raw && typeof raw === 'object') {
    const textValue = (raw as { text?: unknown }).text
    if (typeof textValue === 'string') return { type: 'text', text: textValue }
  }
  if (contentType === 2) {
    return {
      type: 'image',
      assetId: idFor(account, 'asset/image/' + JSON.stringify([cid, mid])),
      extensions: { dingtalk: { contentType, decrypted, raw } }
    }
  }
  return {
    type: 'unknown',
    platformType: contentType ?? 'unknown',
    raw: { content: raw ?? contentText, isDecrypt: decrypted, decoded: Boolean(contentText) }
  }
}

export class DingtalkReadProvider implements ReadProvider {
  readonly source = SOURCE
  readonly accountId: EntityId
  readonly contextAware = true as const

  constructor(
    readonly account: string,
    private readonly store: DingtalkStore,
    private readonly displayName?: string
  ) {
    this.accountId = accountIdFor(account)
  }

  get capabilities(): ProviderCapabilities {
    return {
      supportsRecall: false,
      supportsPayment: false,
      canSend: false,
      hasGroupNicknames: true,
      supportsRealtime: false,
      supportsLazyAssets: false
    }
  }

  health(): ProviderHealth {
    return { state: 'ready', available: true, message: '可读取本机钉钉聊天' }
  }

  async listAccounts(): Promise<Page<Account>> {
    return {
      items: [
        {
          kind: 'account',
          id: this.accountId,
          nativeRef: { source: SOURCE, account: this.account, native: this.account },
          source: SOURCE,
          displayName: this.displayName || '钉钉本机账号'
        }
      ]
    }
  }

  async listConversations(query: ConversationQuery = {}): Promise<Page<Conversation>> {
    if (query.accountId && query.accountId !== this.accountId) throw new Error('会话不属于当前钉钉账号')
    const limit = Math.max(1, Math.min(query.limit ?? 100, 500))
    const rows = await this.store.conversations(500)
    const items = rows
      .map((row) => this.mapConversation(row))
      .filter((item) => !query.kind || item.conversationKind === query.kind)
      .slice(0, limit)
    return { items }
  }

  async listParticipants(accountId: EntityId): Promise<Page<Participant>> {
    if (accountId !== this.accountId) throw new Error('联系人不属于当前钉钉账号')
    const rows = await this.store.members(undefined, 500)
    const seen = new Set<string>()
    const items: Participant[] = []
    for (const row of rows) {
      const uid = text(row, 1, this.store)
      if (!uid || seen.has(uid)) continue
      seen.add(uid)
      items.push(this.mapParticipant(row))
    }
    return { items }
  }

  async listMemberships(conversationId: EntityId): Promise<Page<Membership>> {
    const conversation = parseEntityId(conversationId)
    if (conversation.source !== SOURCE || conversation.account !== this.account) {
      throw new Error('成员关系不属于当前钉钉账号')
    }
    const rows = await this.store.members(conversation.native, 500)
    return {
      items: rows.map((row) => {
        const uid = text(row, 1, this.store)
        return {
          kind: 'membership',
          id: idFor(this.account, 'membership/' + JSON.stringify([conversation.native, uid])),
          nativeRef: { source: SOURCE, account: this.account, native: uid },
          conversationId,
          participantId: idFor(this.account, uid),
          nickname: text(row, 3, this.store) || text(row, 4, this.store) || undefined,
          role: this.mapRole(numberValue(row, 2))
        }
      })
    }
  }

  async listMessages(query: MessageQuery): Promise<Page<Message>> {
    const conversation = parseEntityId(query.conversationId)
    if (conversation.source !== SOURCE || conversation.account !== this.account) {
      throw new Error('消息不属于当前钉钉账号')
    }
    const limit = Math.max(1, Math.min(query.limit ?? 100, 500))
    const cursor = parseCursor(query.cursor)
    const items: Message[] = []
    let nativeCursor = cursor
    let exhausted = false
    while (items.length < limit && !exhausted) {
      const rows = await this.store.messages(conversation.native, {
        beforeTime: nativeCursor?.createdAt,
        beforeId: nativeCursor?.mid,
        limit: 500
      })
      if (rows.length === 0) {
        exhausted = true
        break
      }
      let lastRow: DingtalkStoreRow | undefined
      for (const row of rows) {
        lastRow = row
        const message = this.mapMessage(row, conversation.native)
        if (
          (query.startTime === undefined || (message.sentAt ?? 0) >= query.startTime) &&
          (query.endTime === undefined || (message.sentAt ?? 0) <= query.endTime)
        ) {
          items.push(message)
          if (items.length >= limit) break
        }
        if (query.startTime !== undefined && (message.sentAt ?? 0) < query.startTime) {
          exhausted = true
          break
        }
      }
      if (items.length >= limit || exhausted || rows.length < 500 || !lastRow) break
      const createdAt = numberValue(lastRow, 6)
      const mid = text(lastRow, 1, this.store)
      if (createdAt === undefined || !mid) {
        exhausted = true
        break
      }
      nativeCursor = { createdAt, mid }
    }
    const last = items[items.length - 1]
    let nextCursor: string | undefined
    if (last?.sentAt !== undefined) {
      const parsed = parseEntityId(last.id)
      const { mid } = parseMessageNative(parsed.native)
      nextCursor = cursorFor(last.sentAt, mid)
    }
    return { items, ...(nextCursor ? { nextCursor } : {}) }
  }

  async listMessagesAround(query: MessageAroundQuery): Promise<MessagesAroundPage> {
    const conversation = parseEntityId(query.conversationId)
    const anchor = parseEntityId(query.messageId)
    const radiusSeconds = Math.max(1, Math.min(query.radiusSeconds ?? 300, 3600))
    const anchorTime = query.anchorTime
    if (
      conversation.source !== SOURCE ||
      conversation.account !== this.account ||
      anchor.source !== SOURCE ||
      anchor.account !== this.account ||
      anchorTime === undefined
    ) {
      return { items: [], found: false, radiusSeconds, truncated: false }
    }
    const anchorRef = parseMessageNative(anchor.native)
    if (anchorRef.cid !== conversation.native) {
      return { items: [], found: false, radiusSeconds, truncated: false }
    }
    const page = await this.listMessages({
      conversationId: query.conversationId,
      startTime: anchorTime - radiusSeconds * 1000,
      endTime: anchorTime + radiusSeconds * 1000,
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
    if (parsed.source !== SOURCE || parsed.account !== this.account) throw new Error('附件不属于当前钉钉账号')
    return {
      kind: 'asset',
      id: assetId,
      nativeRef: parsed,
      assetKind: parsed.native.startsWith('asset/image/') ? 'image' : 'file',
      state: 'unavailable',
      extensions: { dingtalk: { reason: 'media_resolution_not_implemented' } }
    }
  }

  private mapConversation(row: DingtalkStoreRow): Conversation {
    const cid = text(row, 0, this.store)
    const type = numberValue(row, 1)
    return {
      kind: 'conversation',
      id: idFor(this.account, cid),
      nativeRef: { source: SOURCE, account: this.account, native: cid },
      conversationKind: type === 2 ? 'group' : 'direct',
      accountId: this.accountId,
      title: text(row, 2, this.store) || cid,
      affiliation: { kind: 'unknown' },
      extensions: { dingtalk: { type, lastMid: text(row, 3, this.store), memberCount: numberValue(row, 4) } }
    }
  }

  private mapParticipant(row: DingtalkStoreRow): Participant {
    const uid = text(row, 1, this.store)
    const displayName = text(row, 4, this.store) || text(row, 6, this.store) || uid
    return {
      kind: 'participant',
      id: idFor(this.account, uid),
      nativeRef: { source: SOURCE, account: this.account, native: uid },
      participantKind: boolValue(row, 7) ? 'bot' : 'person',
      displayName,
      aliases: [text(row, 3, this.store), text(row, 5, this.store), text(row, 6, this.store)].filter(Boolean),
      extensions: { dingtalk: { memberRole: numberValue(row, 2), extension: parseJson(text(row, 8, this.store)) } }
    }
  }

  private mapMessage(row: DingtalkStoreRow, cid: string): Message {
    const mid = text(row, 1, this.store)
    const sender = text(row, 7, this.store)
    const contentType = numberValue(row, 4)
    const createdAt = numberValue(row, 6)
    const decrypted = boolValue(row, 11) === true
    return {
      kind: 'message',
      id: idFor(this.account, messageNative(cid, mid)),
      nativeRef: { source: SOURCE, account: this.account, native: messageNative(cid, mid) },
      accountId: this.accountId,
      conversationId: idFor(this.account, cid),
      senderId: sender ? idFor(this.account, sender) : undefined,
      sentAt: createdAt,
      direction: 'unknown',
      content: mapContent(contentType, decrypted, text(row, 5, this.store), this.account, cid, mid),
      recalled: boolValue(row, 10),
      extensions: {
        dingtalk: {
          localId: text(row, 2, this.store),
          primaryKey: numberValue(row, 3),
          messageStatus: numberValue(row, 8),
          readStatus: numberValue(row, 9),
          isDecrypt: decrypted,
          gapFlag: numberValue(row, 12),
          version: numberValue(row, 13),
          contentVersion: numberValue(row, 14),
          sentLocalTime: numberValue(row, 15)
        }
      }
    }
  }

  private mapRole(value: number | undefined): Membership['role'] {
    if (value === 1) return 'owner'
    if (value === 2) return 'admin'
    if (value === 3) return 'member'
    return 'unknown'
  }
}
