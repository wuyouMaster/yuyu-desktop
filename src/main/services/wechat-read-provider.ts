import {
  getGroupSnapshotAsync,
  isReady,
  listContactsAsync,
  listMessagesAsync,
  type FormattedContact,
  type FormattedMessage
} from './chat-service'
import type {
  ReadProvider,
  ConversationQuery,
  MessageAroundQuery,
  MessageQuery,
  MessagesAroundPage,
  Page,
  ProviderHealth
} from '../../shared/data-source'
import type {
  ForwardedMessageItem,
  ParsedContent,
  RedPacketPaymentInfo,
  TransferPaymentInfo
} from '../../shared/types'
import type {
  Account,
  Asset,
  Conversation,
  ForwardedItem,
  Membership,
  Message,
  MessageContent,
  Participant
} from '../../shared/domain-entities'
import { parseEntityId, serializeEntityId, type EntityId } from '../../shared/entity-id'
import type { WechatAssetHint, WechatAssetProviderResolver } from './wechat-asset-resolver'
import {
  messagesAroundRadii,
  normalizeRadiusSeconds,
  widenRadiusSeconds,
  MESSAGES_AROUND_MAX_WINDOW
} from './messages-around'

const SOURCE = 'wechat'

export interface WechatReadProviderOptions {
  account: string
  displayName?: string
}

const idFor = (account: string, native: string): EntityId =>
  serializeEntityId({ source: SOURCE, account, native })

function assetIdFor(
  account: string | undefined,
  assetKind: Asset['assetKind'],
  native: string | undefined
): EntityId | undefined {
  return account && native ? idFor(account, 'asset/' + assetKind + '/' + native) : undefined
}

function contactNative(contact: FormattedContact): string {
  return contact.m_nsUsrName || contact.wxid || contact.md5
}

function mapContact(account: string, contact: FormattedContact): Participant {
  const native = contactNative(contact)
  return {
    kind: 'participant',
    id: idFor(account, native),
    nativeRef: { source: SOURCE, account, native },
    participantKind: contact.isOfficialAccount ? 'official' : 'person',
    displayName: contact.m_nsNickName || native,
    avatar: contact.avatar,
    aliases: [
      contact.remark,
      contact.wechatNickname,
      contact.alias,
      contact.wechatId,
      contact.wxid
    ].filter((value): value is string => Boolean(value)),
    raw: contact,
    extensions:
      contact.isFolded || contact.isMuted
        ? {
            wechat: { isFolded: contact.isFolded, isMuted: contact.isMuted }
          }
        : undefined
  }
}

function mapConversation(account: string, contact: FormattedContact): Conversation {
  const native = contactNative(contact)
  return {
    kind: 'conversation',
    id: idFor(account, native),
    nativeRef: { source: SOURCE, account, native },
    conversationKind:
      contact.type === 'group' ? 'group' : contact.isOfficialAccount ? 'channel' : 'direct',
    accountId: idFor(account, account),
    title: contact.m_nsNickName || native,
    avatar: contact.avatar,
    raw: contact,
    extensions: {
      wechat: {
        conversationMd5: contact.md5,
        isOfficialAccount: contact.isOfficialAccount,
        isFolded: contact.isFolded,
        isMuted: contact.isMuted
      }
    }
  }
}

function mapForwardedItem(item: ForwardedMessageItem, account?: string): ForwardedItem {
  return {
    senderId: account && item.sender ? idFor(account, item.sender) : undefined,
    text: item.text,
    sentAt: item.sentAt ? Date.parse(item.sentAt) || undefined : undefined,
    nested: item.nested?.map((nested) => mapForwardedItem(nested, account)),
    extensions: { wechat: { messageType: item.messageType } }
  }
}

function mapPaymentInfo(
  payment: TransferPaymentInfo | RedPacketPaymentInfo | undefined
): Record<string, unknown> | undefined {
  return payment ? { ...payment } : undefined
}

export function mapMessageContent(
  content: ParsedContent | undefined,
  fallbackText = '',
  account?: string
): MessageContent {
  if (!content) return { type: 'text', text: fallbackText }
  switch (content.type) {
    case 'text':
      return { type: 'text', text: content.content }
    case 'voice':
      return {
        type: 'audio',
        durationMs: content.duration ? content.duration * 1000 : undefined,
        extensions: { wechat: content }
      }
    case 'image':
      return {
        type: 'image',
        assetId: assetIdFor(account, 'image', content.md5 || content.datName),
        extensions: { wechat: content }
      }
    case 'video':
      return {
        type: 'video',
        assetId: assetIdFor(account, 'video', content.md5 || content.newMd5 || content.rawMd5),
        durationMs: content.duration ? content.duration * 1000 : undefined,
        extensions: { wechat: content }
      }
    case 'sticker':
      return {
        type: 'sticker',
        assetId: assetIdFor(account, 'sticker', content.md5),
        extensions: { wechat: content }
      }
    case 'location':
      return {
        type: 'location',
        latitude: content.lat,
        longitude: content.lng,
        label: content.label || content.poiname,
        extensions: { wechat: content }
      }
    case 'card':
      return {
        type: 'contact',
        displayName: content.nickname,
        participantId: account && content.username ? idFor(account, content.username) : undefined,
        extensions: { wechat: content }
      }
    case 'share':
      if (content.transfer || content.typeVal === '2000') {
        return {
          type: 'payment',
          payment: {
            type: 'transfer',
            title: content.title,
            description: content.des,
            amountText: content.transfer?.amountText,
            status: content.transfer?.transferStatusText || content.transfer?.transferStatus,
            extensions: mapPaymentInfo(content.transfer)
              ? { wechat: mapPaymentInfo(content.transfer) }
              : { wechat: { typeVal: content.typeVal } }
          }
        }
      }
      if (content.typeVal === '6' || content.typeVal === '74') {
        return {
          type: 'file',
          name: content.title,
          extensions: { wechat: content }
        }
      }
      return {
        type: 'share',
        title: content.title,
        description: content.des,
        url: content.url,
        appName: content.appname,
        articles: content.articles,
        extensions: { wechat: content }
      }
    case 'forwardBundle':
      return {
        type: 'forward',
        title: content.title,
        description: content.description,
        items: content.items.map((item) => mapForwardedItem(item, account)),
        extensions: { wechat: { itemCount: content.items.length } }
      }
    case 'miniProgram':
      return {
        type: 'miniProgram',
        title: content.title,
        description: content.description,
        appName: content.appName,
        extensions: { wechat: content }
      }
    case 'redPacket':
      return {
        type: 'payment',
        payment: {
          type: 'redPacket',
          title: content.title,
          description: content.description,
          extensions: mapPaymentInfo(content.pay)
            ? { wechat: mapPaymentInfo(content.pay) }
            : undefined
        }
      }
    case 'voip':
      return {
        type: 'call',
        durationMs: content.duration ? content.duration * 1000 : undefined,
        status: content.status,
        extensions: { wechat: content }
      }
    case 'quote':
      return {
        type: 'quote',
        text: content.quotedContent || content.content,
        extensions: { wechat: content }
      }
    case 'system':
      return { type: 'system', text: content.content, extensions: { wechat: content } }
    case 'unknown':
      return { type: 'unknown', platformType: content.messageType || 'unknown', raw: content.raw }
    default:
      return { type: 'unknown', platformType: 'wechat', raw: content }
  }
}

function mapMessage(
  account: string,
  conversation: FormattedContact,
  message: FormattedMessage
): Message {
  const native = String(message.serverId || message.localId || message.id)
  const conversationNative = contactNative(conversation)
  const messageNative = conversationNative + '/' + native
  const mappedContent = mapMessageContent(message.contentData, message.content, account)
  if (
    (mappedContent.type === 'audio' ||
      mappedContent.type === 'file' ||
      mappedContent.type === 'image' ||
      mappedContent.type === 'video' ||
      mappedContent.type === 'sticker') &&
    !mappedContent.assetId
  ) {
    mappedContent.assetId = assetIdFor(account, mappedContent.type, messageNative)
  }
  return {
    kind: 'message',
    id: idFor(account, messageNative),
    nativeRef: { source: SOURCE, account, native: messageNative },
    accountId: idFor(account, account),
    conversationId: idFor(account, conversationNative),
    senderId: message.senderId ? idFor(account, message.senderId) : undefined,
    sentAt: message.createTime
      ? message.createTime * 1000
      : Date.parse(message.datetime) || undefined,
    direction: message.isSender ? 'outgoing' : 'incoming',
    content: mappedContent,
    recalled: message.recalled,
    raw: message,
    extensions: {
      wechat: {
        type: message.type,
        from: message.from,
        sessionId: message.sessionId,
        localId: message.localId,
        serverId: message.serverId,
        createTime: message.createTime,
        contentData: message.contentData,
        voiceTranscript: message.voiceTranscript,
        voiceTranscriptError: message.voiceTranscriptError,
        recalledBy: message.recalledBy
      }
    }
  }
}

function mapAssetHint(message: FormattedMessage, mapped: Message): WechatAssetHint | undefined {
  const content = mapped.content
  if (!('assetId' in content) || !content.assetId) return undefined

  const base = {
    assetId: content.assetId,
    assetKind: content.type,
    native: parseEntityId(content.assetId).native,
    name: content.type === 'file' ? content.name : undefined,
    durationMs:
      content.type === 'audio' || content.type === 'video' ? content.durationMs : undefined
  } as WechatAssetHint

  switch (content.type) {
    case 'image': {
      const image = message.contentData?.type === 'image' ? message.contentData : undefined
      return {
        ...base,
        image: {
          md5: image?.md5,
          datName: image?.datName,
          sessionId: message.sessionId,
          createTime: message.createTime
        }
      }
    }
    case 'video': {
      const video = message.contentData?.type === 'video' ? message.contentData : undefined
      return {
        ...base,
        video: {
          hashes: [video?.md5, video?.newMd5, video?.rawMd5].filter((value): value is string =>
            Boolean(value)
          ),
          createTime: message.createTime,
          byteLength: video?.byteLength,
          duration: video?.duration,
          width: video?.width,
          height: video?.height
        },
        byteLength: video?.byteLength
      }
    }
    case 'audio':
      return {
        ...base,
        audio: {
          sessionId: message.sessionId,
          localId: message.localId,
          serverId: message.serverId,
          createTime: message.createTime
        }
      }
    case 'sticker': {
      const sticker = message.contentData?.type === 'sticker' ? message.contentData : undefined
      return {
        ...base,
        sticker: {
          url: sticker?.url,
          md5: sticker?.md5,
          thumbUrl: sticker?.thumbUrl,
          encryptUrl: sticker?.encryptUrl,
          aeskey: sticker?.aeskey
        }
      }
    }
    case 'file':
      return {
        ...base,
        file: { name: content.name, createTime: message.createTime }
      }
    default:
      return undefined
  }
}

export class WechatReadProvider implements ReadProvider {
  readonly source = SOURCE
  readonly accountId: EntityId
  readonly capabilities = {
    supportsRecall: true,
    supportsPayment: true,
    canSend: false,
    hasGroupNicknames: true,
    supportsRealtime: false,
    supportsLazyAssets: true
  }

  private readonly account: string
  private readonly displayName?: string
  private assetResolver?: WechatAssetProviderResolver
  private readonly assetHints = new Map<EntityId, WechatAssetHint>()

  constructor(
    options: WechatReadProviderOptions & { assetResolver?: WechatAssetProviderResolver }
  ) {
    this.account = options.account
    this.displayName = options.displayName
    this.assetResolver = options.assetResolver
    this.accountId = idFor(options.account, options.account)
  }

  setAssetResolver(assetResolver: WechatAssetProviderResolver | undefined): void {
    this.assetResolver = assetResolver
  }

  clear(): void {
    this.assetHints.clear()
  }

  health(): ProviderHealth {
    return isReady()
      ? { state: 'ready' as const, available: true }
      : { state: 'offline' as const, available: false, message: 'WeChat database is not ready' }
  }

  async listAccounts(): Promise<Page<Account>> {
    return {
      items: [
        {
          kind: 'account',
          id: this.accountId,
          nativeRef: { source: SOURCE, account: this.account, native: this.account },
          source: SOURCE,
          displayName: this.displayName
        }
      ]
    }
  }

  async listParticipants(accountId: EntityId): Promise<Page<Participant>> {
    this.assertAccount(accountId)
    const contacts = await listContactsAsync()
    return {
      items: contacts
        .filter((contact) => contact.type !== 'group')
        .map((contact) => mapContact(this.account, contact))
    }
  }

  async listConversations(query?: ConversationQuery): Promise<Page<Conversation>> {
    this.assertAccount(query?.accountId)
    const contacts = await listContactsAsync()
    const items = contacts.map((contact) => mapConversation(this.account, contact))
    return {
      items: query?.kind ? items.filter((item) => item.conversationKind === query.kind) : items
    }
  }

  async listMemberships(conversationId: EntityId): Promise<Page<Membership>> {
    const contact = await this.findContact(conversationId)
    if (!contact || contact.type !== 'group') return { items: [] }
    const snapshot = await getGroupSnapshotAsync(contact.md5)
    if (!snapshot) return { items: [] }
    return {
      items: snapshot.members.map((member) => {
        const native = member.wxid
        return {
          kind: 'membership',
          id: idFor(this.account, contactNative(contact) + '/' + native),
          nativeRef: {
            source: SOURCE,
            account: this.account,
            native: contactNative(contact) + '/' + native
          },
          conversationId,
          participantId: idFor(this.account, native),
          nickname: member.groupNickname || member.nickname,
          role: snapshot.roomInfo?.owner && snapshot.roomInfo.owner === native ? 'owner' : 'member',
          raw: member,
          extensions: { wechat: member }
        }
      })
    }
  }

  async listMessages(query: MessageQuery): Promise<Page<Message>> {
    const contact = await this.findContact(query.conversationId)
    if (!contact) return { items: [] }
    const messages = await listMessagesAsync(
      contact.md5,
      query.startTime,
      query.endTime,
      { limit: query.limit },
      '',
      'unknown'
    )
    return { items: messages.map((message) => this.mapMessageRecord(contact, message)) }
  }

  async listMessagesAround(query: MessageAroundQuery): Promise<MessagesAroundPage> {
    const contact = await this.findContact(query.conversationId)
    if (!contact) return { items: [], found: false, radiusSeconds: 0, truncated: false }

    const target = parseEntityId(query.messageId)
    if (target.source !== SOURCE || target.account !== this.account) {
      throw new Error('Message belongs to another data source')
    }

    const baseRadius = normalizeRadiusSeconds(query.radiusSeconds)
    const widenRadius = widenRadiusSeconds(baseRadius)
    const anchorSeconds = query.anchorTime ? Math.floor(query.anchorTime / 1000) : undefined
    const radii = messagesAroundRadii(anchorSeconds, baseRadius, widenRadius)
    if (!radii.length) return { items: [], found: false, radiusSeconds: 0, truncated: false }

    for (const radius of radii) {
      const startTime = Math.max(0, (anchorSeconds as number) - radius)
      const endTime = (anchorSeconds as number) + radius
      const sourceMessages = await listMessagesAsync(
        contact.md5,
        startTime,
        endTime,
        undefined,
        '',
        'archive'
      )
      const mapped = sourceMessages.map((message) => this.mapMessageRecord(contact, message))
      const truncated = mapped.length > MESSAGES_AROUND_MAX_WINDOW
      const items = truncated ? mapped.slice(0, MESSAGES_AROUND_MAX_WINDOW) : mapped
      const found = items.some(
        (message) => message.id === query.messageId || message.nativeRef.native === target.native
      )
      if (found || radius === radii[radii.length - 1]) {
        return { items, found, radiusSeconds: radius, truncated }
      }
    }

    return { items: [], found: false, radiusSeconds: 0, truncated: false }
  }

  async resolveAsset(assetId: EntityId): Promise<Asset> {
    const ref = parseEntityId(assetId)
    if (ref.source !== SOURCE || ref.account !== this.account)
      throw new Error('Asset belongs to another data source')
    const [, assetKind] = ref.native.split('/')
    const supportedKind: Asset['assetKind'] =
      assetKind === 'image' ||
      assetKind === 'video' ||
      assetKind === 'audio' ||
      assetKind === 'sticker'
        ? assetKind
        : 'file'
    const hint = this.assetHints.get(assetId)
    const base: Asset = {
      kind: 'asset',
      id: assetId,
      nativeRef: ref,
      assetKind: supportedKind,
      state: 'unresolved',
      extensions: { wechat: { lazy: true } }
    }
    if (!this.assetResolver || !hint) {
      if (!this.assetResolver || !hint) return base
    }

    const result = await this.assetResolver.resolve(hint)
    return {
      ...base,
      state: result.state,
      uri: result.uri,
      thumbnailUri: result.thumbnailUri,
      mimeType: result.mimeType || base.mimeType,
      name: result.name || hint.name,
      byteLength: hint.byteLength,
      durationMs: hint.durationMs,
      extensions: {
        wechat: {
          lazy: true,
          ...(result.error ? { error: result.error } : {})
        }
      }
    }
  }

  private mapMessageRecord(conversation: FormattedContact, message: FormattedMessage): Message {
    const mapped = mapMessage(this.account, conversation, message)
    const hint = mapAssetHint(message, mapped)
    if (hint) this.assetHints.set(hint.assetId, hint)
    return mapped
  }

  private assertAccount(accountId?: EntityId): void {
    if (accountId && accountId !== this.accountId)
      throw new Error('Account belongs to another data source')
  }

  private async findContact(conversationId: EntityId): Promise<FormattedContact | undefined> {
    const ref = parseEntityId(conversationId)
    if (ref.source !== SOURCE || ref.account !== this.account)
      throw new Error('Conversation belongs to another data source')
    const contacts = await listContactsAsync()
    return contacts.find((contact) => contactNative(contact) === ref.native)
  }
}
