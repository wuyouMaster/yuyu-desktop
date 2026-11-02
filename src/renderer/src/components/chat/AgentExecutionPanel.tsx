import type { AgentExecutionView } from '../../../../shared/agent-runtime'
import { Button } from '../ui'

const statusLabels = {
  queued: '等待',
  running: '进行中',
  completed: '完成',
  partial: '部分完成',
  failed: '失败',
  cancelled: '已停止'
}
const skills: Record<string, string> = {
  'explain-quotes': '解释引用',
  'summarize-conversation': '聊天总结',
  'extract-action-items': '提取待办',
  'compare-discussions': '比较讨论',
  'build-timeline': '整理时间线'
}
export function AgentExecutionPanel({
  execution,
  disabled,
  onResume
}: {
  execution?: AgentExecutionView
  disabled: boolean
  onResume: () => void
}): React.ReactElement | null {
  if (!execution || (!execution.steps.length && !execution.skills.length)) return null
  return (
    <div className="conversation-ai-execution" aria-label="任务进度">
      {execution.steps.length > 0 && (
        <details open>
          <summary>
            执行计划 · {execution.steps.filter((s) => s.state === 'completed').length}/
            {execution.steps.length}
          </summary>
          <ol>
            {execution.steps.map((step) => (
              <li key={step.id}>
                <span>{step.objective}</span>
                <small>{statusLabels[step.state]}</small>
              </li>
            ))}
          </ol>
        </details>
      )}
      {execution.skills.length > 0 && (
        <p>使用方法：{execution.skills.map((id) => skills[id] || id).join('、')}</p>
      )}
      {execution.resumable && (
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onResume}>
          {execution.state === 'planned' ? '按计划执行' : '继续未完成任务'}
        </Button>
      )}
    </div>
  )
}
