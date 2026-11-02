import type { Message } from './types'

export interface PriorityWatchRule {
  conversationId: string
  groupName: string
  members: { id: string; name: string }[]
}

export interface PriorityWatchRequest {
  accountRoot: string
  conversationId: string
  senderIds: string[]
  /** Inclusive upper bound; the entire boundary second is deferred to the next page. */
  endTime?: number
}

export interface PriorityWatchPage {
  messages: Message[]
  nextEndTime: number | null
  scanned: number
}

export function isWatchedMessage(message: Message, senderIds: readonly string[]): boolean {
  // Display names are not identities, including the legacy `name` field.
  return Boolean(message.senderId && senderIds.includes(message.senderId))
}
