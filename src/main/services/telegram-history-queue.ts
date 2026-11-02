import { randomUUID } from 'node:crypto'
import {
  TELEGRAM_HISTORY_QUEUE_LIMITS,
  type TelegramHistoryQueueItem,
  type TelegramHistoryQueueReason,
  type TelegramHistoryQueueStatus,
  type TelegramHistoryResult
} from '../../shared/telegram-history'

/** The caller holds Telegram's global UI lock until run() drains, including cancellation. */
export class TelegramHistoryQueue {
  readonly controller = new AbortController()
  private readonly status: TelegramHistoryQueueStatus

  constructor(
    items: Array<Pick<TelegramHistoryQueueItem, 'conversationId' | 'title' | 'messageCount'>>,
    private readonly limits: {
      [K in keyof typeof TELEGRAM_HISTORY_QUEUE_LIMITS]: number
    } = TELEGRAM_HISTORY_QUEUE_LIMITS
  ) {
    if (items.length > limits.conversations) throw new Error('Telegram 会话数量超过补载上限')
    this.status = {
      jobId: randomUUID(),
      state: 'running',
      startedAt: Date.now(),
      pages: 0,
      addedCount: 0,
      messageCount: items.reduce((sum, item) => sum + item.messageCount, 0),
      items: items.map((item) => ({ ...item, state: 'pending', pages: 0, addedCount: 0 }))
    }
  }

  snapshot(): TelegramHistoryQueueStatus {
    return structuredClone(this.status)
  }

  cancel(reason: TelegramHistoryQueueReason = 'cancelled'): void {
    if (this.status.state === 'finished') return
    this.status.reason ??= reason
    this.status.state = 'stopping'
    this.controller.abort()
  }

  /** Also handles failures before run begins (initial identity check or busy lock). */
  fail(): void {
    this.status.reason ??= 'read_failed'
    this.finish()
  }

  private finish(): void {
    for (const item of this.status.items) {
      if (item.state === 'pending' || item.state === 'running') {
        item.state = item.state === 'running' ? 'partial' : 'skipped'
        item.reason = this.status.reason ?? 'read_failed'
      }
    }
    this.status.state = 'finished'
    this.status.finishedAt = Date.now()
  }

  async run(options: {
    signal: AbortSignal
    canOpen: (item: TelegramHistoryQueueItem) => boolean
    step: (
      item: TelegramHistoryQueueItem,
      direction: 'older' | 'newer',
      signal: AbortSignal
    ) => Promise<TelegramHistoryResult>
    /** Re-read connection/process identity even after a failed or skipped conversation. */
    verify: () => Promise<void>
    messageCount: () => number
  }): Promise<void> {
    const abort = (): void => this.cancel('source_changed')
    options.signal.addEventListener('abort', abort, { once: true })
    if (options.signal.aborted) abort()
    const timer = setTimeout(() => this.cancel('time_limit'), this.limits.durationMs)
    const limited = (): boolean => {
      if (this.controller.signal.aborted) return true
      if (Date.now() - this.status.startedAt >= this.limits.durationMs) this.cancel('time_limit')
      else if (this.status.pages >= this.limits.pages) this.cancel('page_limit')
      else if (this.status.messageCount >= this.limits.messages) this.cancel('message_limit')
      return this.controller.signal.aborted
    }
    try {
      for (const item of this.status.items) {
        if (limited()) break
        await options.verify()
        if (limited()) break
        if (!options.canOpen(item)) {
          item.state = 'skipped'
          item.reason = 'open_in_client'
          continue
        }
        item.state = 'running'
        let direction: 'older' | 'newer' = 'older'
        let stalled = 0
        while (!limited()) {
          if (item.pages >= this.limits.pagesPerConversation) {
            item.reason = 'page_limit'
            break
          }
          if (item.messageCount >= this.limits.messagesPerConversation) {
            item.reason = 'message_limit'
            break
          }
          let result: TelegramHistoryResult
          try {
            result = await options.step(item, direction, this.controller.signal)
          } catch {
            if (!this.controller.signal.aborted) {
              // A changed PID/account is fatal to the entire queue. A peer-specific
              // failure may proceed only after a fresh account/process check.
              await options.verify()
              item.state = 'failed'
              item.reason = 'read_failed'
            }
            break
          }
          item.pages++
          item.addedCount += result.addedCount
          item.messageCount = result.messageCount
          this.status.pages++
          this.status.addedCount += result.addedCount
          this.status.messageCount = options.messageCount()
          if (this.controller.signal.aborted) break
          if (result.complete) {
            item.state = 'complete'
            break
          }
          if (direction === 'older' && result.reachedStart) {
            direction = 'newer'
            stalled = 0
            continue
          }
          if (direction === 'newer' && result.reachedEnd) {
            // Separate observed edges never prove that no gap remains.
            item.reason = 'stalled'
            break
          }
          stalled = result.advanced ? 0 : stalled + 1
          if (stalled >= this.limits.stalledPages) {
            item.reason = 'stalled'
            break
          }
        }
        if (item.state === 'running') {
          item.state = 'partial'
          item.reason ??= this.status.reason ?? 'stalled'
        }
      }
    } catch {
      this.status.reason ??= 'source_changed'
    } finally {
      clearTimeout(timer)
      options.signal.removeEventListener('abort', abort)
      this.finish()
    }
  }
}
