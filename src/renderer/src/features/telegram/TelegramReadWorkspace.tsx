import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Contact } from '../../../../shared/types'
import type { Conversation, Message as UnifiedMessage } from '../../../../shared/domain-entities'
import { parseEntityId, type EntityId } from '../../../../shared/entity-id'
import type { ProviderSnapshot } from '../../../../shared/data-source'
import type { TelegramMacOSMessage } from '../../../../shared/telegram-macos-protocol'
import { sourceContextKey, type ReadContext } from '../../../../shared/source-context'
import { Sidebar } from '../../components/Sidebar'
import { Button } from '../../components/ui'
import type { TelegramLocalConnection } from '../data-sources/telegram-source-options'
import { TelegramSendDialog } from './TelegramSendDialog'
import { TelegramChatWindow } from './TelegramChatWindow'
import { TelegramHistoryControls } from './TelegramHistoryControls'
import { TelegramAccountHistory } from './TelegramAccountHistory'
import type { TelegramDisplayMessage } from './TelegramMedia'

function telegramSenderName(message: UnifiedMessage, nativeMacOS: boolean): string | undefined {
  if (nativeMacOS || message.extensions?.telegramMacOS) {
    if (!message.senderId) return '未知发送者'
    try {
      const sender = parseEntityId(message.senderId)
      const author = /^author\/(-?\d+)$/.exec(sender.native)
      return author && sender.source === 'telegram' && sender.account === message.nativeRef.account
        ? `用户 ${author[1]}`
        : '未知发送者'
    } catch {
      return '未知发送者'
    }
  }
  const extensions = message.extensions?.telegram
  if (!extensions || typeof extensions !== 'object') return undefined
  const value = (extensions as Record<string, unknown>).senderName
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function contentLabel(message: UnifiedMessage): string {
  switch (message.content.type) {
    case 'text':
      return message.content.text
    case 'image':
      return '图片消息（附件内容尚未读取）'
    case 'audio':
      return '语音消息（附件内容尚未读取）'
    case 'video':
      return '视频消息（附件内容尚未读取）'
    case 'sticker':
      return '贴纸消息（附件内容尚未读取）'
    case 'file':
      return message.content.name ? '文件：' + message.content.name : '文件消息（附件内容尚未读取）'
    case 'location':
      return message.content.label
        ? '位置：' + message.content.label
        : '位置：' + message.content.latitude + ', ' + message.content.longitude
    case 'system':
      return message.content.text
    case 'unknown':
      if (message.content.platformType === 'telegram-macos-media')
        return '附件消息（仅有本地元数据，内容尚未读取）'
      return '暂不支持的消息类型：' + String(message.content.platformType)
    default:
      return '暂不支持的消息类型：' + message.content.type
  }
}

function toContact(conversation: Conversation): Contact {
  return {
    m_nsUsrName: conversation.nativeRef.native,
    m_nsNickName: conversation.title,
    md5: conversation.id,
    type: conversation.conversationKind === 'group' ? 'group' : 'user',
    avatar: conversation.avatar
  }
}

function nativeMediaDescription(media: NonNullable<TelegramMacOSMessage['media']>[number]): string {
  const labels = {
    photo: '图片',
    video: '视频',
    audio: '音频',
    voice: '语音',
    sticker: '贴纸',
    animation: '动画',
    file: '文件',
    unknown: '附件类型尚未解析'
  }
  const size =
    media.byteLength === undefined
      ? undefined
      : media.byteLength >= 1048576
        ? `${Number((media.byteLength / 1048576).toFixed(1))} MiB`
        : media.byteLength >= 1024
          ? `${Number((media.byteLength / 1024).toFixed(1))} KiB`
          : `${media.byteLength} B`
  return [
    labels[media.kind],
    media.filename,
    media.mimeType,
    size,
    media.width !== undefined && media.height !== undefined
      ? `${media.width} × ${media.height}`
      : undefined,
    media.durationSeconds !== undefined ? `${media.durationSeconds} 秒` : undefined,
    media.metadataState === 'unsupported' ? '元数据尚未完整解析' : undefined
  ]
    .filter(Boolean)
    .join(' · ')
}

function toLegacyMessage(message: UnifiedMessage, nativeMacOS = false): TelegramDisplayMessage {
  const isMine = message.direction === 'outgoing'
  const isSystem = message.content.type === 'system'
  const senderName = telegramSenderName(message, nativeMacOS)
  const senderId = String(message.senderId || '').trim()
  const displayName = isMine ? '我' : senderName || senderId || '联系人'
  const metadata = message.extensions?.telegram as { caption?: string } | undefined
  const contentMetadata =
    'extensions' in message.content
      ? (message.content.extensions?.telegram as { caption?: string } | undefined)
      : undefined
  const rawCaption = metadata?.caption || contentMetadata?.caption
  const caption =
    message.content.type !== 'text' && typeof rawCaption === 'string' ? rawCaption : undefined
  const content = message.content
  const nativeMetadata = message.extensions?.telegramMacOS as
    | {
        mediaCount?: number
        media?: TelegramMacOSMessage['media']
      }
    | undefined
  const nativeMediaNote = nativeMetadata?.mediaCount
    ? [
        content.type === 'text'
          ? `含 ${nativeMetadata.mediaCount} 个附件（仅有本地元数据，内容尚未读取）`
          : undefined,
        ...(nativeMetadata.media || []).map(nativeMediaDescription)
      ]
        .filter(Boolean)
        .join('\n')
    : undefined
  const telegramMedia =
    content.type === 'image' ||
    content.type === 'audio' ||
    content.type === 'video' ||
    content.type === 'file' ||
    content.type === 'sticker'
      ? content
      : undefined
  return {
    id: message.id,
    from: isSystem ? 'system' : isMine ? 'assistant' : senderId || 'telegram-contact',
    type: isSystem ? '系统消息' : message.content.type === 'text' ? '文字' : '不支持的消息',
    datetime: message.sentAt ? new Date(message.sentAt).toLocaleString('zh-CN') : '',
    content: [contentLabel(message), caption, nativeMediaNote].filter(Boolean).join('\n'),
    unifiedAssetId: telegramMedia?.assetId,
    telegramMedia,
    caption,
    isSender: isMine,
    name: displayName,
    senderId: senderId || undefined,
    createTime: message.sentAt ? Math.floor(message.sentAt / 1000) : undefined
  }
}

export interface TelegramReadWorkspaceProps {
  snapshot?: ProviderSnapshot
  onRefreshLocal?: () => Promise<void>
  localClientType?: TelegramLocalConnection['clientType']
}

export function TelegramReadWorkspace({
  snapshot: initialSnapshot,
  onRefreshLocal,
  localClientType
}: TelegramReadWorkspaceProps = {}): React.ReactElement {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<EntityId>()
  const [messagePage, setMessagePage] = useState<{
    key: string
    items: TelegramDisplayMessage[]
    nextCursor?: string
    seenCursors?: string[]
  }>({
    key: '',
    items: []
  })
  const [snapshot, setSnapshot] = useState<ProviderSnapshot | undefined>(initialSnapshot)
  const [conversationFilter, setConversationFilter] = useState('')
  const [contentFilter, setContentFilter] = useState('')
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [conversationPage, setConversationPage] = useState<{
    key: string
    nextCursor?: string
    seenCursors: string[]
  }>()
  const [messageRefreshVersion, setMessageRefreshVersion] = useState(0)
  const [sendDialogOpen, setSendDialogOpen] = useState(false)
  const [error, setError] = useState('')
  const [chatHistoryBusy, setHistoryBusy] = useState(false)
  const [accountHistoryBusy, setAccountHistoryBusy] = useState(false)
  const historyBusy = chatHistoryBusy || accountHistoryBusy
  const mounted = useRef(false)
  const conversationGeneration = useRef(0)
  const refreshGeneration = useRef(0)
  const messageGeneration = useRef(0)
  const localSnapshot = Boolean(onRefreshLocal)
  const nativeMacOS = localClientType === 'telegram-macos'
  const desktopSnapshot = localSnapshot && !nativeMacOS
  const contextKey = snapshot?.context ? sourceContextKey(snapshot.context) : ''
  const contextKeyRef = useRef(contextKey)
  contextKeyRef.current = contextKey
  const readContext = useMemo<ReadContext | undefined>(
    () => (snapshot?.context ? { expected: snapshot.context, scope: { kind: 'all' } } : undefined),
    [snapshot?.context]
  )
  const messageKey = `${contextKey}:${selectedId || ''}`
  const messageKeyRef = useRef(messageKey)
  messageKeyRef.current = messageKey
  const messages = useMemo(() => {
    if (messagePage.key !== messageKey) return []
    return nativeMacOS
      ? [...messagePage.items]
          .reverse()
          .sort((left, right) => (left.createTime || 0) - (right.createTime || 0))
      : messagePage.items
  }, [messageKey, messagePage, nativeMacOS])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    conversationGeneration.current++
    refreshGeneration.current++
    setSnapshot(initialSnapshot)
  }, [initialSnapshot])

  useEffect(() => {
    setSendDialogOpen(false)
  }, [messageKey])

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId),
    [conversations, selectedId]
  )
  const contacts = useMemo(
    () =>
      conversations
        .filter((conversation) => {
          const keyword = conversationFilter.trim().toLocaleLowerCase()
          return !keyword || conversation.title.toLocaleLowerCase().includes(keyword)
        })
        .map(toContact),
    [conversations, conversationFilter]
  )
  const selectedContact = useMemo(
    () => (selectedConversation ? toContact(selectedConversation) : null),
    [selectedConversation]
  )

  const refreshSnapshot = useCallback(async (): Promise<ProviderSnapshot | undefined> => {
    const generation = ++refreshGeneration.current
    const next = await window.api.getUnifiedProviderSnapshot()
    if (!mounted.current || generation !== refreshGeneration.current) return undefined
    const valid = next?.source === 'telegram' ? next : undefined
    setSnapshot(valid)
    return valid
  }, [])

  const loadConversations = useCallback(
    async (providedSnapshot?: ProviderSnapshot): Promise<void> => {
      const generation = ++conversationGeneration.current
      const active = (): boolean => mounted.current && generation === conversationGeneration.current
      setLoadingConversations(true)
      setError('')
      setConversationPage(undefined)
      try {
        const currentSnapshot = providedSnapshot || (await refreshSnapshot())
        if (!active()) return
        if (
          currentSnapshot?.source !== 'telegram' ||
          currentSnapshot.context?.source !== 'telegram'
        )
          throw new Error('Telegram 数据源上下文尚未就绪')
        if (nativeMacOS && !currentSnapshot.health.available)
          throw new Error(currentSnapshot.health.message || 'Telegram macOS 原生版读取能力不可用')
        const context: ReadContext | undefined = currentSnapshot?.context
          ? { expected: currentSnapshot.context, scope: { kind: 'all' } }
          : undefined
        let cursor: string | undefined
        const items: Conversation[] = []
        const seenCursors = new Set<string>()
        for (let pageIndex = 0; pageIndex < (desktopSnapshot ? 5 : 1); pageIndex++) {
          const page = await window.api.listUnifiedConversations({
            context,
            cursor,
            limit: nativeMacOS ? 100 : 500
          })
          if (!active()) return
          items.push(...page.items)
          cursor = page.nextCursor
          if (!cursor) break
          if (seenCursors.has(cursor)) throw new Error('Telegram 会话分页游标重复，请刷新重试')
          seenCursors.add(cursor)
        }
        setConversations(items)
        setConversationPage({
          key: sourceContextKey(currentSnapshot.context),
          nextCursor: cursor,
          seenCursors: [...seenCursors]
        })
        setSelectedId((current) =>
          current && items.some((conversation) => conversation.id === current)
            ? current
            : items[0]?.id
        )
      } catch (reason) {
        if (active()) {
          setConversations([])
          setSelectedId(undefined)
          setError(reason instanceof Error ? reason.message : 'Telegram 会话读取失败')
        }
      } finally {
        if (active()) setLoadingConversations(false)
      }
    },
    [refreshSnapshot, desktopSnapshot, nativeMacOS]
  )

  const loadMoreConversations = async (): Promise<void> => {
    if (
      !nativeMacOS ||
      loadingConversations ||
      !readContext ||
      conversationPage?.key !== contextKey ||
      !conversationPage.nextCursor
    )
      return
    const generation = ++conversationGeneration.current
    const active = (): boolean =>
      mounted.current &&
      generation === conversationGeneration.current &&
      contextKeyRef.current === contextKey
    setLoadingConversations(true)
    setError('')
    try {
      const page = await window.api.listUnifiedConversations({
        context: readContext,
        cursor: conversationPage.nextCursor,
        limit: 100
      })
      if (!active()) return
      if (page.nextCursor && conversationPage.seenCursors.includes(page.nextCursor))
        throw new Error('Telegram 会话分页游标重复，请刷新重试')
      setConversations((current) => [
        ...new Map([...current, ...page.items].map((item) => [item.id, item])).values()
      ])
      setConversationPage({
        key: contextKey,
        nextCursor: page.nextCursor,
        seenCursors: [
          ...conversationPage.seenCursors,
          ...(page.nextCursor ? [page.nextCursor] : [])
        ]
      })
    } catch (reason) {
      if (active()) setError(reason instanceof Error ? reason.message : 'Telegram 会话读取失败')
    } finally {
      if (active()) setLoadingConversations(false)
    }
  }

  const refreshWorkspace = useCallback(async (): Promise<void> => {
    if (historyBusy) return
    setLoadingConversations(true)
    try {
      if (onRefreshLocal) await onRefreshLocal()
      if (!mounted.current) return
      const next = await refreshSnapshot()
      if (next && mounted.current) {
        await loadConversations(next)
        if (mounted.current) setMessageRefreshVersion((version) => version + 1)
      }
    } catch (reason) {
      if (mounted.current)
        setError(reason instanceof Error ? reason.message : 'Telegram 快照刷新失败')
    } finally {
      if (mounted.current) setLoadingConversations(false)
    }
  }, [loadConversations, refreshSnapshot, onRefreshLocal, historyBusy])

  const rereadHistorySnapshot = useCallback(async (): Promise<void> => {
    if (!mounted.current || contextKeyRef.current !== contextKey) return
    const next = await refreshSnapshot()
    if (!next || !mounted.current || contextKeyRef.current !== contextKey) return
    await loadConversations(next)
    if (mounted.current) setMessageRefreshVersion((version) => version + 1)
  }, [contextKey, loadConversations, refreshSnapshot])

  const handleHistoryBusy = useCallback((busy: boolean): void => {
    if (mounted.current) setHistoryBusy(busy)
  }, [])

  const sendHealth = snapshot?.send?.health
  const sendUnavailableReason = sendHealth?.message || 'Telegram Desktop 发送能力尚未加载。'
  const sendReady = Boolean(
    !nativeMacOS &&
    !historyBusy &&
    selectedConversation &&
    selectedConversation.conversationKind !== 'channel' &&
    snapshot?.send?.capabilities.canSend &&
    sendHealth?.available
  )
  const statusLabel = nativeMacOS
    ? 'Telegram macOS 原生版 · 本地只读'
    : selectedConversation?.conversationKind === 'channel'
      ? 'Telegram 频道 · 不支持发送'
      : sendHealth?.available
        ? 'Telegram Desktop 发送已就绪'
        : snapshot?.health.available
          ? 'Telegram 已加载 · 发送不可用'
          : 'Telegram 未连接'

  const handleSent = useCallback((): void => {
    void refreshWorkspace()
  }, [refreshWorkspace])

  const handleOpenSend = useCallback(async (): Promise<void> => {
    if (nativeMacOS || !selectedConversation || historyBusy) return
    try {
      const next = await refreshSnapshot()
      if (!mounted.current || messageKeyRef.current !== messageKey) return
      if (!next || next.source !== 'telegram') {
        setError('Telegram 数据源尚未确认，请重新加载数据源')
        return
      }
      setSendDialogOpen(true)
    } catch (reason) {
      if (mounted.current && messageKeyRef.current === messageKey) {
        setError(reason instanceof Error ? reason.message : 'Telegram 发送状态读取失败')
      }
    }
  }, [refreshSnapshot, selectedConversation, historyBusy, messageKey, nativeMacOS])

  useEffect(() => {
    void loadConversations(initialSnapshot).catch(() => undefined)
  }, [loadConversations, initialSnapshot])

  useEffect(() => {
    const generation = ++messageGeneration.current
    if (!selectedConversation) {
      setMessagePage({ key: '', items: [] })
      setLoadingMessages(false)
      return
    }
    let active = true
    setLoadingMessages(true)
    setError('')
    const readMessages = async (): Promise<void> => {
      if (!readContext || readContext.expected.source !== 'telegram')
        throw new Error('Telegram 数据源上下文尚未就绪')
      let cursor: string | undefined
      const items = new Map<string, TelegramDisplayMessage>()
      const seenCursors = new Set<string>()
      for (let pageIndex = 0; pageIndex < (desktopSnapshot ? 200 : 1); pageIndex++) {
        const page = await window.api.listUnifiedMessages({
          context: readContext,
          conversationId: selectedConversation.id,
          cursor,
          limit: nativeMacOS ? 50 : localSnapshot ? 500 : 200
        })
        if (!active || generation !== messageGeneration.current) return
        for (const message of page.items)
          items.set(message.id, toLegacyMessage(message, nativeMacOS))
        cursor = page.nextCursor
        if (!cursor) break
        if (seenCursors.has(cursor)) throw new Error('Telegram 消息分页游标重复，请刷新重试')
        seenCursors.add(cursor)
      }
      if (active) {
        setMessagePage({
          key: messageKey,
          items: [...items.values()],
          nextCursor: cursor,
          seenCursors: [...seenCursors]
        })
        if (desktopSnapshot && cursor) setError('本次最多展示 100000 条快照消息，尚有消息未展示')
      }
    }
    void readMessages()
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Telegram 消息读取失败')
      })
      .finally(() => {
        if (active) setLoadingMessages(false)
      })
    return () => {
      active = false
      ++messageGeneration.current
    }
  }, [
    messageRefreshVersion,
    selectedConversation,
    readContext,
    localSnapshot,
    desktopSnapshot,
    nativeMacOS,
    messageKey
  ])

  const loadMoreMessages = async (): Promise<void> => {
    if (
      !nativeMacOS ||
      loadingMessages ||
      !selectedConversation ||
      !readContext ||
      messagePage.key !== messageKey ||
      !messagePage.nextCursor
    )
      return
    const generation = ++messageGeneration.current
    const active = (): boolean =>
      mounted.current &&
      messageKeyRef.current === messageKey &&
      generation === messageGeneration.current
    setLoadingMessages(true)
    setError('')
    try {
      const page = await window.api.listUnifiedMessages({
        context: readContext,
        conversationId: selectedConversation.id,
        cursor: messagePage.nextCursor,
        limit: 50
      })
      if (!active()) return
      if (page.nextCursor && messagePage.seenCursors?.includes(page.nextCursor))
        throw new Error('Telegram 消息分页游标重复，请刷新重试')
      setMessagePage({
        key: messageKey,
        items: [
          ...new Map(
            [
              ...messagePage.items,
              ...page.items.map((item) => toLegacyMessage(item, nativeMacOS))
            ].map((item) => [item.id, item])
          ).values()
        ],
        nextCursor: page.nextCursor,
        seenCursors: [
          ...(messagePage.seenCursors || []),
          ...(page.nextCursor ? [page.nextCursor] : [])
        ]
      })
    } catch (reason) {
      if (active()) setError(reason instanceof Error ? reason.message : 'Telegram 消息读取失败')
    } finally {
      if (active()) setLoadingMessages(false)
    }
  }

  return (
    <div
      className="flex h-full w-full min-h-0 min-w-0 flex-1 flex-col"
      data-testid="telegram-read-workspace"
    >
      {snapshot?.health.message &&
        (nativeMacOS || !localSnapshot || !snapshot.health.available) && (
          <p role="status" className="border-b border-border p-3 text-sm text-muted-foreground">
            {snapshot.health.message}
          </p>
        )}
      {error && (
        <div role="alert" className="border-b border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
        </div>
      )}
      {nativeMacOS && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2 text-sm text-muted-foreground">
          <span>本地只读快照 · 不代表完整云端历史；附件内容尚未读取。</span>
          {conversationPage?.key === contextKey && conversationPage.nextCursor && (
            <Button
              variant="outline"
              size="sm"
              disabled={loadingConversations}
              onClick={() => void loadMoreConversations()}
            >
              {loadingConversations ? '正在读取会话…' : '加载更多本地会话'}
            </Button>
          )}
        </div>
      )}
      {desktopSnapshot && (
        <TelegramAccountHistory
          key={contextKey}
          snapshot={snapshot}
          busy={historyBusy}
          onBusyChange={setAccountHistoryBusy}
          onSettled={rereadHistorySnapshot}
        />
      )}
      <div className="app-container min-h-0 flex-1">
        <Sidebar
          contacts={contacts}
          selectedContact={selectedContact}
          onSelectContact={(contact) => setSelectedId(contact.md5 as EntityId)}
          onSearch={setConversationFilter}
          onContentFilter={setContentFilter}
          width={300}
          selfInfo={null}
          dbReady={!loadingConversations}
          dbConnecting={loadingConversations}
          onOpenSettings={() => undefined}
          onRefresh={refreshWorkspace}
          expandContactsByDefault
          unclassifiedConversations={nativeMacOS}
        />
        <TelegramChatWindow
          key={messageKey}
          contact={selectedContact}
          messages={messages}
          context={readContext}
          isLoadingMessages={loadingMessages}
          contentFilter={contentFilter}
          onContentFilterChange={setContentFilter}
          onRefresh={async () => {
            if (onRefreshLocal) return refreshWorkspace()
            if (selectedConversation) setMessageRefreshVersion((version) => version + 1)
          }}
          sendActionSupported={sendReady}
          showSendAction={!nativeMacOS}
          showSenderNames={nativeMacOS}
          sendUnavailableReason={
            historyBusy
              ? '历史补载结束后可发送'
              : selectedConversation?.conversationKind === 'channel'
                ? '频道没有可用的文字输入框'
                : sendUnavailableReason
          }
          onOpenSend={() => void handleOpenSend()}
          statusLabel={statusLabel}
          historyControls={
            nativeMacOS && messagePage.key === messageKey && messagePage.nextCursor ? (
              <div className="border-b border-border p-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingMessages}
                  onClick={() => void loadMoreMessages()}
                >
                  {loadingMessages ? '正在读取消息…' : '加载更早的本地消息'}
                </Button>
              </div>
            ) : desktopSnapshot && selectedConversation ? (
              <TelegramHistoryControls
                key={messageKey}
                conversationId={selectedConversation.id}
                snapshot={snapshot}
                busy={historyBusy}
                onBusyChange={handleHistoryBusy}
                onSettled={rereadHistorySnapshot}
              />
            ) : undefined
          }
          sendDialog={
            !nativeMacOS && selectedConversation ? (
              <TelegramSendDialog
                open={sendDialogOpen}
                conversationId={selectedConversation.id}
                displayName={selectedConversation.title}
                context={snapshot?.context}
                snapshot={snapshot}
                onClose={() => setSendDialogOpen(false)}
                onSent={handleSent}
              />
            ) : undefined
          }
        />
      </div>
    </div>
  )
}
