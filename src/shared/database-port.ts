/**
 * Account-bound application database protocol, version 1.
 * No native handles, FFI types, SQL or executable paths cross this boundary.
 * Async methods must retain non-blocking transport semantics. Synchronous methods
 * preserve existing local callers and are separately advertised capabilities;
 * asynchronous-only implementations may register a subset of the protocol.
 * Empty results mean no rows; unsupported operations are rejected by the registry.
 * Legacy nullable/error results retain their documented unavailable/failure semantics.
 */
import type { ImageMessageCountProbe } from './image-text-index'

export interface DatabaseSession {
  username: string
  nickname: string
  avatar?: string
  wechatNickname?: string
  remark?: string
  alias?: string
  wechatId?: string
  wxid?: string
  legacyIdentifier?: string
  isFolded?: boolean
  isMuted?: boolean
  raw: Record<string, unknown>
}

export interface DatabaseMessage {
  mesLocalID: string
  serverId?: string
  mesDes: number
  messageType: string
  msgCreateTime: string
  msgContent: string
  sender?: string
  senderNickname?: string
  senderAvatar?: string
  raw: Record<string, unknown>
}

export interface DatabaseMessageQueryOptions {
  limit?: number
}

export interface DatabaseImageMessageQueryOptions {
  /** 闭下界（epoch ms）。 */
  sinceMs?: number
  /** 开区间上界（epoch ms），与 sinceMs 一起构成 [sinceMs, beforeMs)。 */
  beforeMs?: number
  limit?: number
  /** 行序。默认 asc 保持既有行为；recent-first 分段窗口用 desc。 */
  order?: 'asc' | 'desc'
  /** 日志关联用，不含会话标识。 */
  requestId?: string
}

export interface DatabaseImageRange {
  sinceMs?: number
  beforeMs?: number
}

export interface DatabaseSessionQueryOptions {
  hydrateDisplayNames?: boolean
  hydrateStatuses?: boolean
}

export interface DatabaseGroupMember {
  m_nsUsrName: string
  nickname: string
  groupNickname: string
  wechatNickname: string
  remark: string
  m_nsHeadImgUrl: string
}

export type DatabaseGroupMemberBatchStatus = 'ok' | 'not_found'

export interface DatabaseGroupMemberIdsBatchItem {
  roomId: string
  status: DatabaseGroupMemberBatchStatus
  memberWxids: string[]
}

export interface DatabaseContactIdentity {
  username: string
  wechatId?: string
  wxid: string
  legacyIdentifier?: string
}

export interface DatabaseRoomInfo {
  roomId: string
  owner?: string
  announcement?: string
  announcementEditor?: string
  announcementPublishTime?: number
  chatRoomStatus?: number
  memberCount?: number
  maxMemberCount?: number
  chatName?: string
  openImAccountType?: string
  isOpenIm?: boolean
}

export interface DatabaseImageHardlink {
  file_name?: string
  full_path?: string
  [key: string]: unknown
}

export interface DatabaseVideoHardlink {
  resolved_md5?: string
  [key: string]: unknown
}

export interface DatabaseVoiceDataRequest {
  sessionId: string
  createTime: number
  candidates: string[]
  localId?: number
  svrId?: string | number
}

export interface DatabaseVoiceDataResult {
  success: boolean
  hex?: string
  error: string
}

export interface DatabasePort {
  getSessions(): DatabaseSession[]
  getSessionsAsync(options?: DatabaseSessionQueryOptions): Promise<DatabaseSession[]>
  getChatTables(): { name: string; db_number: string }[]
  getContactIdentity(username: string): DatabaseContactIdentity | undefined
  hydrateContactIdentitiesAsync(usernames: string[]): Promise<void>
  getUsernameByMd5(md5: string): string | undefined
  getAvatarUrlsAsync(usernames: string[]): Promise<Record<string, string>>
  getMyAvatarUrl(): string | undefined
  getMyUsernameCandidates(): string[]
  getMessages(
    conversationKey: string,
    startTime?: number,
    endTime?: number,
    options?: DatabaseMessageQueryOptions
  ): DatabaseMessage[]
  getMessagesAsync(
    conversationKey: string,
    startTime?: number,
    endTime?: number,
    options?: DatabaseMessageQueryOptions,
    requestId?: string
  ): Promise<DatabaseMessage[]>
  listImageMessagesAsync(
    conversationKey: string,
    options?: DatabaseImageMessageQueryOptions
  ): Promise<DatabaseMessage[]>
  countVoiceMessagesAsync(
    conversationKey: string,
    startTime?: number,
    endTime?: number
  ): Promise<number | null>
  countImageMessagesAsync(
    conversationKey: string,
    range?: number | DatabaseImageRange
  ): Promise<ImageMessageCountProbe>
  imageConversationWatermarkAsync(
    conversationKey: string,
    range?: number | DatabaseImageRange
  ): Promise<{ count: number; maxLocalId: number } | null>
  getGroupMembers(chatroomId: string): DatabaseGroupMember[]
  getGroupMembersAsync(chatroomId: string): Promise<DatabaseGroupMember[]>
  getGroupMemberIdsAsync(chatroomId: string): Promise<string[] | null>
  getGroupMemberNamesAsync(chatroomId: string, usernames: string[]): Promise<DatabaseGroupMember[]>
  getGroupMemberIdsBatchAsync(roomIds: string[]): Promise<DatabaseGroupMemberIdsBatchItem[] | null>
  isGroupMemberIdsBatchAvailable(): boolean
  getGroupNicknames(chatroomId: string): Map<string, string>
  getRoomInfo(chatroomId: string): DatabaseRoomInfo | null
  getRoomInfoAsync(chatroomId: string): Promise<DatabaseRoomInfo | null>
  getVoiceData(
    sessionId: string,
    createTime: number,
    candidates: string[],
    localId?: number,
    svrId?: string | number
  ): Promise<DatabaseVoiceDataResult>
  getVoiceDataBatch(requests: DatabaseVoiceDataRequest[]): Promise<DatabaseVoiceDataResult[]>
  getMediaResourceStatus(
    messageLocalId: number | string | undefined,
    messageCreateTime: number | string | undefined,
    messageLocalType?: number | string
  ): Promise<Record<string, unknown>[]>
  listSnsTimeline(limit?: number): Promise<Record<string, unknown>[]>
  listSnsMessages(limit?: number): Promise<Record<string, unknown>[]>
  listNonStoreEmoticons(limit?: number): Promise<Record<string, unknown>[]>
  listEmoticonPackages(limit?: number): Promise<Record<string, unknown>[]>
  listFMessageItems(limit?: number): Promise<Record<string, unknown>[]>
  listFavoriteItems(limit?: number): Promise<Record<string, unknown>[]>
  resolveEmoticonCdnUrl(md5: string): string | undefined
  resolveImageHardlink(md5: string): DatabaseImageHardlink | null
  resolveImageHardlinkAsync(md5: string): Promise<DatabaseImageHardlink | null>
  resolveVideoHardlink(md5: string, dbPath: string): DatabaseVideoHardlink | null
  getAccountRoot(): string
  /** Main-process connection management only; never expose credentials over IPC. */
  getKey(): string
  md5(value: string): string
  invalidateSessionCache(): void
  invalidateAvatarCache(usernames?: string[]): void
  invalidateGroupNicknameCache(): void
}
