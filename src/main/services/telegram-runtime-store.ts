import type { TelegramExportDocument } from '../../shared/telegram-export'
import { effectiveTelegramHistory, hasCompleteTelegramHistory } from './telegram-history-state'

/** Preserve evicted pages until a complete current blocks window can replace them. */
export function mergeTelegramRuntimeDocuments(
  previous: TelegramExportDocument | undefined,
  next: TelegramExportDocument
): TelegramExportDocument {
  if (!previous) return next
  if (
    previous.origin !== 'runtime' ||
    next.origin !== 'runtime' ||
    previous.accountKey !== next.accountKey ||
    previous.accountNativeId !== next.accountNativeId
  )
    throw new Error('Telegram 快照不属于同一个本地账号')

  if (
    next.capturedAt !== undefined &&
    previous.capturedAt !== undefined &&
    next.capturedAt < previous.capturedAt
  )
    return previous

  const conversations = new Map(previous.conversations.map((chat) => [chat.id, chat]))
  for (const value of next.conversations) {
    const chat = { ...value, runtimeHistory: effectiveTelegramHistory(value.runtimeHistory) }
    const fresh =
      next.capturedAt !== undefined &&
      previous.capturedAt !== undefined &&
      next.capturedAt >= previous.capturedAt
    if (fresh && hasCompleteTelegramHistory(chat)) {
      const current = new Set(chat.runtimeHistory!.blockMessageIds)
      const messages = chat.messages.filter((message) => current.has(message.id))
      const senders = new Set(messages.map((message) => message.senderId))
      conversations.set(chat.id, {
        ...chat,
        messages,
        participants: chat.participants.filter((participant) => senders.has(participant.id))
      })
      continue
    }
    // If purported complete coverage cannot be validated/replaced, the merged
    // union must not retain a misleading complete label.
    if (chat.runtimeHistory?.loadedAtTop && chat.runtimeHistory.loadedAtBottom)
      chat.runtimeHistory = { ...chat.runtimeHistory, loadedAtTop: false, loadedAtBottom: false }
    const old = conversations.get(chat.id)
    if (!old) {
      conversations.set(chat.id, chat)
      continue
    }
    const messages = new Map(old.messages.map((message) => [message.id, message]))
    for (const message of chat.messages) messages.set(message.id, message)
    const participants = new Map(
      old.participants.map((participant) => [participant.id, participant])
    )
    for (const participant of chat.participants) participants.set(participant.id, participant)
    conversations.set(chat.id, {
      ...chat,
      messages: [...messages.values()].sort(
        (a, b) => (a.dateMs ?? 0) - (b.dateMs ?? 0) || (BigInt(a.id) < BigInt(b.id) ? -1 : 1)
      ),
      participants: [...participants.values()]
    })
  }
  const values = [...conversations.values()]
  if (values.reduce((count, chat) => count + chat.messages.length, 0) > 200000)
    throw new Error('Telegram 本次连接已达到 20 万条消息上限，请缩小读取范围')
  return { ...next, conversations: values }
}
