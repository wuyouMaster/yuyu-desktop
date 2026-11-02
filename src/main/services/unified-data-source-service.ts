import { randomUUID } from 'node:crypto'
import {
  belongsToAccount,
  identityKey,
  readContextKey,
  sourceContextKey,
  type ReadContext,
  type SourceIdentityState,
  type SourceOperationContext
} from '../../shared/source-context'
import type { EntityId } from '../../shared/entity-id'
import type {
  ConversationQuery,
  MessageAroundQuery,
  MessageQuery,
  MessagesAroundPage,
  Page,
  ProviderSnapshot,
  ReadProvider,
  SendProvider,
  SendRequest,
  SendResult
} from '../../shared/data-source'
import type {
  Account,
  Asset,
  Conversation,
  Membership,
  Message,
  Participant
} from '../../shared/domain-entities'
import {
  DataSourceRegistry,
  validateRegistration,
  type DataSourceRegistration
} from './data-source-registry'
import { WechatReadProvider } from './wechat-read-provider'
import { WechatSendProvider, type PersonalWechatSenderLike } from './wechat-send-provider'
import { DingtalkReadProvider } from './dingtalk-read-provider'
import { DingtalkStore } from './dingtalk-store'
import { DingtalkIdentityContextProvider } from './dingtalk-identity-context-provider'
import { DingtalkNativeSendService } from './dingtalk-native-send-service'
import { DingtalkSendProvider } from './dingtalk-send-provider'
import { TelegramExportReader } from './telegram-export-reader'
import { TelegramReadProvider } from './telegram-read-provider'
import { TelegramDesktopSendService } from './telegram-desktop-send-service'
import { TelegramSendProvider } from './telegram-send-provider'
import { TelegramRuntimeReader } from './telegram-runtime-reader'
import { TelegramRuntimeSendService } from './telegram-runtime-send-service'
import { TelegramRuntimeSendProvider } from './telegram-runtime-send-provider'
import { mergeTelegramRuntimeDocuments } from './telegram-runtime-store'
import type { TelegramExportDocument } from '../../shared/telegram-export'
import type {
  TelegramHistoryRequest,
  TelegramHistoryResult,
  TelegramHistoryQueueRequest,
  TelegramHistoryQueueStatus,
  TelegramMediaLoadRequest
} from '../../shared/telegram-history'
import { parseEntityId, serializeEntityId } from '../../shared/entity-id'
import { TelegramHistoryService } from './telegram-history-service'
import { TelegramHistoryQueue } from './telegram-history-queue'
import { effectiveTelegramHistory, hasCompleteTelegramHistory } from './telegram-history-state'
import {
  cancelTelegramRuntimeOperations,
  waitForTelegramRuntimeOperations,
  withTelegramRuntimeOperation,
  type TelegramRuntimeOperationOwner
} from './telegram-runtime-operation'
import { TelegramMediaCache } from './telegram-storage-runtime'
import { TelegramMediaLoadService } from './telegram-media-load-service'
import { TelegramMediaDownloadService } from './telegram-media-download-service'
import type { WechatAssetProviderResolver } from './wechat-asset-resolver'
import * as chat from './chat-service'
import { personalWechatSendService } from './personal-wechat-send-service'

/** Main-process owner for the currently opened local data source. */
export class UnifiedDataSourceService {
  readonly registry = new DataSourceRegistry()

  private readonly sender: PersonalWechatSenderLike
  private readonly dingtalkSender: DingtalkNativeSendService
  private readonly telegramReader: TelegramExportReader
  private readonly telegramSender: TelegramDesktopSendService

  private contextSession = randomUUID()
  private closed = false
  private disposePromise: Promise<void> | undefined
  private telegramOperationOwner: TelegramRuntimeOperationOwner = {}
  private readonly runtimeCleanupTasks = new Set<Promise<void>>()

  private currentAccountId: EntityId | undefined
  private currentAccountKey: string | undefined
  private currentDingtalkAccountKey: string | undefined
  private currentTelegramAccountKey: string | undefined
  private telegramRuntimeDocument: TelegramExportDocument | undefined
  private telegramHistoryQueue: TelegramHistoryQueue | undefined
  private telegramRuntimeSlot: number | undefined
  private telegramMediaCache: TelegramMediaCache | undefined
  private readonly mediaCleanupTasks = new Set<Promise<void>>()
  private readonly telegramMediaTokens = new Map<
    string,
    { filePath: string; mimeType: string; contentKey: string }
  >()
  private readonly telegramMediaContentTokens = new Map<string, string>()
  private selectedSource: string | undefined
  private assetResolver: WechatAssetProviderResolver | undefined

  constructor(
    sender: PersonalWechatSenderLike = personalWechatSendService,
    dingtalkSender: DingtalkNativeSendService = new DingtalkNativeSendService(),
    telegramReader: TelegramExportReader = new TelegramExportReader(),
    telegramSender: TelegramDesktopSendService = new TelegramDesktopSendService(),
    private readonly telegramRuntimeReader = new TelegramRuntimeReader(),
    private readonly telegramHistory = new TelegramHistoryService(),
    private readonly telegramMediaLoad = new TelegramMediaLoadService({
      attempts: 60,
      timeoutMs: 90000
    }),
    private readonly telegramMediaDownload = new TelegramMediaDownloadService()
  ) {
    this.sender = sender
    this.dingtalkSender = dingtalkSender
    this.telegramReader = telegramReader
    this.telegramSender = telegramSender
  }

  setAssetResolver(assetResolver: WechatAssetProviderResolver | undefined): void {
    this.assetResolver = assetResolver
    const current = this.currentAccountId
      ? this.registry.get('wechat', this.currentAccountId)?.read
      : undefined
    if (current instanceof WechatReadProvider) current.setAssetResolver(assetResolver)
  }

  /** Activate only a verified reader; discovered/locked accounts remain in discovery UI. */
  activateSource(registration: DataSourceRegistration): void {
    this.assertOpen()
    const { read } = registration
    if (!read.health().available) throw new Error('该数据源尚未具备读取能力')
    validateRegistration(registration)
    this.clear()
    this.registry.register(registration)
    this.selectedSource = read.source
    this.currentAccountId = read.accountId
  }

  refreshCurrentWechatSource(): ReadProvider | undefined {
    if (this.closed) return undefined
    if (!chat.isReady()) {
      this.clear()
      return undefined
    }

    const account = chat.getSelfAccountInfo()
    const accountKey = account?.wxid || account?.accountRoot
    if (!accountKey) {
      this.clear()
      return undefined
    }

    if (this.currentAccountKey === accountKey && this.currentAccountId) {
      const existing = this.registry.get('wechat', this.currentAccountId)
      if (existing?.read) return existing.read
    }

    this.clear()
    const provider = new WechatReadProvider({
      account: accountKey,
      displayName: account?.nickname,
      assetResolver: this.assetResolver
    })
    const send = new WechatSendProvider({ account: accountKey, sender: this.sender })
    this.registry.register({ read: provider, send })
    this.currentAccountId = provider.accountId
    this.currentAccountKey = accountKey
    return provider
  }

  async refreshDingtalkSource(): Promise<boolean> {
    this.assertOpen()
    const session = this.contextSession
    const store = new DingtalkStore()
    let account
    try {
      account = await store.account()
    } catch {
      this.assertOpen()
      if (session !== this.contextSession) throw new Error('数据源已切换，请重新连接')
      this.clear()
      return false
    }
    this.assertOpen()
    if (session !== this.contextSession) throw new Error('数据源已切换，请重新连接')
    if (
      this.selectedSource === 'dingtalk' &&
      this.currentDingtalkAccountKey === account.accountKey
    ) {
      return Boolean(
        this.currentAccountId && this.registry.get('dingtalk', this.currentAccountId)?.read
      )
    }
    this.clear()
    const provider = new DingtalkReadProvider(account.accountKey, store)
    const send = new DingtalkSendProvider({
      account: account.accountKey,
      sender: this.dingtalkSender
    })
    const context = new DingtalkIdentityContextProvider(provider.accountId, account.accountHash)
    this.registry.register({ read: provider, send, context })
    this.selectedSource = provider.source
    this.currentAccountId = provider.accountId
    this.currentDingtalkAccountKey = account.accountKey
    return Boolean(provider)
  }

  async connectTelegramLocalSource(
    slot: number,
    expectedAccount: string
  ): Promise<{
    accountId: EntityId
    accountLabel: string
    conversationCount: number
    messageCount: number
  }> {
    this.assertOpen()
    const session = this.contextSession
    const fresh = await this.telegramRuntimeReader.read(slot, expectedAccount)
    this.assertOpen()
    if (session !== this.contextSession) throw new Error('数据源已切换，请重新连接 Telegram。')
    const document = mergeTelegramRuntimeDocuments(
      this.currentTelegramAccountKey === expectedAccount ? this.telegramRuntimeDocument : undefined,
      fresh
    )
    this.clear()
    this.telegramRuntimeDocument = document
    this.telegramRuntimeSlot = slot
    const cache = new TelegramMediaCache({ slot, account: expectedAccount })
    this.telegramMediaCache = cache
    const provider = new TelegramReadProvider(document, {
      resolveMedia: async (media) => {
        if (this.telegramMediaCache !== cache) throw new Error('媒体所属账号已切换')
        const result = await cache.resolve(media.cacheRefs, media)
        if (this.telegramMediaCache !== cache) throw new Error('媒体所属账号已切换')
        if (!result) return undefined
        // Never present a document thumbnail as a playable video/audio/file.
        if (result.thumbnail && media.kind !== 'photo') return undefined
        // The cache reuses immutable verified output files. Repeated resolutions
        // in this connection must not mint tokens and evict still-used URLs.
        const contentKey = JSON.stringify([result.filePath, result.mimeType, result.byteLength])
        let token = this.telegramMediaContentTokens.get(contentKey)
        if (!token) {
          token = randomUUID()
          this.telegramMediaTokens.set(token, {
            filePath: result.filePath,
            mimeType: result.mimeType,
            contentKey
          })
          this.telegramMediaContentTokens.set(contentKey, token)
          if (this.telegramMediaTokens.size > 2048) {
            const [expiredToken, expired] = this.telegramMediaTokens.entries().next().value!
            this.telegramMediaTokens.delete(expiredToken)
            this.telegramMediaContentTokens.delete(expired.contentKey)
          }
        }
        return {
          uri: 'yuyu-media://telegram/' + token,
          mimeType: result.mimeType,
          byteLength: result.byteLength,
          previewOnly: result.thumbnail === true
        }
      }
    })
    const connectedSession = this.contextSession
    const sender = new TelegramRuntimeSendService({
      account: expectedAccount,
      slot,
      operationOwner: this.telegramOperationOwner,
      isCurrent: () =>
        !this.closed &&
        this.contextSession === connectedSession &&
        this.getCurrentReadProvider() === provider,
      readSnapshot: (targetSlot, account) => this.telegramRuntimeReader.read(targetSlot, account)
    })
    this.registry.register({
      read: provider,
      send: new TelegramRuntimeSendProvider({
        account: expectedAccount,
        sender
      })
    })
    this.selectedSource = provider.source
    this.currentAccountId = provider.accountId
    this.currentTelegramAccountKey = document.accountKey
    return {
      accountId: provider.accountId,
      accountLabel: document.accountLabel,
      conversationCount: document.conversations.length,
      messageCount: document.conversations.reduce((n, chat) => n + chat.messages.length, 0)
    }
  }

  async loadTelegramHistory(request: TelegramHistoryRequest): Promise<TelegramHistoryResult> {
    this.assertOpen()
    if (!request || !['older', 'newer'].includes(request.direction) || !request.expectedContext)
      throw new Error('Telegram 历史读取参数无效')
    return withTelegramRuntimeOperation(
      (signal) => this.loadTelegramHistoryStep(request, signal),
      this.telegramOperationOwner
    )
  }

  private async loadTelegramHistoryStep(
    request: TelegramHistoryRequest,
    signal: AbortSignal,
    reader: Pick<TelegramRuntimeReader, 'read'> = this.telegramRuntimeReader
  ): Promise<TelegramHistoryResult> {
    const provider = this.requireReadProvider()
    const original = this.telegramRuntimeDocument
    const slot = this.telegramRuntimeSlot
    if (!(provider instanceof TelegramReadProvider) || !original || slot === undefined)
      throw new Error('请先连接 Telegram 本地账号')
    const { context } = await this.inspectContext(provider)
    if (sourceContextKey(context) !== sourceContextKey(request.expectedContext))
      throw new Error('数据源已切换，请重新加载')
    const id = parseEntityId(request.conversationId)
    const peerId = id.native.replace(/^chat\//, '')
    const conversation = original.conversations.find((chat) => chat.id === peerId)
    if (id.source !== 'telegram' || id.account !== original.accountKey || !conversation)
      throw new Error('Telegram 会话不属于当前本地账号')
    const assertCurrent = (): void => {
      signal.throwIfAborted()
      this.assertOpen()
      if (this.getCurrentReadProvider() !== provider || context.sessionId !== this.contextSession)
        throw new Error('数据源已切换，已停止补载')
    }
    const fresh = await this.telegramHistory.step({
      slot,
      account: original.accountKey,
      peerId,
      direction: request.direction,
      signal,
      reader,
      assertCurrent
    })
    assertCurrent()
    const merged = mergeTelegramRuntimeDocuments(this.telegramRuntimeDocument, fresh)
    const current = merged.conversations.find((chat) => chat.id === peerId)!
    const freshConversation = fresh.conversations.find((chat) => chat.id === peerId)
    const boundary = effectiveTelegramHistory(freshConversation?.runtimeHistory)
    const reachedStart = boundary?.loadedAtTop === true
    const reachedEnd = boundary?.loadedAtBottom === true
    const previousIds = new Set(conversation.messages.map((message) => message.id))
    const oldBlocks = conversation.runtimeHistory?.blockMessageIds ?? []
    const newBlocks = freshConversation?.runtimeHistory?.blockMessageIds ?? []
    const edge = (ids: string[]): bigint | undefined => {
      const values = ids.map(BigInt)
      return values.reduce<bigint | undefined>(
        (result, value) =>
          result === undefined || (request.direction === 'older' ? value < result : value > result)
            ? value
            : result,
        undefined
      )
    }
    const oldEdge = edge(oldBlocks),
      newEdge = edge(newBlocks)
    const advanced =
      newEdge !== undefined &&
      (oldEdge === undefined ||
        (request.direction === 'older' ? newEdge < oldEdge : newEdge > oldEdge))
    this.telegramRuntimeDocument = merged
    provider.replaceDocument(merged)
    return {
      addedCount: current.messages.filter((message) => !previousIds.has(message.id)).length,
      advanced,
      messageCount: current.messages.length,
      reachedStart,
      reachedEnd,
      complete: Boolean(freshConversation && hasCompleteTelegramHistory(freshConversation))
    }
  }

  private async inspectTelegramQueueContext(request: TelegramHistoryQueueRequest): Promise<void> {
    this.assertOpen()
    const provider = this.requireReadProvider()
    if (
      !(provider instanceof TelegramReadProvider) ||
      !this.telegramRuntimeDocument ||
      this.telegramRuntimeSlot === undefined ||
      !request?.expectedContext
    )
      throw new Error('请先连接 Telegram 本地账号')
    const { context } = await this.inspectContext(provider)
    if (
      provider !== this.getCurrentReadProvider() ||
      context.sessionId !== this.contextSession ||
      sourceContextKey(context) !== sourceContextKey(request.expectedContext)
    )
      throw new Error('数据源已切换，请重新加载')
  }

  async startTelegramHistoryQueue(
    request: TelegramHistoryQueueRequest
  ): Promise<TelegramHistoryQueueStatus> {
    await this.inspectTelegramQueueContext(request)
    if (this.telegramHistoryQueue?.snapshot().state !== 'finished' && this.telegramHistoryQueue)
      throw new Error('Telegram 账号历史补载正在进行')
    const document = this.telegramRuntimeDocument!
    const slot = this.telegramRuntimeSlot!
    const provider = this.requireReadProvider()
    const session = this.contextSession
    const owner = this.telegramOperationOwner
    // Include every currently known conversation, independent of UI search/filter.
    const queue = new TelegramHistoryQueue(
      document.conversations.map((chat) => ({
        conversationId: serializeEntityId({
          source: 'telegram',
          account: document.accountKey,
          native: 'chat/' + chat.id
        }),
        title: chat.title,
        messageCount: chat.messages.length
      }))
    )
    this.telegramHistoryQueue = queue
    const assertCurrent = (): void => {
      this.assertOpen()
      if (this.getCurrentReadProvider() !== provider || this.contextSession !== session)
        throw new Error('数据源已切换')
    }
    let pid: number | undefined
    let activePeerId: string | undefined
    const read = async (): Promise<TelegramExportDocument> => {
      assertCurrent()
      queue.controller.signal.throwIfAborted()
      const fresh = await this.telegramRuntimeReader.read(slot, document.accountKey)
      assertCurrent()
      queue.controller.signal.throwIfAborted()
      if (
        fresh.accountKey !== document.accountKey ||
        fresh.accountNativeId !== document.accountNativeId ||
        fresh.runtime?.activeSelfId !== document.accountNativeId ||
        !fresh.runtime?.pid ||
        (pid !== undefined && fresh.runtime.pid !== pid)
      )
        throw new Error('Telegram 账号或进程已变化')
      pid = fresh.runtime.pid
      activePeerId = fresh.runtime.activePeerId
      return fresh
    }
    const reader = { read }
    // Reserve the global operation synchronously. Keep it through all pages,
    // inter-conversation checks and native child close, even after cancel/clear.
    void withTelegramRuntimeOperation(async (signal) => {
      await queue.run({
        signal,
        verify: async () => {
          await read()
        },
        canOpen: (item) => {
          const peer = parseEntityId(item.conversationId).native.slice(5)
          return peer === activePeerId || BigInt(peer) >> 48n === 2n
        },
        step: (item, direction, signal) =>
          this.loadTelegramHistoryStep(
            {
              conversationId: item.conversationId,
              expectedContext: request.expectedContext,
              direction
            },
            signal,
            reader
          ),
        messageCount: () =>
          this.telegramRuntimeDocument!.conversations.reduce(
            (sum, chat) => sum + chat.messages.length,
            0
          )
      })
    }, owner).catch(() => queue.fail())
    return queue.snapshot()
  }

  async getTelegramHistoryQueue(
    request: TelegramHistoryQueueRequest
  ): Promise<TelegramHistoryQueueStatus | undefined> {
    await this.inspectTelegramQueueContext(request)
    return this.telegramHistoryQueue?.snapshot()
  }

  async cancelTelegramHistoryQueue(
    request: TelegramHistoryQueueRequest
  ): Promise<TelegramHistoryQueueStatus> {
    await this.inspectTelegramQueueContext(request)
    const queue = this.telegramHistoryQueue
    if (!queue || !request.jobId || queue.snapshot().jobId !== request.jobId)
      throw new Error('Telegram 历史任务已变化')
    queue.cancel()
    return queue.snapshot()
  }

  async importTelegramSource(filePath: string): Promise<{
    accountId: EntityId
    accountLabel: string
    conversationCount: number
    messageCount: number
  }> {
    this.assertOpen()
    const session = this.contextSession
    const document = await this.telegramReader.read(filePath)
    this.assertOpen()
    if (session !== this.contextSession) throw new Error('数据源已切换，请重新连接')
    if (
      this.selectedSource === 'telegram' &&
      this.currentTelegramAccountKey === document.accountKey &&
      this.currentAccountId
    ) {
      return {
        accountId: this.currentAccountId,
        accountLabel: document.accountLabel,
        conversationCount: document.conversations.length,
        messageCount: document.conversations.reduce(
          (total, conversation) => total + conversation.messages.length,
          0
        )
      }
    }
    this.clear()
    const provider = new TelegramReadProvider(document)
    const send = new TelegramSendProvider({
      account: document.accountKey,
      document,
      sender: this.telegramSender
    })
    this.registry.register({ read: provider, send })
    this.selectedSource = provider.source
    this.currentAccountId = provider.accountId
    this.currentTelegramAccountKey = document.accountKey
    return {
      accountId: provider.accountId,
      accountLabel: document.accountLabel,
      conversationCount: document.conversations.length,
      messageCount: document.conversations.reduce(
        (total, conversation) => total + conversation.messages.length,
        0
      )
    }
  }

  getCurrentReadProvider(): ReadProvider | undefined {
    if (this.closed) return undefined
    if (this.selectedSource && this.currentAccountId) {
      return this.registry.get(this.selectedSource, this.currentAccountId)?.read
    }
    return this.refreshCurrentWechatSource()
  }

  async listAccounts(): Promise<Page<Account>> {
    const provider = this.requireReadProvider()
    const sessionId = this.contextSession
    const result = await provider.listAccounts()
    if (this.getCurrentReadProvider() !== provider || this.contextSession !== sessionId) {
      throw new Error('数据源已切换，请重新加载')
    }
    return result
  }

  async listConversations(query?: ConversationQuery): Promise<Page<Conversation>> {
    return this.readWithContext(query?.context, (provider) => {
      if (query?.accountId && query.accountId !== provider.accountId)
        throw new Error('会话不属于当前账号')
      return provider.listConversations(query)
    })
  }

  async listParticipants(accountId: EntityId, context?: ReadContext): Promise<Page<Participant>> {
    return this.readWithContext(context, (provider) => {
      if (provider.accountId !== accountId) throw new Error('联系人不属于当前账号')
      return context
        ? provider.listParticipants(accountId, context)
        : provider.listParticipants(accountId)
    })
  }

  async listMemberships(
    conversationId: EntityId,
    context?: ReadContext
  ): Promise<Page<Membership>> {
    return this.readWithContext(context, (provider) => {
      if (!belongsToAccount(conversationId, provider.source, provider.accountId))
        throw new Error('会话不属于当前账号')
      return context
        ? provider.listMemberships(conversationId, context)
        : provider.listMemberships(conversationId)
    })
  }

  async listMessages(query: MessageQuery): Promise<Page<Message>> {
    return this.readWithContext(query.context, (provider) => {
      if (!belongsToAccount(query.conversationId, provider.source, provider.accountId))
        throw new Error('会话不属于当前账号')
      return provider.listMessages(query)
    })
  }

  async listMessagesAround(query: MessageAroundQuery): Promise<MessagesAroundPage> {
    return this.readWithContext(query.context, (provider) => {
      if (!belongsToAccount(query.conversationId, provider.source, provider.accountId))
        throw new Error('会话不属于当前账号')
      return provider.listMessagesAround(query)
    })
  }

  async resolveAsset(assetId: EntityId, context?: ReadContext): Promise<Asset> {
    const provider = this.requireReadProvider()
    const asset = await this.readWithContext(
      context,
      (reader) => {
        if (!belongsToAccount(assetId, reader.source, reader.accountId))
          throw new Error('附件不属于当前账号')
        return context ? reader.resolveAsset(assetId, context) : reader.resolveAsset(assetId)
      },
      '附件所属账号已切换'
    )
    if (this.getCurrentReadProvider() !== provider) throw new Error('附件所属账号已切换')
    return asset
  }

  async loadTelegramMedia(request: TelegramMediaLoadRequest): Promise<Asset> {
    this.assertOpen()
    if (!request?.assetId || !request.expectedContext) throw new Error('Telegram 附件参数无效')
    return withTelegramRuntimeOperation(async (signal) => {
      const provider = this.requireReadProvider()
      const document = this.telegramRuntimeDocument
      const slot = this.telegramRuntimeSlot
      if (!(provider instanceof TelegramReadProvider) || !document || slot === undefined)
        throw new Error('请先连接 Telegram 本地账号')
      const { context } = await this.inspectContext(provider)
      if (sourceContextKey(context) !== sourceContextKey(request.expectedContext))
        throw new Error('数据源已切换，请重新加载')
      const id = parseEntityId(request.assetId)
      const match = /^asset\/message\/([1-9][0-9]*)\/([1-9][0-9]*)$/.exec(id.native)
      const message =
        match &&
        document.conversations
          .find((c) => c.id === match[1])
          ?.messages.find((m) => m.id === match[2])
      if (id.source !== 'telegram' || id.account !== document.accountKey || !message?.runtimeMedia)
        throw new Error('附件不属于当前 Telegram 本地账号')
      const assertCurrent = (): void => {
        signal.throwIfAborted()
        this.assertOpen()
        if (this.getCurrentReadProvider() !== provider || context.sessionId !== this.contextSession)
          throw new Error('附件所属账号已切换')
      }
      const read = async (): Promise<TelegramExportDocument> => {
        assertCurrent()
        const fresh = await this.telegramRuntimeReader.read(slot, document.accountKey)
        assertCurrent()
        if (
          !document.runtime ||
          fresh.runtime?.pid !== document.runtime.pid ||
          fresh.accountKey !== document.accountKey ||
          fresh.accountNativeId !== document.accountNativeId ||
          fresh.runtime?.activeSelfId !== document.accountNativeId
        )
          throw new Error('Telegram 进程或账号已变化，请重新连接后加载附件')
        return fresh
      }
      const fresh = await this.telegramHistory.step({
        slot,
        account: document.accountKey,
        peerId: match![1],
        messageId: match![2],
        direction: 'older',
        reader: { read },
        assertCurrent,
        signal
      })
      assertCurrent()
      return this.telegramMediaLoad.wait({
        connected: document,
        located: fresh,
        peerId: match![1],
        messageId: match![2],
        media: message.runtimeMedia,
        signal,
        assertCurrent,
        read,
        download: (observed) =>
          this.telegramMediaDownload.request({
            document: observed,
            peerId: match![1],
            messageId: match![2],
            media: message.runtimeMedia!,
            signal,
            assertCurrent
          }),
        resolve: async (observed) => {
          assertCurrent()
          this.telegramRuntimeDocument = mergeTelegramRuntimeDocuments(
            this.telegramRuntimeDocument,
            observed
          )
          provider.replaceDocument(this.telegramRuntimeDocument)
          return provider.resolveAsset(request.assetId)
        }
      })
    }, this.telegramOperationOwner)
  }

  async sendMessage(request: SendRequest): Promise<SendResult> {
    if (this.closed) return { accepted: false, error: '数据源服务已关闭，无法发送' }
    const read = this.getCurrentReadProvider()
    const provider: SendProvider | undefined = read
      ? this.registry.get(read.source, read.accountId)?.send
      : undefined
    if (!read || !provider) return { accepted: false, error: '当前数据源未提供发送能力' }
    if (!request || typeof request.conversationId !== 'string')
      return { accepted: false, error: '会话标识无效' }
    const sessionId = this.contextSession
    const registration = this.registry.get(read.source, read.accountId)!
    if (
      provider instanceof TelegramRuntimeSendProvider ||
      registration.context ||
      request.expectedContext
    ) {
      try {
        if (!request.expectedContext) throw new Error('请先确认当前发送身份')
        const { context } = await this.inspectContext(read)
        if (context.identity.kind === 'unknown') throw new Error('当前发送身份尚未确认')
        if (sourceContextKey(request.expectedContext) !== sourceContextKey(context)) {
          throw new Error('发送身份已变化，请重新确认')
        }
        if (!belongsToAccount(request.conversationId, read.source, read.accountId)) {
          throw new Error('会话不属于当前账号')
        }
      } catch (error) {
        return {
          accepted: false,
          error: error instanceof Error ? error.message : '发送身份校验失败'
        }
      }
    }
    if (this.getCurrentReadProvider() !== read || this.contextSession !== sessionId) {
      return { accepted: false, error: '发送身份已变化，请重新确认' }
    }
    // Context-aware providers must compare again at the actual native dispatch.
    return provider.send(request)
  }

  async getProviderSnapshot(): Promise<ProviderSnapshot | undefined> {
    this.assertOpen()
    const provider = this.getCurrentReadProvider()
    if (!provider) return undefined
    const registration = this.registry.get(provider.source, provider.accountId)
    const send = registration?.send
    if (send?.refresh) await send.refresh()
    // Status checks can outlive an account switch or a database disconnect.
    if (this.getCurrentReadProvider() !== provider) return undefined
    const { context, identityState } = await this.inspectContext(provider)
    if (this.getCurrentReadProvider() !== provider || context.sessionId !== this.contextSession)
      return undefined
    const identityUnknown = context.identity.kind === 'unknown'
    return {
      context,
      ...(identityState ? { identityState } : {}),
      source: provider.source,
      accountId: provider.accountId,
      capabilities: {
        ...provider.capabilities
      },
      health: provider.health(),
      ...(send
        ? {
            send: {
              capabilities: {
                ...send.capabilities,
                ...(identityUnknown ? { canSend: false } : {})
              },
              health: identityUnknown
                ? { state: 'degraded', available: false, message: '当前发送身份尚未确认' }
                : send.health()
            }
          }
        : {})
    }
  }

  private async inspectContext(provider: ReadProvider): Promise<{
    context: SourceOperationContext
    identityState?: SourceIdentityState
  }> {
    const sessionId = this.contextSession
    const inspector = this.registry.get(provider.source, provider.accountId)?.context
    // Copy provider-owned state so later mutations cannot rewrite issued snapshots.
    const identityState = inspector ? structuredClone(await inspector.inspectIdentity()) : undefined
    if (this.getCurrentReadProvider() !== provider || sessionId !== this.contextSession) {
      throw new Error('数据源或身份已切换，请重新加载')
    }
    if (identityState) {
      const belongs = (id: EntityId): boolean =>
        belongsToAccount(id, provider.source, provider.accountId)
      if (
        !identityState.revision ||
        typeof identityState.revision !== 'string' ||
        !Array.isArray(identityState.organizations) ||
        !Array.isArray(identityState.identities)
      ) {
        throw new Error('数据源身份信息无效')
      }
      const organizations = new Set<EntityId>()
      for (const org of identityState.organizations) {
        if (
          org.kind !== 'organization' ||
          org.accountId !== provider.accountId ||
          !belongs(org.id) ||
          organizations.has(org.id)
        ) {
          throw new Error('组织信息不属于当前账号或存在重复')
        }
        organizations.add(org.id)
      }
      const identities = new Set<EntityId>()
      for (const member of identityState.identities) {
        if (
          member.kind !== 'organizationIdentity' ||
          member.accountId !== provider.accountId ||
          !belongs(member.id) ||
          !belongs(member.participantId) ||
          !organizations.has(member.organizationId) ||
          identities.has(member.id)
        ) {
          throw new Error('组织身份关系无效')
        }
        identities.add(member.id)
      }
      const active = identityState.activeIdentity
      identityKey(active)
      if (
        active.kind === 'organization' &&
        !identityState.identities.some(
          (item) => item.id === active.identityId && item.organizationId === active.organizationId
        )
      )
        throw new Error('当前组织身份尚未验证')
    }
    return {
      context: {
        source: provider.source,
        accountId: provider.accountId,
        sessionId,
        revision: identityState?.revision ?? 'account',
        identity: identityState?.activeIdentity ?? { kind: 'account' }
      },
      identityState
    }
  }

  private async readWithContext<T>(
    request: ReadContext | undefined,
    read: (provider: ReadProvider) => Promise<T>,
    changedMessage = '数据源或身份已切换，请重新加载'
  ): Promise<T> {
    const provider = this.requireReadProvider()
    const sessionId = this.contextSession
    const contextual = Boolean(this.registry.get(provider.source, provider.accountId)?.context)
    if (contextual && !request) throw new Error('请先确认数据浏览身份与范围')
    if (request) {
      readContextKey(request)
      const { context, identityState } = await this.inspectContext(provider)
      if (sourceContextKey(request.expected) !== sourceContextKey(context))
        throw new Error(changedMessage)
      if (request.scope.kind !== 'all' && !contextual)
        throw new Error('当前数据源不支持组织范围筛选')
      if (request.scope.kind === 'organization') {
        const organizationId = request.scope.organizationId
        if (!identityState?.organizations.some((org) => org.id === organizationId))
          throw new Error('组织不属于当前账号')
      }
    }
    if (this.getCurrentReadProvider() !== provider || this.contextSession !== sessionId)
      throw new Error(changedMessage)
    const result = await read(provider)
    if (this.getCurrentReadProvider() !== provider || this.contextSession !== sessionId)
      throw new Error(changedMessage)
    if (request) {
      const { context } = await this.inspectContext(provider)
      if (sourceContextKey(request.expected) !== sourceContextKey(context))
        throw new Error(changedMessage)
    }
    if (this.getCurrentReadProvider() !== provider || this.contextSession !== sessionId)
      throw new Error(changedMessage)
    return result
  }

  private requireReadProvider(): ReadProvider {
    this.assertOpen()
    const provider = this.getCurrentReadProvider()
    if (!provider) throw new Error('本地数据源尚未就绪')
    return provider
  }

  clear(): void {
    this.telegramHistoryQueue?.cancel('source_changed')
    this.telegramHistoryQueue = undefined
    const owner = this.telegramOperationOwner
    this.telegramOperationOwner = {}
    this.contextSession = randomUUID()
    // Capture the old operation before abort listeners run. Cancellation stays
    // scoped to this connection even when another service owns the global lock.
    const stopped = waitForTelegramRuntimeOperations(owner)
    this.runtimeCleanupTasks.add(stopped)
    void stopped.then(() => this.runtimeCleanupTasks.delete(stopped))
    cancelTelegramRuntimeOperations(owner)
    const current = this.currentAccountId
      ? this.registry.get('wechat', this.currentAccountId)?.read
      : undefined
    if (current instanceof WechatReadProvider) current.clear()
    this.registry.clear()
    this.currentAccountId = undefined
    this.currentAccountKey = undefined
    this.currentDingtalkAccountKey = undefined
    this.currentTelegramAccountKey = undefined
    this.telegramRuntimeDocument = undefined
    this.telegramRuntimeSlot = undefined
    const mediaCache = this.telegramMediaCache
    this.telegramMediaCache = undefined
    this.telegramMediaDownload.reset()
    this.telegramMediaTokens.clear()
    this.telegramMediaContentTokens.clear()
    if (mediaCache) {
      const cleanup = mediaCache.dispose().catch(() => undefined)
      this.mediaCleanupTasks.add(cleanup)
      void cleanup.finally(() => this.mediaCleanupTasks.delete(cleanup))
    }
    this.selectedSource = undefined
  }

  telegramMediaForUrl(url: string): { filePath: string; mimeType: string } | undefined {
    try {
      const parsed = new URL(url)
      if (
        parsed.protocol !== 'yuyu-media:' ||
        parsed.hostname !== 'telegram' ||
        parsed.search ||
        parsed.hash
      )
        return undefined
      const media = this.telegramMediaTokens.get(parsed.pathname.slice(1))
      return media ? { filePath: media.filePath, mimeType: media.mimeType } : undefined
    } catch {
      return undefined
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('数据源服务已关闭')
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.closed = true
    let resolve!: () => void
    let reject!: (error: unknown) => void
    this.disposePromise = new Promise<void>((done, fail) => {
      resolve = done
      reject = fail
    })
    let failed = false
    let cleanupError: unknown
    try {
      this.clear()
    } catch (error) {
      failed = true
      cleanupError = error
    }
    void Promise.all([...this.runtimeCleanupTasks, ...this.mediaCleanupTasks]).then(
      () => (failed ? reject(cleanupError) : resolve()),
      reject
    )
    return this.disposePromise
  }
}

export const unifiedDataSourceService = new UnifiedDataSourceService()
