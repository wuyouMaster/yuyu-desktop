import { useEffect, useId, useRef, useState } from 'react'
import type { ProviderSnapshot } from '../../../../shared/data-source'
import type {
  TelegramHistoryQueueReason,
  TelegramHistoryQueueStatus
} from '../../../../shared/telegram-history'
import { sourceContextKey } from '../../../../shared/source-context'
import { Button } from '../../components/ui'
import { ArrowDownIcon, ConversationIcon, ExportIcon } from '../../components/chat/icons'

const reasons: Record<TelegramHistoryQueueReason, string> = {
  cancelled: '已取消',
  time_limit: '已达到 15 分钟上限',
  page_limit: '已达到页数上限',
  message_limit: '已达到消息数量上限',
  stalled: '历史没有继续推进，完整范围尚未确认',
  open_in_client: '此类会话需先在 Telegram 中打开后单独补载',
  read_failed: '读取失败，请在 Telegram 中检查后单独重试',
  source_changed: '账号、进程或数据源发生变化，已停止'
}
const states = {
  pending: '等待',
  running: '补载中',
  complete: '完整',
  partial: '部分',
  failed: '失败',
  skipped: '跳过'
}

export function TelegramAccountHistory({
  snapshot,
  busy,
  onBusyChange,
  onSettled
}: {
  snapshot?: ProviderSnapshot
  busy: boolean
  onBusyChange: (busy: boolean) => void
  onSettled: () => Promise<void>
}): React.ReactElement {
  const [status, setStatus] = useState<TelegramHistoryQueueStatus>()
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const helpId = useId()
  const latest = useRef(status)
  const mounted = useRef(false)
  const completed = useRef('')
  const revision = useRef(0)
  const lifetime = useRef(0)
  const callbacks = useRef({ onBusyChange, onSettled })
  callbacks.current = { onBusyChange, onSettled }
  const context = snapshot?.context
  const key = context ? sourceContextKey(context) : ''
  const running = status?.state === 'running' || status?.state === 'stopping'
  const available = Boolean(context && typeof window.api.startTelegramHistoryQueue === 'function')

  useEffect(() => {
    ++lifetime.current
    ++revision.current
    latest.current = undefined
    completed.current = ''
    setStatus(undefined)
    setStarting(false)
    setError('')
    if (!context || !available) return
    mounted.current = true
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async (): Promise<void> => {
      const observedRevision = revision.current
      try {
        const next = await window.api.getTelegramHistoryQueue({ expectedContext: context })
        if (!active || observedRevision !== revision.current) return
        latest.current = next
        setStatus(next)
        callbacks.current.onBusyChange(Boolean(next && next.state !== 'finished'))
        if (next?.state === 'finished' && completed.current !== next.jobId) {
          completed.current = next.jobId
          await callbacks.current.onSettled()
        }
        if (active) setError('')
      } catch (reason) {
        if (active && observedRevision === revision.current)
          setError(reason instanceof Error ? reason.message : '历史任务状态读取失败')
      } finally {
        if (active) timer = setTimeout(() => void poll(), 1000)
      }
    }
    void poll()
    return () => {
      active = false
      ++lifetime.current
      mounted.current = false
      clearTimeout(timer)
      const job = latest.current
      if (job && job.state !== 'finished')
        void window.api
          .cancelTelegramHistoryQueue({ expectedContext: context, jobId: job.jobId })
          .catch(() => undefined)
      callbacks.current.onBusyChange(false)
    }
    // Bind the lifetime to the source identity, not refreshed snapshot objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, available])

  const start = async (): Promise<void> => {
    if (!context || busy || starting || running) return
    const generation = lifetime.current
    const isCurrent = (): boolean => mounted.current && lifetime.current === generation
    setStarting(true)
    revision.current++
    setError('')
    callbacks.current.onBusyChange(true)
    try {
      const next = await window.api.startTelegramHistoryQueue({ expectedContext: context })
      if (!isCurrent()) {
        await window.api.cancelTelegramHistoryQueue({ expectedContext: context, jobId: next.jobId })
        return
      }
      latest.current = next
      setStatus(next)
    } catch (reason) {
      if (isCurrent()) {
        setError(reason instanceof Error ? reason.message : '启动历史任务失败')
        callbacks.current.onBusyChange(false)
      }
    } finally {
      if (isCurrent()) setStarting(false)
    }
  }
  const stop = async (): Promise<void> => {
    if (!context || !status) return
    const generation = lifetime.current
    const isCurrent = (): boolean => mounted.current && lifetime.current === generation
    revision.current++
    try {
      const next = await window.api.cancelTelegramHistoryQueue({
        expectedContext: context,
        jobId: status.jobId
      })
      if (isCurrent()) {
        latest.current = next
        setStatus(next)
      }
    } catch (reason) {
      if (isCurrent()) setError(reason instanceof Error ? reason.message : '停止历史任务失败')
    }
  }

  const done =
    status?.items.filter((item) => item.state !== 'pending' && item.state !== 'running').length ?? 0
  const snapshotDate = new Date(snapshot?.health.capturedAt ?? NaN)
  const capturedDate = Number.isNaN(snapshotDate.getTime()) ? undefined : snapshotDate
  const capturedLabel = capturedDate?.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  return (
    <section
      className="m-3 shrink-0 rounded-xl border border-solid border-[color:var(--yuyu-ui-glass-border)] bg-surface/80 text-sm"
      aria-label="Telegram 账号历史队列"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ConversationIcon className="h-5 w-5 fill-none stroke-current stroke-[1.6]" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 text-sm font-semibold text-foreground">Telegram 本地快照</h2>
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                历史可补载
              </span>
            </div>
            <p className="m-0 mt-1 text-xs leading-relaxed text-muted-foreground">
              仅包含已采集消息，尚非完整历史 · 媒体读取本地缓存
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {capturedDate && (
            <time
              dateTime={capturedDate.toISOString()}
              title={`读取时间：${capturedDate.toLocaleString('zh-CN')}`}
              className="whitespace-nowrap text-xs tabular-nums text-muted-foreground"
            >
              读取于 {capturedLabel}
            </time>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-muted-foreground"
            aria-expanded={showHelp}
            aria-controls={helpId}
            onClick={() => setShowHelp((value) => !value)}
          >
            补载说明
            <ArrowDownIcon
              className={`h-3.5 w-3.5 fill-none stroke-current stroke-2 transition-transform ${showHelp ? 'rotate-180' : ''}`}
            />
          </Button>
          <Button
            size="sm"
            className="gap-1.5 px-3"
            aria-label="补载当前账号全部会话"
            disabled={!available || busy || starting || running}
            onClick={() => void start()}
          >
            <ExportIcon className="h-3.5 w-3.5 fill-none stroke-current stroke-[1.8]" />
            {starting ? '正在启动…' : running ? '正在补载…' : '补载全部会话'}
          </Button>
          {running && (
            <Button
              variant="outline"
              size="sm"
              className="border-[color:var(--yuyu-ui-glass-border)]"
              disabled={status?.state === 'stopping'}
              onClick={() => void stop()}
            >
              {status?.state === 'stopping' ? '正在停止…' : '取消账号补载'}
            </Button>
          )}
        </div>
      </div>
      <div
        id={helpId}
        hidden={!showHelp}
        className="border-0 border-t border-solid border-[color:var(--yuyu-ui-glass-border)] px-4 py-3 text-xs leading-relaxed text-muted-foreground"
      >
        <p className="m-0">补载会依次打开 Telegram 中已发现的会话并滚动加载，可随时取消。</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="rounded-md bg-surface-muted px-2 py-1">本次上限 500 页 / 15 分钟</span>
          <span className="rounded-md bg-surface-muted px-2 py-1">单会话上限 100 页 / 5 万条</span>
          <span className="rounded-md bg-surface-muted px-2 py-1">媒体按需读取本地缓存</span>
        </div>
        <p className="m-0 mt-2">
          采集结果仅保留在本次连接中。未发现、无法打开或范围不完整的会话不会标记为完整。
        </p>
      </div>
      {status && (
        <details className="border-0 border-t border-solid border-[color:var(--yuyu-ui-glass-border)] px-4 py-2.5">
          <summary
            role="status"
            className="cursor-pointer text-xs leading-relaxed text-muted-foreground"
          >
            {status.state === 'finished'
              ? '账号补载已结束'
              : status.state === 'stopping'
                ? '正在停止，等待当前操作结束'
                : '账号补载中'}
            {` · ${done}/${status.items.length} 个会话 · ${status.pages} 页 · 新增 ${status.addedCount} 条`}
            {status.reason && ` · ${reasons[status.reason]}`}
          </summary>
          <ul className="m-0 mt-2 max-h-40 list-none space-y-1 overflow-y-auto p-0 text-xs">
            {status.items.map((item) => (
              <li key={item.conversationId} className="rounded-md bg-surface-muted px-3 py-2">
                {item.title} · {states[item.state]} · {item.pages} 页 · {item.messageCount} 条
                {item.reason && ` · ${reasons[item.reason]}`}
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && (
        <p
          role="alert"
          className="m-0 border-0 border-t border-solid border-[color:var(--yuyu-ui-glass-border)] px-4 py-2.5 text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </section>
  )
}
