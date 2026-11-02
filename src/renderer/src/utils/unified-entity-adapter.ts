import type {
  ConversationQuery,
  MessageAroundQuery,
  MessageQuery
} from '../../../shared/data-source'
import type { ReadContext } from '../../../shared/source-context'
import type {
  Asset as UnifiedAsset,
  Conversation as UnifiedConversation,
  Message as UnifiedMessage
} from '../../../shared/domain-entities'
import { parseEntityId, serializeEntityId, type EntityId } from '../../../shared/entity-id'
import type { Contact, Message, MessagesAroundResult } from '../../../shared/types'

type WechatConversationExtension = {
  conversationMd5?: string
  isOfficialAccount?: boolean
  isFolded?: boolean
  isMuted?: boolean
}

type LegacyMessageFields = Partial<Message>

type WechatMessageExtension = {
  sessionId?: string
  localId?: number
  serverId?: string
  createTime?: number
  contentData?: Message['contentData']
  voiceTranscript?: string
  voiceTranscriptError?: string
  recalledBy?: string
}

const conversationIdsByMd5 = new Map<string, EntityId>()
const unifiedAssetCache = new Map<string, UnifiedAsset>()
const unifiedAssetRequests = new Map<string, Promise<UnifiedAsset | undefined>>()

async function currentReadContext(): Promise<ReadContext | undefined> {
  const snapshotReader = window.api.getUnifiedProviderSnapshot
  if (typeof snapshotReader !== 'function') return undefined
  const snapshot = await snapshotReader()
  if (!snapshot?.context) return undefined
  return { expected: snapshot.context, scope: { kind: 'all' } }
}

function withReadContext<T extends object>(value: T, context: ReadContext | undefined): T {
  return context ? ({ ...value, context } as T) : value
}

function wechatConversationExtension(
  conversation: UnifiedConversation
): WechatConversationExtension {
  const value = conversation.extensions?.wechat
  return value && typeof value === 'object' ? (value as WechatConversationExtension) : {}
}

function asLegacyMessage(value: unknown): LegacyMessageFields {
  return value && typeof value === 'object' ? (value as LegacyMessageFields) : {}
}

function legacyNativeId(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return parseEntityId(value).native
  } catch {
    return value
  }
}

function wechatContent(value: UnifiedMessage['content']): unknown {
  return 'extensions' in value ? value.extensions?.wechat : undefined
}

function wechatMessageExtension(message: UnifiedMessage): WechatMessageExtension {
  const value = message.extensions?.wechat
  return value && typeof value === 'object' ? (value as WechatMessageExtension) : {}
}

function legacyTypeForContent(content: UnifiedMessage['content']): string {
  switch (content.type) {
    case 'audio':
      return '语音'
    case 'image':
      return '图片'
    case 'video':
      return '视频'
    case 'sticker':
      return '表情包'
    case 'file':
      return '文件'
    case 'location':
      return '位置'
    case 'contact':
      return '名片'
    case 'share':
      return '分享消息'
    case 'forward':
      return '合并转发'
    case 'miniProgram':
      return '小程序'
    case 'payment':
      return content.payment.type === 'redPacket' ? '微信红包' : '转账'
    case 'quote':
      return '引用消息'
    case 'call':
      return '通话'
    case 'system':
      return '系统消息'
    case 'unknown':
      return '不支持的消息'
    case 'text':
      return '文字'
  }
}

function fallbackContentData(message: UnifiedMessage): Message['contentData'] {
  const content = message.content
  switch (content.type) {
    case 'audio':
      return {
        type: 'voice',
        duration: content.durationMs === undefined ? undefined : content.durationMs / 1000
      }
    case 'image':
      return { type: 'image' }
    case 'video':
      return {
        type: 'video',
        duration: content.durationMs === undefined ? undefined : content.durationMs / 1000
      }
    case 'sticker':
      return { type: 'sticker' }
    case 'file':
      return { type: 'share', title: content.name || '文件', url: '', typeVal: '6' }
    case 'location':
      return {
        type: 'location',
        poiname: content.label,
        label: content.label,
        lat: content.latitude,
        lng: content.longitude
      }
    case 'contact':
      return { type: 'card', username: '', nickname: content.displayName || '未知' }
    case 'share':
      return {
        type: 'share',
        title: content.title,
        des: content.description,
        url: content.url || '',
        appname: content.appName,
        articles: content.articles?.map((article) => ({
          title: article.title,
          description: article.description,
          url: article.url || '',
          coverUrl: article.coverUrl
        }))
      }
    case 'forward':
      return {
        type: 'forwardBundle',
        title: content.title || '聊天记录',
        description: content.description,
        items: []
      }
    case 'miniProgram':
      return {
        type: 'miniProgram',
        title: content.title,
        description: content.description,
        appName: content.appName
      }
    case 'payment':
      return content.payment.type === 'redPacket'
        ? {
            type: 'redPacket',
            title: content.payment.title || '微信红包',
            description: content.payment.description
          }
        : {
            type: 'share',
            title: content.payment.title || '微信转账',
            des: content.payment.description,
            url: '',
            typeVal: '2000'
          }
    case 'quote':
      return { type: 'quote', content: content.text }
    case 'call':
      return {
        type: 'voip',
        status: content.status || '通话',
        duration: content.durationMs === undefined ? undefined : content.durationMs / 1000
      }
    case 'system':
      return { type: 'system', content: content.text }
    case 'text':
      return undefined
    case 'unknown':
      return { type: 'unknown', raw: String(content.raw), messageType: content.platformType }
  }
}

function contactNative(conversation: UnifiedConversation): string {
  return conversation.nativeRef.native
}

export function mapUnifiedConversation(conversation: UnifiedConversation): Contact {
  const extension = wechatConversationExtension(conversation)
  const native = contactNative(conversation)
  const md5 = extension.conversationMd5 || native
  conversationIdsByMd5.set(md5, conversation.id)
  return {
    m_nsUsrName: native,
    m_nsNickName: conversation.title,
    md5,
    type: conversation.conversationKind === 'group' ? 'group' : 'user',
    isOfficialAccount: conversation.conversationKind === 'channel' || extension.isOfficialAccount,
    avatar: conversation.avatar,
    wxid: native,
    isFolded: extension.isFolded,
    isMuted: extension.isMuted
  }
}

function fallbackContent(message: UnifiedMessage): string {
  switch (message.content.type) {
    case 'text':
    case 'system':
    case 'quote':
      return message.content.text || ''
    case 'share':
    case 'miniProgram':
      return message.content.title
    case 'location':
      return message.content.label || ''
    case 'contact':
      return message.content.displayName || ''
    case 'forward':
      return message.content.title || ''
    case 'payment':
      return message.content.payment.title || ''
    default:
      return ''
  }
}

export function mapUnifiedMessage(message: UnifiedMessage): Message {
  const legacy = asLegacyMessage(message.raw)
  const extension = wechatMessageExtension(message)
  const senderId = legacy.senderId || legacyNativeId(message.senderId)
  const contentData =
    legacy.contentData ||
    extension.contentData ||
    (wechatContent(message.content) as Message['contentData']) ||
    fallbackContentData(message)
  const unifiedAssetId =
    'assetId' in message.content && message.content.assetId ? message.content.assetId : undefined
  const voiceDuration =
    legacy.voiceDuration ??
    (message.content.type === 'audio' && message.content.durationMs !== undefined
      ? message.content.durationMs / 1000
      : contentData?.type === 'voice'
        ? contentData.duration
        : undefined)
  return {
    ...legacy,
    id: message.id,
    from: legacy.from || senderId || '',
    type: legacy.type || legacyTypeForContent(message.content),
    datetime:
      legacy.datetime || (message.sentAt ? new Date(message.sentAt).toLocaleString('zh-CN') : ''),
    content: legacy.content || fallbackContent(message),
    unifiedAssetId,
    isSender: legacy.isSender ?? message.direction === 'outgoing',
    senderId,
    contentData,
    createTime:
      legacy.createTime ??
      extension.createTime ??
      (message.sentAt ? Math.floor(message.sentAt / 1000) : undefined),
    recalled: legacy.recalled ?? message.recalled,
    recalledBy: legacy.recalledBy ?? extension.recalledBy,
    voiceDuration,
    sessionId: legacy.sessionId ?? extension.sessionId,
    localId: legacy.localId ?? extension.localId,
    serverId: legacy.serverId ?? extension.serverId,
    voiceTranscript: legacy.voiceTranscript ?? extension.voiceTranscript,
    voiceTranscriptError: legacy.voiceTranscriptError ?? extension.voiceTranscriptError
  }
}

export async function resolveUnifiedAsset(assetId?: string): Promise<UnifiedAsset | undefined> {
  if (!assetId) return undefined
  const cached = unifiedAssetCache.get(assetId)
  if (cached) return cached
  const pending = unifiedAssetRequests.get(assetId)
  if (pending) return pending

  const request = currentReadContext()
    .then((context) =>
      context
        ? window.api.resolveUnifiedAsset(assetId as EntityId, context)
        : window.api.resolveUnifiedAsset(assetId as EntityId)
    )
    .then((asset) => {
      if (asset.state === 'available' && asset.uri) unifiedAssetCache.set(assetId, asset)
      return asset
    })
    .catch((error) => {
      console.warn('[UnifiedEntities] asset resolve fallback:', error)
      return undefined
    })
    .finally(() => unifiedAssetRequests.delete(assetId))
  unifiedAssetRequests.set(assetId, request)
  return request
}

async function loadConversationIndex(query?: ConversationQuery): Promise<void> {
  const context = await currentReadContext()
  const page = await window.api.listUnifiedConversations(withReadContext(query || {}, context))
  for (const conversation of page.items) mapUnifiedConversation(conversation)
}

export async function listUnifiedContacts(filterKeyword = ''): Promise<Contact[]> {
  conversationIdsByMd5.clear()
  const context = await currentReadContext()
  const page = await window.api.listUnifiedConversations(withReadContext({}, context))
  const contacts = page.items.map(mapUnifiedConversation)
  const keyword = filterKeyword.trim().toLocaleLowerCase()
  if (!keyword) return contacts
  return contacts.filter((contact) =>
    [contact.m_nsNickName, contact.m_nsUsrName, contact.wxid, contact.wechatId, contact.remark]
      .filter(Boolean)
      .some((value) => value?.toLocaleLowerCase().includes(keyword))
  )
}

export async function listContactsForUi(filterKeyword?: string): Promise<Contact[]> {
  try {
    return await listUnifiedContacts(filterKeyword)
  } catch (error) {
    console.warn('[UnifiedEntities] contact read fallback:', error)
    return window.api.getContacts(filterKeyword)
  }
}

export async function listUnifiedMessages(
  contact: Contact,
  startTime?: number,
  endTime?: number,
  options?: { limit?: number }
): Promise<Message[]> {
  let conversationId = conversationIdsByMd5.get(contact.md5)
  if (!conversationId) {
    await loadConversationIndex()
    conversationId = conversationIdsByMd5.get(contact.md5)
  }
  if (!conversationId) throw new Error('统一实体层未找到对应会话')
  const context = await currentReadContext()
  const query = withReadContext<MessageQuery>({
    conversationId,
    startTime,
    endTime,
    limit: options?.limit
  }, context)
  const page = await window.api.listUnifiedMessages(query)
  return page.items.map(mapUnifiedMessage)
}

export async function listMessagesForContact(
  contact: Contact,
  startTime?: number,
  endTime?: number,
  options?: { limit?: number }
): Promise<Message[]> {
  try {
    return await listUnifiedMessages(contact, startTime, endTime, options)
  } catch (error) {
    console.warn('[UnifiedEntities] message read fallback:', error)
    return window.api.getMessages(contact.md5, startTime, endTime, options)
  }
}

function scopedMessageId(conversationId: EntityId, messageId: string): EntityId {
  const conversationRef = parseEntityId(conversationId)
  try {
    const messageRef = parseEntityId(messageId)
    if (
      messageRef.source === conversationRef.source &&
      messageRef.account === conversationRef.account
    ) {
      return messageId as EntityId
    }
  } catch {
    // Legacy evidence ids are scoped below.
  }
  return serializeEntityId({
    source: conversationRef.source,
    account: conversationRef.account,
    native: conversationRef.native + '/' + messageId.replace(/^local:/, '')
  })
}

function legacyMessageId(messageId: string): string {
  const value = String(messageId || '').replace(/^local:/, '')
  try {
    const ref = parseEntityId(messageId)
    const separator = ref.native.lastIndexOf('/')
    return separator >= 0 ? ref.native.slice(separator + 1) : ref.native
  } catch {
    const separator = value.lastIndexOf('/')
    return separator >= 0 ? value.slice(separator + 1) : value
  }
}

export async function getMessagesAroundForContact(
  contact: Contact,
  messageId: string,
  anchorSeconds?: number,
  radiusSeconds?: number
): Promise<MessagesAroundResult> {
  try {
    let conversationId = conversationIdsByMd5.get(contact.md5)
    if (!conversationId) {
      await loadConversationIndex()
      conversationId = conversationIdsByMd5.get(contact.md5)
    }
    if (!conversationId) throw new Error('统一实体层未找到对应会话')

    const context = await currentReadContext()
    const query = withReadContext<MessageAroundQuery>({
      conversationId,
      messageId: scopedMessageId(conversationId, messageId),
      anchorTime: anchorSeconds ? anchorSeconds * 1000 : undefined,
      radiusSeconds
    }, context)
    const page = await window.api.listUnifiedMessagesAround(query)
    return {
      messages: page.items.map(mapUnifiedMessage),
      found: page.found,
      radiusSeconds: page.radiusSeconds,
      truncated: page.truncated
    }
  } catch (error) {
    console.warn('[UnifiedEntities] message around read fallback:', error)
    return window.api.getMessagesAround(
      contact.md5,
      legacyMessageId(messageId),
      anchorSeconds,
      radiusSeconds
    )
  }
}
