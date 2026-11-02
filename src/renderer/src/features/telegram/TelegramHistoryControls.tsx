import { useEffect, useRef, useState } from 'react'
import type { TelegramHistoryRequest } from '../../../../shared/telegram-history'
import type { ProviderSnapshot } from '../../../../shared/data-source'
import { Button } from '../../components/ui'

const MAX_PAGES = 100
const MAX_DURATION_MS = 5 * 60 * 1000
const MAX_EMPTY_PAGES = 3

export function TelegramHistoryControls({
  conversationId,
  snapshot,
  busy,
  onBusyChange,
  onSettled
}: {
  conversationId: TelegramHistoryRequest['conversationId']
  snapshot?: ProviderSnapshot
  busy: boolean
  onBusyChange: (busy: boolean) => void
  onSettled: () => Promise<void>
}): React.ReactElement {
  const mounted = useRef(false)
  const operation = useRef<{ stopReason?: string } | null>(null)
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState({ pages: 0, added: 0, count: 0 })
  const available = Boolean(
    snapshot?.context &&
    snapshot.health.available &&
    typeof window.api.loadTelegramHistory === 'function'
  )

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (operation.current) operation.current.stopReason = '会话已切换，已停止继续翻页'
    }
  }, [])

  const stop = (): void => {
    if (!operation.current) return
    operation.current.stopReason = '已取消补载，历史范围尚未确认'
    setStopping(true)
    setStatus('正在停止，等待当前翻页结束后刷新快照…')
  }

  const start = async (mode: TelegramHistoryRequest['direction'] | 'complete'): Promise<void> => {
    if (!available || busy || operation.current || !snapshot?.context) return
    const current: { stopReason?: string } = {}
    operation.current = current
    onBusyChange(true)
    setRunning(true)
    setStopping(false)
    setStatus('正在补载…')
    setProgress({ pages: 0, added: 0, count: 0 })
    const startedAt = Date.now()
    const timer = window.setTimeout(() => {
      current.stopReason = '已达到 5 分钟上限，历史范围尚未确认'
      if (mounted.current) {
        setStopping(true)
        setStatus('已达到 5 分钟上限，等待当前翻页结束后刷新快照…')
      }
    }, MAX_DURATION_MS)
    let emptyPages = 0
    let added = 0
    let direction: TelegramHistoryRequest['direction'] = mode === 'complete' ? 'older' : mode
    let outcome = '已达到 100 页上限，历史范围尚未确认'
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        if (current.stopReason) break
        if (Date.now() - startedAt >= MAX_DURATION_MS) {
          current.stopReason = '已达到 5 分钟上限，历史范围尚未确认'
          break
        }
        const result = await window.api.loadTelegramHistory({
          conversationId,
          expectedContext: snapshot.context,
          direction
        })
        added += result.addedCount
        if (mounted.current) setProgress({ pages: page + 1, added, count: result.messageCount })
        if (current.stopReason) break
        if (result.complete === true) {
          outcome = '历史已完整加载'
          break
        }
        if (direction === 'older' ? result.reachedStart : result.reachedEnd) {
          if (mode === 'complete' && direction === 'older') {
            direction = 'newer'
            emptyPages = 0
            if (mounted.current) setStatus('已到达历史起点，正在补载较新消息…')
            continue
          }
          outcome =
            direction === 'older'
              ? '已到达历史起点，另一端范围尚未确认'
              : '已到达最新一端，较早历史范围尚未确认'
          break
        }
        emptyPages = (result.advanced ?? result.addedCount > 0) ? 0 : emptyPages + 1
        if (emptyPages >= MAX_EMPTY_PAGES) {
          outcome = '连续 3 页无历史推进，已停止；历史范围尚未确认'
          break
        }
      }
    } catch (reason) {
      outcome = `补载失败：${reason instanceof Error ? reason.message : 'Telegram 历史读取失败'}`
    } finally {
      window.clearTimeout(timer)
      try {
        // Each history call already merges into the provider. Re-read that
        // snapshot; reconnecting here would replace the pinned source context.
        await onSettled()
      } catch {
        outcome = `${current.stopReason || outcome}；会话或消息刷新失败，请刷新重试`
        current.stopReason = undefined
      } finally {
        operation.current = null
        onBusyChange(false)
        if (mounted.current) {
          setStatus(current.stopReason || outcome)
          setRunning(false)
          setStopping(false)
        }
      }
    }
  }

  return (
    <section
      className="shrink-0 border-b border-border px-4 py-3 text-sm"
      aria-label="Telegram 历史补载"
    >
      <p className="text-muted-foreground">
        补载将操作 Telegram 客户端打开当前会话并滚动。自动翻页最多 100 页或 5
        分钟，可随时取消后续翻页。
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!available || busy}
          onClick={() => void start('complete')}
        >
          补载此会话完整历史
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!available || busy}
          onClick={() => void start('older')}
        >
          补载更早历史
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!available || busy}
          onClick={() => void start('newer')}
        >
          补载较新消息
        </Button>
        {running && (
          <Button variant="outline" size="sm" disabled={stopping} onClick={stop}>
            {stopping ? '正在停止…' : '取消补载'}
          </Button>
        )}
      </div>
      {!available && (
        <p className="mt-2 text-muted-foreground">
          {snapshot?.health.available
            ? '历史补载接口或数据源上下文尚未就绪'
            : snapshot?.health.message || 'Telegram 本地读取不可用'}
        </p>
      )}
      {status && (
        <p role="status" className="mt-2">
          {status}
          {progress.pages > 0 &&
            ` · 已翻 ${progress.pages} 页，新增 ${progress.added} 条，快照共 ${progress.count} 条`}
        </p>
      )}
    </section>
  )
}
