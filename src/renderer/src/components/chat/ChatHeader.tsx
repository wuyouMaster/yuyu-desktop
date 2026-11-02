import { useSourceScope } from '../../features/data-sources/source-context'
import React, { useState } from 'react'
import { Contact } from '../../../../shared/types'
import { Button, IconButton, Tooltip, TooltipContent, TooltipTrigger } from '../ui'
import { ConversationContentSearch } from './ConversationContentSearch'
import { ConversationIcon, HomeIcon, RefreshIcon, ReportIcon, SearchIcon, SendIcon } from './icons'
import { supportsPersonalWechatSend } from '../../utils/runtime-environment'

interface ChatHeaderProps {
  contact: Contact
  isGroupChat: boolean
  loadedCount: number
  filteredCount: number
  contentFilter: string
  isAiLoading: boolean
  onContentFilterChange: (value: string) => void
  onRefresh?: () => void
  onTestSend?: () => void
  onOpenConversationAI?: () => void
  onOpenAiSettings?: () => void
  showSendAction?: boolean
  sendActionSupported?: boolean
  sendUnavailableReason?: string
  sendLabel?: string
  showConversationAI?: boolean
  showReportAction?: boolean
  statusLabel?: string
}

export function ChatHeader({
  contact,
  isGroupChat,
  loadedCount,
  filteredCount,
  contentFilter,
  isAiLoading,
  onContentFilterChange,
  onRefresh,
  onTestSend,
  onOpenConversationAI,
  onOpenAiSettings,
  showSendAction = true,
  sendActionSupported = supportsPersonalWechatSend,
  sendUnavailableReason = '仅支持 macOS 和 Windows',
  sendLabel: requestedSendLabel,
  showConversationAI = true,
  showReportAction = true,
  statusLabel
}: ChatHeaderProps): React.ReactElement {
  const scope = useSourceScope()
  const sendLabel = requestedSendLabel || (scope ? `${scope.active.sourceLabel}发送` : '发送消息')
  const [searchOpen, setSearchOpen] = useState(Boolean(contentFilter))
  const displayName = contact.m_nsNickName || contact.m_nsUsrName || '未命名会话'
  const typeLabel = isGroupChat ? '群聊' : '联系人'
  const visibleCount = contentFilter ? filteredCount : loadedCount

  const handleCloseSearch = (): void => {
    onContentFilterChange('')
    setSearchOpen(false)
  }

  return (
    <div className={`chat-archive-header${searchOpen ? ' is-searching' : ''}`}>
      <div className="chat-title-block">
        <div className="chat-title-avatar">
          {contact.avatar ? (
            <img src={contact.avatar} alt={displayName} referrerPolicy="no-referrer" />
          ) : (
            displayName.charAt(0)
          )}
        </div>
        <div className="chat-title-text">
          <div className="chat-title-heading">
            <h2 title={displayName}>{displayName}</h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="chat-privacy-hint" tabIndex={0} aria-label="聊天记录仅在本机读取">
                  <HomeIcon />
                </span>
              </TooltipTrigger>
              <TooltipContent>聊天记录仅在本机读取</TooltipContent>
            </Tooltip>
          </div>
          <div className="chat-title-meta">
            <span title={typeLabel}>{statusLabel || '数据库已连接'}</span>
            <span>{visibleCount} 条消息</span>
          </div>
        </div>
      </div>
      <div className="chat-header-actions">
        {searchOpen ? (
          <ConversationContentSearch
            value={contentFilter}
            resultCount={filteredCount}
            onChange={onContentFilterChange}
            onClose={handleCloseSearch}
          />
        ) : (
          <IconButton
            label="搜索当前聊天"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => setSearchOpen(true)}
          >
            <SearchIcon />
          </IconButton>
        )}
        <IconButton label="刷新聊天记录" variant="ghost" className="h-8 w-8" onClick={onRefresh}>
          <RefreshIcon />
        </IconButton>
        {showSendAction &&
          (sendActionSupported ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="chat-header-text-action"
                  aria-label={sendLabel}
                  onClick={onTestSend}
                >
                  <SendIcon />
                  <span>{sendLabel}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{sendLabel}：向当前会话发送消息</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                  <span tabIndex={0} aria-label={sendUnavailableReason}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="chat-header-text-action"
                    aria-label={sendLabel}
                    onClick={onTestSend}
                    disabled
                  >
                    <SendIcon />
                    <span>{sendLabel}</span>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{sendLabel}：{sendUnavailableReason}</TooltipContent>
            </Tooltip>
          ))}
        {showConversationAI && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="chat-header-text-action"
                aria-label="问这个聊天"
                onClick={onOpenConversationAI}
              >
                <ConversationIcon />
                <span>问这个聊天</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>打开或收起 AI 助手（Esc 收起）</TooltipContent>
          </Tooltip>
        )}
        {showReportAction && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex" tabIndex={isAiLoading ? 0 : undefined}>
                <Button
                  variant="default"
                  size="sm"
                  className="chat-header-text-action"
                  aria-label={isAiLoading ? '生成中' : '生成 AI 日报'}
                  onClick={onOpenAiSettings}
                  disabled={isAiLoading}
                  aria-busy={isAiLoading}
                >
                  <ReportIcon />
                  <span>{isAiLoading ? '生成中' : '生成 AI 日报'}</span>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {isAiLoading
                ? 'AI 日报正在生成中'
                : isGroupChat
                  ? '生成 AI 日报：配置并总结当前群聊'
                  : 'AI 日报当前仅支持群聊'}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
