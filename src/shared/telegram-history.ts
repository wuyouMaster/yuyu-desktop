import type { EntityId } from './entity-id'
import type { SourceOperationContext } from './source-context'

export interface TelegramHistoryRequest {
  conversationId: EntityId
  expectedContext: SourceOperationContext
  direction: 'older' | 'newer'
}

export interface TelegramHistoryResult {
  addedCount: number
  /** Directional blocks progress; incoming newer messages do not advance older paging. */
  advanced?: boolean
  messageCount: number
  reachedStart: boolean
  reachedEnd: boolean
  /** Only true when the client reports both boundaries for a contiguous history. */
  complete: boolean
}

export interface TelegramMediaLoadRequest {
  assetId: EntityId
  expectedContext: SourceOperationContext
}

export interface TelegramHistoryQueueRequest {
  expectedContext: SourceOperationContext
  /** Required for cancellation so a stale window cannot cancel a newer run. */
  jobId?: string
}

export const TELEGRAM_HISTORY_QUEUE_LIMITS = {
  conversations: 2000,
  pages: 500,
  pagesPerConversation: 100,
  durationMs: 15 * 60 * 1000,
  messages: 200000,
  messagesPerConversation: 50000,
  stalledPages: 3
} as const

export type TelegramHistoryQueueReason =
  | 'cancelled'
  | 'time_limit'
  | 'page_limit'
  | 'message_limit'
  | 'stalled'
  | 'open_in_client'
  | 'read_failed'
  | 'source_changed'

export interface TelegramHistoryQueueItem {
  conversationId: EntityId
  title: string
  state: 'pending' | 'running' | 'complete' | 'partial' | 'failed' | 'skipped'
  pages: number
  addedCount: number
  messageCount: number
  reason?: TelegramHistoryQueueReason
}

export interface TelegramHistoryQueueStatus {
  jobId: string
  state: 'running' | 'stopping' | 'finished'
  startedAt: number
  finishedAt?: number
  pages: number
  addedCount: number
  messageCount: number
  reason?: TelegramHistoryQueueReason
  items: TelegramHistoryQueueItem[]
}
