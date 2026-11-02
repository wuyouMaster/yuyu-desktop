import { randomUUID } from 'node:crypto'
import type { AgentActivity } from '../../shared/agent-runtime'

const labels: Record<string, string> = {
  query_messages: '查询聊天消息',
  search_messages: '搜索关键词',
  message_context: '读取消息上下文',
  conversation_overview: '读取会话概览',
  plan_task: '制定任务计划',
  submit_plan: '保存执行计划',
  run_tasks: '执行子任务',
  load_skill: '加载工作方法',
  read_artifact: '读取任务结果'
}

function outcome(value: unknown): { state: AgentActivity['state']; summary: string } {
  let result = value
  if (typeof result === 'string') {
    try {
      result = JSON.parse(result)
    } catch {
      return { state: 'completed', summary: '调用已结束' }
    }
  }
  if (!result || typeof result !== 'object') return { state: 'completed', summary: '调用已结束' }
  const record = result as Record<string, unknown>
  const failed = typeof record.status === 'string' && /error|invalid|failed/.test(record.status)
  const count =
    record.returnedCount ??
    record.evidenceCount ??
    (Array.isArray(record.messages)
      ? record.messages.length
      : Array.isArray(record.evidence)
        ? record.evidence.length
        : undefined)
  const partial =
    record.truncated === true || (record.coverage as { state?: string })?.state === 'partial'
  return {
    state: failed ? 'failed' : partial ? 'partial' : 'completed',
    summary: failed
      ? '调用未成功，参数或数据条件不满足'
      : [
          typeof count === 'number' ? `返回 ${count} 条结果` : '调用已结束',
          partial ? '仅覆盖部分范围' : ''
        ]
          .filter(Boolean)
          .join('；')
  }
}
export class ActivityRecorder {
  private readonly items: AgentActivity[] = []
  constructor(private readonly changed: (items: AgentActivity[]) => void) {}
  snapshot(): AgentActivity[] {
    return structuredClone(this.items)
  }
  private emit(): void {
    this.changed(this.snapshot())
  }
  start(kind: AgentActivity['kind'], label: string, parentId?: string): string {
    const id = randomUUID()
    // Execution budgets keep normal runs below this bound. Preserve parents of visible children.
    if (this.items.length >= 100) return id
    this.items.push({
      id,
      kind,
      label: (labels[label] || label).slice(0, 300),
      parentId,
      state: 'running',
      startedAt: Date.now()
    })
    this.emit()
    return id
  }
  finish(id: string, state: AgentActivity['state'], summary?: string): void {
    const item = this.items.find((item) => item.id === id)
    if (!item || item.state !== 'running') return
    Object.assign(item, { state, summary: summary?.slice(0, 1200), endedAt: Date.now() })
    this.emit()
  }
  close(state: 'cancelled' | 'failed'): void {
    for (const item of this.items)
      if (item.state === 'running') Object.assign(item, { state, endedAt: Date.now() })
    this.emit()
  }
  async tool<T>(
    name: string,
    work: () => Promise<T>,
    signal: AbortSignal,
    parentId?: string,
    input?: unknown
  ): Promise<T> {
    const id = this.start('tool', name, parentId)
    if (input && typeof input === 'object') {
      const data = input as Record<string, unknown>
      const parts: string[] = []
      if (Array.isArray(data.queries))
        parts.push(
          '关键词：' +
            data.queries
              .filter((q) => typeof q === 'string')
              .slice(0, 4)
              .map((q) => q.slice(0, 60))
              .join('、')
        )
      const range = data.timeRange as { kind?: string } | undefined
      const times: Record<string, string> = {
        today: '今天',
        yesterday: '昨天',
        all: '全部时间',
        this_week: '本周',
        last_7_days: '最近七天',
        this_month: '本月',
        absolute: '指定时间范围'
      }
      if (range?.kind && times[range.kind]) parts.push('时间：' + times[range.kind])
      if (typeof data.limit === 'number') parts.push('最多 ' + data.limit + ' 条')
      const item = this.items.find((item) => item.id === id)
      if (item && parts.length) {
        item.inputSummary = parts.join('；')
        this.emit()
      }
    }

    try {
      const result = await work()
      const { state, summary } = outcome(result)
      this.finish(id, state, summary)
      return result
    } catch (error) {
      this.finish(
        id,
        signal.aborted ? 'cancelled' : 'failed',
        signal.aborted ? '调用已停止' : '调用失败'
      )
      throw error
    }
  }
}
