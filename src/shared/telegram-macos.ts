import type { EntityId } from './entity-id'

/** Native Telegram for macOS is a separate, read-only local data source. */
export interface TelegramMacOSInspection {
  clientType: 'telegram-macos'
  state: 'detected' | 'not_found' | 'unsupported_platform' | 'unavailable'
  message: string
  candidates: Array<{ id: string; label: string }>
}

export interface TelegramMacOSConnection {
  accountId: EntityId
  accountLabel: string
  /** Number of conversations in the initial page, not the full account total. */
  conversationCount: number
  /** Messages are read on demand after selecting a conversation. */
  messageCount: number
}
