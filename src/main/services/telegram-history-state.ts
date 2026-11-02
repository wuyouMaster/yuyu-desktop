import type { TelegramExportConversation } from '../../shared/telegram-export'

type History = TelegramExportConversation['runtimeHistory']

/** Only the current blocks window can authorize replacement of accumulated pages. */
export function hasCompleteTelegramHistory(chat: TelegramExportConversation): boolean {
  const history = chat.runtimeHistory
  if (
    history?.loadState !== 'idle' ||
    !history.loadedAtTop ||
    !history.loadedAtBottom ||
    !history.blockMessageIds
  )
    return false
  const present = new Set(chat.messages.map((message) => message.id))
  return history.blockMessageIds.every((id) => present.has(id))
}

/** An old producer or pending request must never make a boundary look final. */
export function effectiveTelegramHistory(history: History): History {
  if (!history) return undefined
  if (history.loadState === 'idle' && history.blockMessageIds) return history
  return { ...history, loadedAtTop: false, loadedAtBottom: false }
}
