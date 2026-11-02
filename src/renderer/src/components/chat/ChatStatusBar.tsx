import React from 'react'
import { Button } from '../ui'

interface ChatStatusBarProps {
  count: number
  isAtLatest: boolean
  onJumpToLatest: () => void
}

export function ChatStatusBar({
  count,
  isAtLatest,
  onJumpToLatest
}: ChatStatusBarProps): React.ReactElement {
  const jumpDisabled = isAtLatest || count === 0

  return (
    <div className="chat-status-bar">
      <div>已显示当前范围 {count} 条消息</div>
      <div className="chat-status-actions">
        <Button variant="ghost" size="sm" onClick={onJumpToLatest} disabled={jumpDisabled}>
          {jumpDisabled ? '已是最新消息' : '跳转到最新消息'}
        </Button>
      </div>
    </div>
  )
}
