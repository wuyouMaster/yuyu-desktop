import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type {
  DatabasePort,
  DatabaseContactIdentity,
  DatabaseSessionQueryOptions,
  DatabaseMessageQueryOptions,
  DatabaseImageMessageQueryOptions,
  DatabaseImageRange,
  DatabaseVoiceDataRequest,
  DatabaseVoiceDataResult,
  DatabaseImageHardlink
} from '../../shared/database-port'
import { RuntimeRpcError } from '../../shared/runtime-rpc'
import { WechatDatabaseClient } from './wechat-database-client'

const integer = (value: unknown): number => {
  if (typeof value !== 'number' && typeof value !== 'string')
    throw new RuntimeRpcError('INVALID_ARGUMENT')
  const n = Number(value)
  if (value === '' || !Number.isSafeInteger(n) || n < 0)
    throw new RuntimeRpcError('INVALID_ARGUMENT')
  return n
}
const unique = (values: string[]) => [...new Set(values)]

/** Complete application interface backed by one account owner. Data formats,
 * queries, decryption and native state remain in the private Go/C host.
 * Source/schema failures propagate; no empty-success fallback is installed.
 */
export class WechatDatabasePort implements DatabasePort {
  private readonly identities = new Map<string, DatabaseContactIdentity>()
  private readonly avatars = new Map<string, string>()
  private readonly groupNames = new Map<string, Map<string, string>>()
  private key: string
  constructor(
    private readonly client: WechatDatabaseClient,
    key: string
  ) {
    client.accountInfo()
    for (const method of [
      'database.sessions',
      'database.chatTables',
      'database.contactDetails',
      'database.avatars',
      'database.usernameByHash',
      'database.messagesOpen',
      'database.messagesRead',
      'database.messagesClose',
      'database.countProbe',
      'database.count',
      'database.groupMembers',
      'database.groupMemberIds',
      'database.roomInfo',
      'database.voice',
      'database.resourceStatus',
      'database.catalog',
      'database.emoticonURL',
      'database.imageHardlink',
      'database.videoHardlink'
    ])
      if (!client.supports(method)) throw new RuntimeRpcError('CAPABILITY_UNAVAILABLE')
    this.key = key
  }
  dispose(): void {
    this.key = ''
    this.identities.clear()
    this.avatars.clear()
    this.groupNames.clear()
  }
  getSessions() {
    return this.client.sessions()
  }
  getSessionsAsync(options: DatabaseSessionQueryOptions = {}) {
    return this.client.sessionsAsync(options.hydrateDisplayNames !== false)
  }
  getChatTables() {
    return this.client.chatTables()
  }
  getContactIdentity(username: string) {
    this.client.accountInfo()
    const value = this.identities.get(username)
    return value ? { ...value } : undefined
  }
  async hydrateContactIdentitiesAsync(usernames: string[]): Promise<void> {
    const names = unique(usernames)
    for (let i = 0; i < names.length; i += 2000)
      for (const row of await this.client.contactDetailsAsync(names.slice(i, i + 2000))) {
        const { avatar: _avatar, ...identity } = row
        this.identities.set(row.username, identity)
      }
  }
  getUsernameByMd5(md5: string) {
    return this.client.usernameByHash(md5) ?? undefined
  }
  async getAvatarUrlsAsync(usernames: string[]) {
    const names = unique(usernames)
    const result: Record<string, string> = {}
    for (let i = 0; i < names.length; i += 2000) {
      const rows = await this.client.avatarsAsync(names.slice(i, i + 2000))
      for (const [name, url] of Object.entries(rows)) {
        this.avatars.set(name, url)
        result[name] = url
      }
    }
    return result
  }
  getMyAvatarUrl() {
    const names = this.getMyUsernameCandidates()
    const values = this.client.avatars(names)
    for (const name of names) if (values[name]) return values[name]
    return undefined
  }
  getMyUsernameCandidates() {
    return this.client.accountInfo().selfCandidates
  }
  getMessages(
    conversation: string,
    start?: number,
    end?: number,
    options: DatabaseMessageQueryOptions = {}
  ) {
    return this.client.pagedMessages({ conversation, start, end, limit: options.limit })
  }
  getMessagesAsync(
    conversation: string,
    start?: number,
    end?: number,
    options: DatabaseMessageQueryOptions = {},
    _requestId?: string
  ) {
    return this.client.pagedMessagesAsync({ conversation, start, end, limit: options.limit })
  }
  listImageMessagesAsync(conversation: string, options: DatabaseImageMessageQueryOptions = {}) {
    return this.client.pagedMessagesAsync({
      conversation,
      kind: 'image',
      sinceMs: options.sinceMs,
      beforeMs: options.beforeMs,
      order: options.order,
      limit: options.limit
    })
  }
  async countVoiceMessagesAsync(conversation: string, start?: number, end?: number) {
    return (await this.client.countAsync({ conversation, start, end, kind: 'voice' })).count
  }
  private range(range?: number | DatabaseImageRange): DatabaseImageRange {
    return typeof range === 'number' ? { sinceMs: range } : (range ?? {})
  }
  async countImageMessagesAsync(conversation: string, range?: number | DatabaseImageRange) {
    const result = await this.client.countProbeAsync({
      conversation,
      kind: 'image',
      ...this.range(range)
    })
    return { count: result.count, typeColumn: result.typeColumn }
  }
  imageConversationWatermarkAsync(conversation: string, range?: number | DatabaseImageRange) {
    return this.client.countAsync({ conversation, kind: 'image', ...this.range(range) })
  }
  getGroupMembers(room: string) {
    return this.client.members(room)
  }
  getGroupMembersAsync(room: string) {
    return this.client.membersAsync(room)
  }
  async getGroupMemberIdsAsync(room: string) {
    const [row] = await this.client.groupIdsAsync([room])
    if (!row || row.roomId !== room) throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
    return row.status === 'not_found' ? null : row.memberWxids
  }
  async getGroupMemberNamesAsync(room: string, usernames: string[]) {
    const wanted = new Set(usernames)
    return (await this.client.membersAsync(room)).filter((row) => wanted.has(row.m_nsUsrName))
  }
  async getGroupMemberIdsBatchAsync(rooms: string[]) {
    const names = unique(rooms)
    const result: Awaited<ReturnType<WechatDatabaseClient['groupIdsAsync']>> = []
    for (let i = 0; i < names.length; i += 500) {
      const requested = names.slice(i, i + 500)
      const rows = await this.client.groupIdsAsync(requested)
      if (
        rows.length !== requested.length ||
        rows.some((r, index) => r.roomId !== requested[index])
      )
        throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
      result.push(...rows)
    }
    return result
  }
  isGroupMemberIdsBatchAvailable() {
    return this.client.supports('database.groupMemberIds')
  }
  getGroupNicknames(room: string) {
    this.client.accountInfo()
    let names = this.groupNames.get(room)
    if (!names) {
      names = new Map(
        this.client
          .members(room)
          .filter((m) => m.groupNickname)
          .map((m) => [m.m_nsUsrName, m.groupNickname])
      )
      this.groupNames.set(room, names)
    }
    return new Map(names)
  }
  getRoomInfo(room: string) {
    return this.client.roomInfo(room)
  }
  getRoomInfoAsync(room: string) {
    return this.client.roomInfoAsync(room)
  }
  async getVoiceData(
    sessionId: string,
    createTime: number,
    _candidates: string[],
    localId?: number,
    svrId?: string | number
  ): Promise<DatabaseVoiceDataResult> {
    try {
      if (typeof svrId === 'number' && !Number.isSafeInteger(svrId))
        throw new RuntimeRpcError('INVALID_ARGUMENT')
      const hex = await this.client.voiceAsync({
        conversation: sessionId,
        created: createTime,
        localId,
        serverId: svrId === undefined ? undefined : String(svrId)
      })
      return hex === null
        ? { success: false, error: 'VOICE_NOT_FOUND' }
        : { success: true, hex, error: '' }
    } catch (error) {
      return {
        success: false,
        error: error instanceof RuntimeRpcError ? error.code : 'DATABASE_OPERATION_FAILED'
      }
    }
  }
  async getVoiceDataBatch(requests: DatabaseVoiceDataRequest[]) {
    const results: DatabaseVoiceDataResult[] = []
    for (const r of requests)
      results.push(
        await this.getVoiceData(r.sessionId, r.createTime, r.candidates, r.localId, r.svrId)
      )
    return results
  }
  getMediaResourceStatus(
    localId: number | string | undefined,
    created: number | string | undefined,
    kind?: number | string
  ) {
    return this.client.resourceStatusAsync(
      integer(localId),
      integer(created),
      kind === undefined ? undefined : integer(kind)
    )
  }
  listSnsTimeline(limit = 200) {
    return this.client.catalogAsync('snsTimeline', limit)
  }
  listSnsMessages(limit = 500) {
    return this.client.catalogAsync('snsMessages', limit)
  }
  listNonStoreEmoticons(limit = 500) {
    return this.client.catalogAsync('nonStoreEmoticons', limit)
  }
  listEmoticonPackages(limit = 100) {
    return this.client.catalogAsync('emoticonPackages', limit)
  }
  listFMessageItems(limit = 200) {
    return this.client.catalogAsync('friendRequests', limit)
  }
  listFavoriteItems(limit = 200) {
    return this.client.catalogAsync('favorites', limit)
  }
  resolveEmoticonCdnUrl(md5: string) {
    return this.client.emoticonURL(md5) ?? undefined
  }
  private imageLink(
    value: ReturnType<WechatDatabaseClient['imageHardlink']>
  ): DatabaseImageHardlink | null {
    if (!value) return null
    const full = value.relativePath ? resolve(this.getAccountRoot(), value.relativePath) : undefined
    if (full && !this.withinRoot(full)) throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
    return { file_name: value.file_name, ...(full ? { full_path: full } : {}) }
  }
  resolveImageHardlink(md5: string) {
    return this.imageLink(this.client.imageHardlink(md5))
  }
  async resolveImageHardlinkAsync(md5: string) {
    return this.imageLink(await this.client.imageHardlinkAsync(md5))
  }
  private withinRoot(path: string) {
    const rel = relative(this.getAccountRoot(), path)
    return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
  }
  resolveVideoHardlink(md5: string, dbPath: string) {
    if (!isAbsolute(dbPath) || !this.withinRoot(dbPath))
      throw new RuntimeRpcError('INVALID_ARGUMENT')
    return this.client.videoHardlink(md5)
  }
  getAccountRoot() {
    return this.client.accountInfo().accountRoot
  }
  getKey() {
    this.client.accountInfo()
    return this.key
  }
  md5(value: string) {
    return createHash('md5').update(value).digest('hex')
  }
  invalidateSessionCache() {
    this.identities.clear()
  }
  invalidateAvatarCache(usernames?: string[]) {
    if (!usernames) this.avatars.clear()
    else for (const name of usernames) this.avatars.delete(name)
  }
  invalidateGroupNicknameCache() {
    this.groupNames.clear()
  }
}
