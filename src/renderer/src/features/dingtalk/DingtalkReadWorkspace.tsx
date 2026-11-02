import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Contact, Message as LegacyMessage } from '../../../../shared/types'
import type { Conversation, Message as UnifiedMessage } from '../../../../shared/domain-entities'
import type { EntityId } from '../../../../shared/entity-id'
import type { ProviderSnapshot } from '../../../../shared/data-source'
import type { ReadContext } from '../../../../shared/source-context'
import { Sidebar } from '../../components/Sidebar'
import ChatWindow from '../../components/ChatWindow'
import { DingtalkSendDialog } from './DingtalkSendDialog'

function contentLabel(message: UnifiedMessage): string {
  switch (message.content.type) {
    case 'text':
      return message.content.text
    case 'image':
      return '图片消息（媒体尚未解析）'
    case 'audio':
      return '语音消息（媒体尚未解析）'
    case 'video':
      return '视频消息（媒体尚未解析）'
    case 'file':
      return message.content.name ? '文件：' + message.content.name : '文件消息（媒体尚未解析）'
    case 'system':
      return message.content.text
    case 'unknown':
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

function toLegacyMessage(message: UnifiedMessage): LegacyMessage {
  const isMine = message.direction === 'outgoing'
  const isSystem = message.content.type === 'system'
  const content = contentLabel(message)
  const sender = String(message.senderId || '').trim()
  return {
    id: message.id,
    from: isSystem ? 'system' : isMine ? 'assistant' : sender || 'dingtalk-contact',
    type: isSystem ? '系统消息' : message.content.type === 'text' ? '文字' : '不支持的消息',
    datetime: message.sentAt ? new Date(message.sentAt).toLocaleString('zh-CN') : '',
    content,
    isSender: isMine,
    name: isMine ? '我' : sender || '联系人',
    senderId: sender || undefined,
    createTime: message.sentAt ? Math.floor(message.sentAt / 1000) : undefined
  }
}

export interface DingtalkReadWorkspaceProps {
  snapshot?: ProviderSnapshot
}

export function DingtalkReadWorkspace({
  snapshot: initialSnapshot
}: DingtalkReadWorkspaceProps = {}): React.ReactElement {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<EntityId>()
  const [messages, setMessages] = useState<LegacyMessage[]>([])
  const [snapshot, setSnapshot] = useState<ProviderSnapshot | undefined>(initialSnapshot)
  const snapshotRef = useRef<ProviderSnapshot | undefined>(initialSnapshot)
  const [conversationFilter, setConversationFilter] = useState('')
  const [contentFilter, setContentFilter] = useState('')
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [messageRefreshVersion, setMessageRefreshVersion] = useState(0)
  const [sendDialogOpen, setSendDialogOpen] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    snapshotRef.current = initialSnapshot
    setSnapshot(initialSnapshot)
  }, [initialSnapshot])

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId),
    [conversations, selectedId]
  )
  const contacts = useMemo(
    () =>
      conversations
        .filter((conversation) => {
          const keyword = conversationFilter.trim().toLocaleLowerCase()
          if (!keyword) return true
          return conversation.title.toLocaleLowerCase().includes(keyword)
        })
        .map(toContact),
    [conversations, conversationFilter]
  )
  const selectedContact = useMemo(
    () => (selectedConversation ? toContact(selectedConversation) : null),
    [selectedConversation]
  )

  const refreshSnapshot = useCallback(async (): Promise<ProviderSnapshot | undefined> => {
    const next = await window.api.getUnifiedProviderSnapshot()
    const valid = next?.source === 'dingtalk' ? next : undefined
    snapshotRef.current = valid
    setSnapshot(valid)
    return valid
  }, [])

  const readContext = useCallback((): ReadContext | undefined => {
    const current = snapshot
    return current?.context ? { expected: current.context, scope: { kind: 'all' } } : undefined
  }, [snapshot])

  const loadConversations = useCallback(
    async (providedSnapshot?: ProviderSnapshot): Promise<void> => {
      setLoadingConversations(true)
      setError('')
      try {
        const currentSnapshot = providedSnapshot || (await refreshSnapshot())
        const context = currentSnapshot?.context
          ? { expected: currentSnapshot.context, scope: { kind: 'all' as const } }
          : undefined
        const page = await window.api.listUnifiedConversations({ context, limit: 500 })
        setConversations(page.items)
        setSelectedId((current) =>
          current && page.items.some((conversation) => conversation.id === current)
            ? current
            : page.items[0]?.id
        )
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '钉钉会话读取失败')
      } finally {
        setLoadingConversations(false)
      }
    },
    [refreshSnapshot]
  )

  const refreshWorkspace = useCallback(async (): Promise<void> => {
    const next = await refreshSnapshot()
    await loadConversations(next)
    setMessageRefreshVersion((version) => version + 1)
  }, [loadConversations, refreshSnapshot])

  useEffect(() => {
    void loadConversations().catch(() => undefined)
  }, [loadConversations])

  useEffect(() => {
    if (!selectedConversation) {
      setMessages([])
      return
    }
    let active = true
    setLoadingMessages(true)
    setError('')
    void Promise.resolve(readContext())
      .then((context) =>
        window.api.listUnifiedMessages({
          context,
          conversationId: selectedConversation.id,
          limit: 200
        })
      )
      .then((page) => {
        if (active) setMessages(page.items.map(toLegacyMessage))
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : '钉钉消息读取失败')
      })
      .finally(() => {
        if (active) setLoadingMessages(false)
      })
    return () => {
      active = false
    }
  }, [messageRefreshVersion, readContext, selectedConversation])

  const sendHealth = snapshot?.send?.health
  const sendUnavailableReason = sendHealth?.message || '钉钉发送能力尚未加载，请先启动并登录钉钉。'
  const statusLabel = sendHealth?.available
    ? '发送已就绪'
    : snapshot?.health.available
      ? '钉钉已连接'
      : '钉钉未连接'
  const handleSent = useCallback((): void => {
    setMessageRefreshVersion((version) => version + 1)
    void refreshSnapshot()
  }, [refreshSnapshot])

  const handleOpenSend = useCallback(async (): Promise<void> => {
    try {
      const next = await refreshSnapshot()
      if (!next || next.source !== 'dingtalk') {
        setError('钉钉发送身份尚未确认，请重新连接数据源')
        return
      }
      setSendDialogOpen(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '钉钉发送能力检查失败')
    }
  }, [refreshSnapshot])

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="dingtalk-read-workspace">
      {error && (
        <div role="alert" className="border-b border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
        </div>
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
        />
        <ChatWindow
          key={selectedContact?.md5}
          contact={selectedContact}
          messages={messages}
          isLoadingMessages={loadingMessages}
          messageHistoryStatus={error && selectedConversation ? 'error' : 'idle'}
          contentFilter={contentFilter}
          onContentFilterChange={setContentFilter}
          onRefresh={async () => {
            if (!selectedConversation) return
            setMessageRefreshVersion((version) => version + 1)
          }}
          showSendAction
          sendActionSupported
          sendUnavailableReason={sendUnavailableReason}
          sendLabel="发送"
          onOpenSend={() => void handleOpenSend()}
          showConversationAI={false}
          showReportAction={false}
          statusLabel={statusLabel}
          sendDialog={
            selectedConversation ? (
              <DingtalkSendDialog
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
