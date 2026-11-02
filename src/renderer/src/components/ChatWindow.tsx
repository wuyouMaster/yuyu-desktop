import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Message, Contact } from '../../../shared/types'
import { ChatHeader } from './chat/ChatHeader'
import { ChatImageViewer } from './chat/ChatImageViewer'
import { ChatStatusBar } from './chat/ChatStatusBar'
import { EmptyConversationState } from './chat/EmptyConversationState'
import { MessageList } from './chat/MessageList'
import { ChatSelectionAction } from './chat/ChatSelectionAction'
import type { ChatQuote } from './chat/chatQuote'
import { PersonalWechatSendDialog } from './chat/PersonalWechatSendDialog'
import { ImageKeyGuidanceContext } from './chat/image-key-guidance'
import { Button } from './ui'
import type { VirtualItem } from '@tanstack/react-virtual'
import {
  captureScrollAnchor,
  restoreScrollPosition,
  type ScrollAnchor
} from './chat/scrollPosition'

export interface ChatScrollPosition {
  scrollTop: number
  isAtLatest: boolean
  measurements?: VirtualItem[]
  anchor?: ScrollAnchor
}

interface ChatWindowProps {
  contact: Contact | null
  messages: Message[]
  isLoadingMessages?: boolean
  messageHistoryStatus?: 'idle' | 'end' | 'error'
  contentFilter?: string
  onContentFilterChange?: (keyword: string) => void
  onRefresh?: () => void
  onLoadOlderMessages?: () => Promise<void>
  onCreateGroupReport?: () => void
  onOpenConversationAI?: () => void
  onQuoteToAI?: (quotes: ChatQuote[]) => void
  onOpenTextToSpeechSettings?: () => void
  onOpenPersonalWechatSettings?: () => void
  onOpenImageSettings?: (position: ChatScrollPosition) => void
  initialScrollPosition?: ChatScrollPosition
  onScrollPositionRestored?: () => void
  showSendAction?: boolean
  sendActionSupported?: boolean
  sendUnavailableReason?: string
  sendLabel?: string
  onOpenSend?: () => void
  sendDialog?: React.ReactNode
  showConversationAI?: boolean
  showReportAction?: boolean
  statusLabel?: string
  isAiLoading?: boolean
  jumpToTime?: number | null
  /** 精确跳转目标（消息 id）。与 jumpToTime 取或：任一存在就说明"这是一次跳转"。 */
  jumpToMessageId?: string | null
}

const ChatWindow: React.FC<ChatWindowProps> = ({
  contact,
  messages,
  isLoadingMessages,
  messageHistoryStatus,
  contentFilter,
  onContentFilterChange,
  onRefresh,
  onLoadOlderMessages,
  onCreateGroupReport,
  onOpenConversationAI,
  onQuoteToAI,
  onOpenTextToSpeechSettings,
  onOpenPersonalWechatSettings,
  onOpenImageSettings,
  initialScrollPosition,
  onScrollPositionRestored,
  showSendAction = true,
  sendActionSupported,
  sendUnavailableReason,
  sendLabel,
  onOpenSend,
  sendDialog,
  showConversationAI = true,
  showReportAction = true,
  statusLabel,
  isAiLoading = false,
  jumpToTime,
  jumpToMessageId
}) => {
  const isGroupChat = Boolean(
    contact?.type === 'group' || contact?.m_nsUsrName?.endsWith('@chatroom')
  )
  const messageListRef = useRef<HTMLDivElement>(null)
  const measurementSnapshotRef = useRef<(() => VirtualItem[]) | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const initialPositionRef = useRef(initialScrollPosition)
  const [isAtLatest, setIsAtLatest] = useState(initialScrollPosition?.isAtLatest ?? true)
  const [sendDialogOpen, setSendDialogOpen] = useState(false)
  const previousScrollTopRef = useRef(0)
  const restoringPositionRef = useRef(false)
  const stopRestorationRef = useRef<(() => void) | undefined>(undefined)
  const [imageKeyConfigured, setImageKeyConfigured] = useState<boolean | null>(null)
  const [lockedImages, setLockedImages] = useState(0)
  const imageGuidanceEnabled = Boolean(onOpenImageSettings)

  useEffect(() => {
    if (!imageGuidanceEnabled) return
    let disposed = false
    setImageKeyConfigured(null)
    void window.api
      .getImageDecryptionStatus?.()
      .then((status) => {
        if (!disposed) setImageKeyConfigured(status.configured)
      })
      .catch(() => undefined)
    return () => {
      disposed = true
    }
  }, [imageGuidanceEnabled, contact?.md5])

  const registerLockedImage = useCallback(() => {
    setLockedImages((count) => count + 1)
    return () => setLockedImages((count) => count - 1)
  }, [])
  const openImageSettings = useCallback(() => {
    onOpenImageSettings?.({
      scrollTop: messageListRef.current?.scrollTop ?? 0,
      isAtLatest,
      measurements: measurementSnapshotRef.current?.(),
      anchor: messageListRef.current ? captureScrollAnchor(messageListRef.current) : undefined
    })
  }, [onOpenImageSettings, isAtLatest])
  const imageGuidance = React.useMemo(
    () =>
      imageGuidanceEnabled
        ? {
            configured: imageKeyConfigured,
            onOpenSettings: openImageSettings,
            registerLockedImage
          }
        : null,
    [imageGuidanceEnabled, imageKeyConfigured, openImageSettings, registerLockedImage]
  )

  const scrollToBottom = useCallback((): void => {
    stopRestorationRef.current?.()
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
    setIsAtLatest(true)
  }, [])

  const handleMessageListScroll = useCallback((event: React.UIEvent<HTMLDivElement>): void => {
    const target = event.currentTarget
    if (restoringPositionRef.current) return
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight
    if (distanceToBottom <= 24) {
      setIsAtLatest(true)
    } else if (target.scrollTop < previousScrollTopRef.current - 1) {
      setIsAtLatest(false)
    }
    previousScrollTopRef.current = target.scrollTop
  }, [])

  useLayoutEffect(() => {
    const position = initialPositionRef.current
    previousScrollTopRef.current = position?.scrollTop ?? 0
    setIsAtLatest(position?.isAtLatest ?? true)
    if (!position) return
    const list = messageListRef.current
    if (!list || position.isAtLatest) {
      onScrollPositionRestored?.()
      return
    }
    restoringPositionRef.current = true
    const stop = restoreScrollPosition(
      list,
      position,
      () => onScrollPositionRestored?.(),
      () => {
        restoringPositionRef.current = false
        previousScrollTopRef.current = list.scrollTop
      }
    )
    stopRestorationRef.current = stop
    return () => {
      stop()
      stopRestorationRef.current = undefined
    }
  }, [contact?.md5])

  // 一次跳转 = 有精确目标或有时间目标。用统一判据，避免"只带了 messageId 但没带时间"
  // 时自动滚到底把跳转结果顶掉。
  const hasJumpTarget =
    (jumpToTime !== undefined && jumpToTime !== null) ||
    (jumpToMessageId !== undefined && jumpToMessageId !== null)

  useEffect(() => {
    if (hasJumpTarget) {
      stopRestorationRef.current?.()
      setIsAtLatest(false)
    }
  }, [hasJumpTarget])

  useEffect(() => {
    if (!isAtLatest || hasJumpTarget) return
    const frame = window.requestAnimationFrame(() => scrollToBottom())
    return () => window.cancelAnimationFrame(frame)
  }, [isAtLatest, hasJumpTarget, messages, scrollToBottom])

  useEffect(() => {
    if (!isAtLatest || hasJumpTarget) return
    const content = messageListRef.current?.querySelector('.virtual-message-list')
    if (!content) return
    const observer = new ResizeObserver(() => scrollToBottom())
    observer.observe(content)
    return () => observer.disconnect()
  }, [contact?.md5, isAtLatest, hasJumpTarget, scrollToBottom])

  const openImagePreview = (imageUrl: string): void => {
    setPreviewImage(imageUrl)
  }

  const closeImagePreview = (): void => {
    setPreviewImage(null)
  }

  const filteredMessages = React.useMemo(() => {
    return messages.filter((msg) => {
      const filterTypes = (import.meta.env.VITE_FILTER_MSG_TYPES || '')
        .split(',')
        .map((type) => type.trim())
        .filter(Boolean)
      const typeMatch = !filterTypes.includes(msg.type)
      const contentMatch = !contentFilter || msg.content.includes(contentFilter)
      return typeMatch && contentMatch
    })
  }, [messages, contentFilter])

  const handleOpenPersonalWechatSend = useCallback(async (): Promise<void> => {
    if (onOpenSend) {
      onOpenSend()
      return
    }
    try {
      const status = await window.api.getPersonalWechatSenderStatus()
      if (!status.canSendText && !status.canSendVoice) {
        if (onOpenPersonalWechatSettings) {
          onOpenPersonalWechatSettings()
          return
        }
      }
    } catch {
      if (onOpenPersonalWechatSettings) {
        onOpenPersonalWechatSettings()
        return
      }
    }
    setSendDialogOpen(true)
  }, [onOpenPersonalWechatSettings, onOpenSend])

  if (!contact) return <EmptyConversationState />

  return (
    <ImageKeyGuidanceContext.Provider value={imageGuidance}>
      <div className="chat-window">
        <ChatHeader
          contact={contact}
          isGroupChat={isGroupChat}
          loadedCount={messages.length}
          filteredCount={filteredMessages.length}
          contentFilter={contentFilter || ''}
          isAiLoading={isAiLoading}
          onContentFilterChange={onContentFilterChange || (() => undefined)}
          onRefresh={onRefresh}
          onTestSend={() => void handleOpenPersonalWechatSend()}
          onOpenConversationAI={onOpenConversationAI}
          onOpenAiSettings={onCreateGroupReport || (() => undefined)}
          showSendAction={showSendAction}
          sendActionSupported={sendActionSupported}
          sendUnavailableReason={sendUnavailableReason}
          sendLabel={sendLabel}
          showConversationAI={showConversationAI}
          showReportAction={showReportAction}
          statusLabel={statusLabel}
        />
        {imageGuidanceEnabled && lockedImages > 0 && (
          <div className="chat-image-key-notice" role="status">
            <p>图片需要单独配置密钥才能查看。获取成功后，请记得保存。</p>
            <Button variant="outline" size="sm" onClick={openImageSettings}>
              去获取图片密钥
            </Button>
          </div>
        )}
        <MessageList
          contact={contact}
          messages={filteredMessages}
          hiddenMessageCount={0}
          isLoadingMessages={isLoadingMessages}
          messageHistoryStatus={messageHistoryStatus}
          isGroupChat={isGroupChat}
          showAvatar
          listRef={messageListRef}
          bottomRef={messagesEndRef}
          onScroll={handleMessageListScroll}
          onReachTop={onLoadOlderMessages}
          onImageClick={openImagePreview}
          jumpToTime={jumpToTime}
          jumpToMessageId={jumpToMessageId}
          initialScrollTop={initialPositionRef.current?.scrollTop}
          initialMeasurements={initialPositionRef.current?.measurements}
          measurementSnapshotRef={measurementSnapshotRef}
        />
        <ChatStatusBar
          count={filteredMessages.length}
          isAtLatest={isAtLatest}
          onJumpToLatest={scrollToBottom}
        />
        {onQuoteToAI && <ChatSelectionAction listRef={messageListRef} onQuote={onQuoteToAI} />}

        {sendDialogOpen && (
          <PersonalWechatSendDialog
            contact={contact}
            isGroupChat={isGroupChat}
            onClose={() => setSendDialogOpen(false)}
            onOpenTextToSpeechSettings={onOpenTextToSpeechSettings}
            onOpenPersonalWechatSettings={onOpenPersonalWechatSettings}
          />
        )}
        {sendDialog}

        {previewImage && <ChatImageViewer imageUrl={previewImage} onClose={closeImagePreview} />}
      </div>
    </ImageKeyGuidanceContext.Provider>
  )
}
export default ChatWindow
