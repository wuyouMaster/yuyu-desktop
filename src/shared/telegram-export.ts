import type { ConversationKind, EntityExtensions } from './domain-entities'

export interface TelegramExportParticipant {
  id: string
  displayName: string
  username?: string
  kind?: 'person' | 'bot' | 'official' | 'unknown'
}

/** Main-process-only references into the selected account's local media cache. */
export interface TelegramRuntimeMedia {
  dataCenterId?: number
  id: string
  kind: 'photo' | 'file' | 'video' | 'audio' | 'sticker' | 'animation' | 'voice' | 'video_message'
  fileName?: string
  mimeType?: string
  sizeBytes?: number
  durationMs?: number
  width?: number
  height?: number
  cacheRefs: Array<{
    role: 'full' | 'thumbnail' | 'small'
    keyHigh: string
    keyLow: string
    sizeBytes?: number
    width?: number
    height?: number
  }>
}

export interface TelegramExportMessage {
  id: string
  groupedId?: string
  type: string
  dateMs?: number
  senderId?: string
  senderName?: string
  text?: string
  mediaType?: string
  fileName?: string
  mimeType?: string
  durationSeconds?: number
  location?: { latitude: number; longitude: number; label?: string }
  replyToMessageId?: string
  action?: string
  actionText?: string
  outgoing?: boolean
  extensions?: EntityExtensions
  runtimeMedia?: TelegramRuntimeMedia
}

export interface TelegramExportConversation {
  id: string
  title: string
  kind: ConversationKind
  participants: TelegramExportParticipant[]
  messages: TelegramExportMessage[]
  extensions?: EntityExtensions
  /** Native boundaries are only effective while the observed history requests are idle. */
  runtimeHistory?: {
    loadedAtTop: boolean
    loadedAtBottom: boolean
    /** Absent on old helpers: treat as unknown, never as complete. */
    loadState?: 'idle' | 'pending' | 'unknown'
    /** Current contiguous blocks membership, distinct from cached/search messages. */
    blockMessageIds?: string[]
  }
}

export interface TelegramExportDocument {
  /** Runtime snapshots use this shared normalized shape without JSON export parsing. */
  origin?: 'runtime'
  capturedAt?: number
  /** Kept in the main process; never exposed as entity extensions. */
  runtime?: { pid: number; activeSelfId?: string; activePeerId?: string }
  accountKey: string
  accountLabel: string
  accountNativeId?: string
  conversations: TelegramExportConversation[]
  sourceFileName: string
}

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function idValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return undefined
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  }
  return undefined
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((item) => {
      const entry = record(item)
      return typeof item === 'string' ? item : entry ? String(entry.text || '') : ''
    })
    .join('')
}

function dateMs(value: unknown, unixValue: unknown): number | undefined {
  const unix = numberValue(unixValue)
  if (unix !== undefined) return unix * 1000
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function conversationKind(type: unknown): ConversationKind {
  const value = String(type || '').toLowerCase()
  if (value.includes('channel')) return 'channel'
  if (value.includes('group') || value.includes('supergroup')) return 'group'
  return 'direct'
}

function participantKind(value: unknown): TelegramExportParticipant['kind'] {
  const kind = String(value || '').toLowerCase()
  if (kind === 'bot') return 'bot'
  if (kind === 'official') return 'official'
  if (kind === 'person' || kind === 'user') return 'person'
  return 'unknown'
}

function participantFromRecord(value: unknown): TelegramExportParticipant | undefined {
  const entry = record(value)
  if (!entry) return undefined
  const id = idValue(entry.user_id ?? entry.id ?? entry.from_id)
  if (!id) return undefined
  const displayName =
    stringValue(entry.name) || stringValue(entry.first_name) || stringValue(entry.username) || id
  return {
    id,
    displayName,
    username: stringValue(entry.username),
    kind: participantKind(entry.type)
  }
}

function messageFromRecord(value: unknown, index: number): TelegramExportMessage | undefined {
  const entry = record(value)
  if (!entry) return undefined
  const id = idValue(entry.id) || 'index-' + index
  const fromId = idValue(entry.from_id) || idValue(entry.actor_id)
  const fromName = stringValue(entry.from) || stringValue(entry.actor)
  const location = record(entry.location_information)
  const latitude = numberValue(location?.latitude)
  const longitude = numberValue(location?.longitude)
  const mediaType = stringValue(entry.media_type)
  const fileName = stringValue(entry.file_name) || stringValue(entry.file)
  const mimeType = stringValue(entry.mime_type)
  const action = stringValue(entry.action)
  return {
    id,
    type: stringValue(entry.type) || 'message',
    dateMs: dateMs(entry.date, entry.date_unixtime),
    senderId: fromId,
    senderName: fromName,
    text: textValue(entry.text) || undefined,
    mediaType,
    fileName,
    mimeType,
    durationSeconds: numberValue(entry.duration_seconds),
    location:
      latitude !== undefined && longitude !== undefined
        ? { latitude, longitude, label: stringValue(location?.place_name) }
        : undefined,
    replyToMessageId: idValue(entry.reply_to_message_id),
    action,
    actionText: textValue(entry.action_text) || undefined,
    outgoing: booleanValue(entry.outgoing) ?? false,
    extensions: {
      telegram: {
        viaBot: stringValue(entry.via_bot),
        edited: stringValue(entry.edited),
        forwardedFrom: stringValue(entry.forwarded_from),
        stickerEmoji: stringValue(entry.sticker_emoji)
      }
    }
  }
}

function conversationFromRecord(
  value: unknown,
  index: number
): TelegramExportConversation | undefined {
  const entry = record(value)
  if (!entry) return undefined
  const id = idValue(entry.id) || 'conversation-' + index
  const participants = Array.isArray(entry.participants)
    ? entry.participants.map(participantFromRecord).filter(Boolean)
    : []
  const messages = Array.isArray(entry.messages)
    ? entry.messages.map(messageFromRecord).filter(Boolean)
    : []
  const seen = new Set(participants.map((item) => item!.id))
  for (const message of messages) {
    if (!message?.senderId || seen.has(message.senderId)) continue
    seen.add(message.senderId)
    participants.push({
      id: message.senderId,
      displayName: message.senderName || message.senderId,
      kind: 'unknown'
    })
  }
  return {
    id,
    title: stringValue(entry.name) || stringValue(entry.title) || id,
    kind: conversationKind(entry.type),
    participants: participants as TelegramExportParticipant[],
    messages: messages as TelegramExportMessage[],
    extensions: {
      telegram: {
        nativeType: stringValue(entry.type),
        username: stringValue(entry.username),
        about: stringValue(entry.about)
      }
    }
  }
}

function listFromExport(value: JsonRecord): unknown[] {
  const chats = record(value.chats)
  if (Array.isArray(chats?.list)) return chats.list
  if (Array.isArray(value.messages)) return [value]
  if (Array.isArray(value.list)) return value.list
  return []
}

function accountInfo(value: JsonRecord): { id?: string; label: string } {
  const personal = record(value.personal_information) || record(value.personalInformation)
  const user = record(personal?.user) || personal
  const id = idValue(user?.user_id) || idValue(user?.id)
  const label =
    stringValue(user?.name) ||
    [stringValue(user?.first_name), stringValue(user?.last_name)].filter(Boolean).join(' ') ||
    stringValue(user?.username) ||
    'Telegram 导出账号'
  return { id, label }
}

export function parseTelegramExport(
  value: unknown,
  accountKey: string,
  sourceFileName: string
): TelegramExportDocument {
  const root = record(value)
  if (!root) throw new Error('Telegram 导出文件不是有效 JSON 对象')
  const conversations = listFromExport(root)
    .map(conversationFromRecord)
    .filter(Boolean) as TelegramExportConversation[]
  if (!conversations.length) throw new Error('Telegram 导出文件中未找到会话列表')
  const account = accountInfo(root)
  return {
    accountKey,
    accountLabel: account.label,
    ...(account.id ? { accountNativeId: account.id } : {}),
    conversations,
    sourceFileName
  }
}
