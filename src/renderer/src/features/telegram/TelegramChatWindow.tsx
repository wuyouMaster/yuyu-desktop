import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ReadContext } from '../../../../shared/source-context'
import type ChatWindow from '../../components/ChatWindow'
import { ChatHeader } from '../../components/chat/ChatHeader'
import { ChatImageViewer } from '../../components/chat/ChatImageViewer'
import { ChatStatusBar } from '../../components/chat/ChatStatusBar'
import { EmptyConversationState } from '../../components/chat/EmptyConversationState'
import { MessageBubble } from '../../components/chat/MessageBubble'
import { MessageGroup } from '../../components/chat/MessageGroup'
import { buildMessageGroups, formatMessageTime } from '../../components/chat/messageGrouping'
import { TelegramMedia, type TelegramDisplayMessage } from './TelegramMedia'

type Props = Pick<
  ComponentProps<typeof ChatWindow>,
  | 'contact'
  | 'isLoadingMessages'
  | 'contentFilter'
  | 'onContentFilterChange'
  | 'onRefresh'
  | 'sendActionSupported'
  | 'sendUnavailableReason'
  | 'onOpenSend'
  | 'sendDialog'
  | 'statusLabel'
> & {
  messages: TelegramDisplayMessage[]
  context?: ReadContext
  historyControls?: ReactNode
  showSendAction?: boolean
  showSenderNames?: boolean
}

export function TelegramChatWindow({
  contact,
  messages,
  context,
  isLoadingMessages,
  contentFilter = '',
  onContentFilterChange,
  onRefresh,
  sendActionSupported,
  sendUnavailableReason,
  onOpenSend,
  sendDialog,
  statusLabel,
  historyControls,
  showSendAction = true,
  showSenderNames = false
}: Props): React.ReactElement {
  const listRef = useRef<HTMLDivElement>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [atLatest, setAtLatest] = useState(true)
  const filtered = useMemo(() => {
    const hiddenTypes = (import.meta.env.VITE_FILTER_MSG_TYPES || '')
      .split(',')
      .map((type) => type.trim())
      .filter(Boolean)
    return messages.filter(
      (message) =>
        !hiddenTypes.includes(message.type) &&
        (!contentFilter || message.content.includes(contentFilter))
    )
  }, [contentFilter, messages])
  const messagesById = useMemo(() => new Map(messages.map((item) => [item.id, item])), [messages])
  const groups = useMemo(
    () =>
      buildMessageGroups(filtered).flatMap((group) => {
        // A single sender can have thousands of consecutive media messages. Bound
        // the virtual row itself, rather than mounting that entire sender group.
        const chunks: (typeof group)[] = []
        for (let index = 0; index < group.messages.length; index += 8) {
          chunks.push({
            ...group,
            id: group.messages[index].id,
            messages: group.messages.slice(index, index + 8),
            timeLabel: index === 0 ? group.timeLabel : undefined
          })
        }
        return chunks
      }),
    [filtered]
  )
  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => 48 + groups[index].messages.length * 96,
    getItemKey: (index) => groups[index]?.id || index,
    overscan: 4
  })
  const scrollToLatest = (): void => {
    if (groups.length) virtualizer.scrollToIndex(groups.length - 1, { align: 'end' })
    setAtLatest(true)
  }

  useEffect(() => {
    if (!atLatest || !groups.length) return
    const frame = requestAnimationFrame(() =>
      virtualizer.scrollToIndex(groups.length - 1, { align: 'end' })
    )
    return () => cancelAnimationFrame(frame)
  }, [atLatest, groups, virtualizer])

  if (!contact) return <EmptyConversationState />
  const isGroupChat = contact.type === 'group'
  const showAuthors = isGroupChat || showSenderNames

  return (
    <div className="chat-window">
      <ChatHeader
        contact={contact}
        isGroupChat={isGroupChat}
        conversationTypeLabel={showSenderNames ? '本地会话 · 类型尚未解析' : undefined}
        loadedCount={messages.length}
        filteredCount={filtered.length}
        contentFilter={contentFilter}
        isAiLoading={false}
        onContentFilterChange={onContentFilterChange || (() => undefined)}
        onRefresh={onRefresh}
        showSendAction={showSendAction}
        sendActionSupported={sendActionSupported}
        sendUnavailableReason={sendUnavailableReason}
        sendLabel="发送"
        onTestSend={onOpenSend}
        showConversationAI={false}
        showReportAction={false}
        statusLabel={statusLabel}
      />
      {historyControls}
      <div
        className="message-list wechat-message-list"
        ref={listRef}
        onScroll={(event) => {
          const element = event.currentTarget
          setAtLatest(element.scrollHeight - element.scrollTop - element.clientHeight <= 24)
        }}
      >
        {isLoadingMessages && <div className="message-loading-pill">正在加载聊天记录...</div>}
        <div className="virtual-message-list" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const group = groups[item.index]
            const hasMedia = group.messages.some(
              (message) => messagesById.get(message.id)?.telegramMedia
            )
            const first = group.messages[0]
            const name = group.isMine
              ? '我'
              : showAuthors
                ? first.name || first.from
                : contact.m_nsNickName
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="virtual-message-group"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {!hasMedia ? (
                  <MessageGroup
                    group={group}
                    contact={contact}
                    isGroupChat={showAuthors}
                    showAvatar
                    onImageClick={setPreviewImage}
                  />
                ) : (
                  <>
                    {group.timeLabel && (
                      <div className="chat-time-separator">{group.timeLabel}</div>
                    )}
                    <div
                      className={`wechat-message-row ${group.isMine ? 'mine' : 'other'} grouped`}
                    >
                      {!group.isMine && (
                        <div className="message-avatar">
                          {contact.avatar ? (
                            <img src={contact.avatar} alt={name} />
                          ) : (
                            (name || '?').charAt(0)
                          )}
                        </div>
                      )}
                      <div className="message-stack">
                        {!group.isMine && showAuthors && (
                          <div className="message-sender-name">{name}</div>
                        )}
                        {group.messages.map((message, index) => {
                          const display = messagesById.get(message.id)!
                          return display.telegramMedia ? (
                            <div
                              key={message.id}
                              className={`message-bubble-wrap ${index ? 'is-followup' : ''}`}
                            >
                              <div className="message-bubble">
                                <TelegramMedia
                                  key={`${display.telegramMedia.type}:${display.telegramMedia.assetId || message.id}`}
                                  content={display.telegramMedia}
                                  context={context}
                                  onImageClick={setPreviewImage}
                                />
                                {display.caption && (
                                  <div className="message-text mt-2">{display.caption}</div>
                                )}
                              </div>
                              <span className="message-hover-time">
                                {formatMessageTime(message)}
                              </span>
                            </div>
                          ) : (
                            <MessageBubble
                              key={message.id}
                              message={message}
                              contact={contact}
                              isGroupChat={showAuthors}
                              isMine={group.isMine}
                              showAvatarSpace={index === 0}
                              onImageClick={setPreviewImage}
                            />
                          )
                        })}
                      </div>
                      {group.isMine && <div className="message-avatar mine-avatar">我</div>}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <ChatStatusBar
        count={filtered.length}
        isAtLatest={atLatest}
        onJumpToLatest={scrollToLatest}
      />
      {previewImage && (
        <ChatImageViewer imageUrl={previewImage} onClose={() => setPreviewImage(null)} />
      )}
      {sendDialog}
    </div>
  )
}
