import { useState } from 'react'
import type { AgentActivity } from '../../../../shared/agent-runtime'

const status = {
  running: '进行中',
  completed: '完成',
  partial: '部分完成',
  failed: '失败',
  cancelled: '已停止'
}
function ActivityItem({
  item,
  items
}: {
  item: AgentActivity
  items: AgentActivity[]
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const children = items.filter((candidate) => candidate.parentId === item.id)
  return (
    <details
      className="conversation-ai-activity-item"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className={'conversation-ai-activity-state is-' + item.state} aria-hidden="true" />
        <span className="conversation-ai-activity-label">{item.label}</span>
        <span className="conversation-ai-activity-meta">
          {status[item.state]}
          {item.endedAt ? ' · ' + ((item.endedAt - item.startedAt) / 1000).toFixed(1) + 's' : ''}
        </span>
      </summary>
      <div className="conversation-ai-activity-detail">
        {item.inputSummary && <p>{item.inputSummary}</p>}
        {item.summary ? (
          <p>{item.summary}</p>
        ) : (
          <p>{item.state === 'running' ? '等待执行结果…' : '没有额外结果摘要'}</p>
        )}
        {children.map((child) => (
          <ActivityItem key={child.id} item={child} items={items} />
        ))}
      </div>
    </details>
  )
}
export function ExecutionActivity({
  items
}: {
  items?: AgentActivity[]
}): React.ReactElement | null {
  const [open, setOpen] = useState(true)
  if (!items?.length) return null
  const roots = items.filter(
    (item) => !item.parentId || !items.some((parent) => parent.id === item.parentId)
  )
  const running = items.filter((item) => item.state === 'running').length
  return (
    <details
      className="conversation-ai-activity"
      open={open}
      onToggle={(event) => {
        if (event.target === event.currentTarget) setOpen(event.currentTarget.open)
      }}
    >
      <summary>
        执行过程 · {items.length} 项{running ? ' · 正在执行' : ' · 已结束'}
      </summary>
      <div aria-label="执行记录">
        {roots.map((item) => (
          <ActivityItem key={item.id} item={item} items={items} />
        ))}
      </div>
    </details>
  )
}
