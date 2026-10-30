import { z } from 'zod'
import { WechatDatabaseMonitor } from './wechat-database-monitor'
import { RuntimeRpcError, type RuntimeJson } from '../../shared/runtime-rpc'
import { wechatStorageDescriptionSchema } from '../../shared/wechat-storage-protocol'
import {
  databaseVoiceQuerySchema,
  databaseContactDetailsSchema,
  databaseGroupIdsSchema,
  databaseImageHardlinkSchema,
  databaseVideoHardlinkSchema,
  databasePagedQuerySchema,
  databaseCursorSchema,
  databasePageSchema,
  databaseVoiceSchema,
  databaseObservationSchema,
  type WechatVoiceQuery,
  databaseOpenSchema,
  databaseSessionSchema,
  databaseMessageSchema,
  databaseMemberSchema,
  databaseRoomSchema,
  databaseQuerySchema,
  databaseCountSchema,
  databaseTablesSchema,
  databaseRowsSchema,
  databaseCatalogSchema,
  type WechatDatabaseOpen,
  type WechatDatabaseQuery,
  type WechatDatabaseCatalog
} from '../../shared/wechat-database-protocol'

type CallOptions = { timeoutMs?: number; signal?: AbortSignal; sideEffect?: boolean }
export interface DatabaseRpcTransport {
  call(method: string, params: RuntimeJson, options?: CallOptions): RuntimeJson
  callAsync(method: string, params: RuntimeJson, options?: CallOptions): Promise<RuntimeJson>
}
const json = (value: unknown): RuntimeJson => JSON.parse(JSON.stringify(value)) as RuntimeJson
function check<T>(schema: z.ZodType<T>, value: unknown, code = 'INVALID_RUNTIME_RESPONSE'): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new RuntimeRpcError(code)
  return parsed.data
}

/** One account session, shared by sync/async calls on the same persistent transport.
 * No fallback to a private library, no SQL, no hidden retries, no key logging.
 * This client intentionally exposes only operations implemented by the candidate.
 */
export class WechatDatabaseClient {
  private readonly monitor = new WechatDatabaseMonitor(this)
  private methods?: Set<string>
  private account?: WechatDatabaseOpen
  private opening = false
  private closing = false
  private stopping?: Promise<boolean>
  constructor(private readonly rpc: DatabaseRpcTransport) {}
  supports(method: string): boolean {
    this.describe()
    return !!this.methods?.has(method)
  }
  accountInfo(): WechatDatabaseOpen {
    if (!this.account || this.closing) throw new RuntimeRpcError('DATABASE_CLOSED')
    return { ...this.account, selfCandidates: [...this.account.selfCandidates] }
  }
  private describe(): void {
    if (!this.methods)
      this.methods = new Set(
        check(
          wechatStorageDescriptionSchema,
          this.rpc.call('runtime.describe', {}),
          'INCOMPATIBLE_RUNTIME'
        ).methods
      )
  }
  private async describeAsync(options?: CallOptions): Promise<void> {
    if (!this.methods)
      this.methods = new Set(
        check(
          wechatStorageDescriptionSchema,
          await this.rpc.callAsync('runtime.describe', {}, options),
          'INCOMPATIBLE_RUNTIME'
        ).methods
      )
  }
  private require(method: string): void {
    if (!this.methods?.has(method)) throw new RuntimeRpcError('CAPABILITY_UNAVAILABLE')
  }
  private openInput(root: string, key: string): void {
    if (!root || !/^[a-f0-9]{64}$/i.test(key)) throw new RuntimeRpcError('INVALID_ARGUMENT')
    if (this.account || this.opening || this.closing)
      throw new RuntimeRpcError('DATABASE_ALREADY_OPEN')
    this.opening = true
  }
  open(root: string, key: string): WechatDatabaseOpen {
    this.openInput(root, key)
    try {
      this.describe()
      this.require('database.open')
      this.account = check(databaseOpenSchema, this.rpc.call('database.open', { root, key }))
      return { ...this.account, selfCandidates: [...this.account.selfCandidates] }
    } finally {
      this.opening = false
    }
  }
  async openAsync(root: string, key: string, options?: CallOptions): Promise<WechatDatabaseOpen> {
    this.openInput(root, key)
    try {
      await this.describeAsync(options)
      this.require('database.open')
      this.account = check(
        databaseOpenSchema,
        await this.rpc.callAsync('database.open', { root, key }, options)
      )
      return { ...this.account, selfCandidates: [...this.account.selfCandidates] }
    } finally {
      this.opening = false
    }
  }
  private params(method: string, input: Record<string, unknown>): RuntimeJson {
    if (!this.account || this.closing) throw new RuntimeRpcError('DATABASE_CLOSED')
    this.require(method)
    return json({ ...input, sessionId: this.account.sessionId })
  }
  private call<T>(method: string, input: Record<string, unknown>, schema: z.ZodType<T>): T {
    return check(schema, this.rpc.call(method, this.params(method, input)))
  }
  private async asyncCall<T>(
    method: string,
    input: Record<string, unknown>,
    schema: z.ZodType<T>,
    options?: CallOptions
  ): Promise<T> {
    return check(schema, await this.rpc.callAsync(method, this.params(method, input), options))
  }
  sessions(hydrate = true) {
    return this.call('database.sessions', { hydrate }, z.array(databaseSessionSchema).max(100000))
  }
  sessionsAsync(hydrate = true, options?: CallOptions) {
    return this.asyncCall(
      'database.sessions',
      { hydrate },
      z.array(databaseSessionSchema).max(100000),
      options
    )
  }
  chatTables() {
    return this.call('database.chatTables', {}, databaseTablesSchema)
  }
  chatTablesAsync(options?: CallOptions) {
    return this.asyncCall('database.chatTables', {}, databaseTablesSchema, options)
  }
  contactsAsync(usernames: string[], options?: CallOptions) {
    check(z.array(z.string().min(1).max(256)).max(2000), usernames, 'INVALID_ARGUMENT')
    return this.asyncCall('database.contacts', { usernames }, databaseRowsSchema, options)
  }
  contactDetails(usernames: string[]) {
    check(z.array(z.string().min(1).max(256)).max(2000), usernames, 'INVALID_ARGUMENT')
    return this.call('database.contactDetails', { usernames }, databaseContactDetailsSchema)
  }
  contactDetailsAsync(usernames: string[], options?: CallOptions) {
    check(z.array(z.string().min(1).max(256)).max(2000), usernames, 'INVALID_ARGUMENT')
    return this.asyncCall(
      'database.contactDetails',
      { usernames },
      databaseContactDetailsSchema,
      options
    )
  }
  avatars(usernames: string[]) {
    check(z.array(z.string().min(1).max(256)).max(2000), usernames, 'INVALID_ARGUMENT')
    return this.call('database.avatars', { usernames }, z.record(z.string(), z.string()))
  }
  avatarsAsync(usernames: string[], options?: CallOptions) {
    check(z.array(z.string().min(1).max(256)).max(2000), usernames, 'INVALID_ARGUMENT')
    return this.asyncCall(
      'database.avatars',
      { usernames },
      z.record(z.string(), z.string()),
      options
    )
  }
  usernameByHash(md5: string) {
    check(z.string().regex(/^[a-f0-9]{32}$/i), md5, 'INVALID_ARGUMENT')
    return this.call('database.usernameByHash', { md5 }, z.string().min(1).nullable())
  }
  groupIdsAsync(rooms: string[], options?: CallOptions) {
    check(z.array(z.string().min(1).max(256)).max(500), rooms, 'INVALID_ARGUMENT')
    return this.asyncCall('database.groupMemberIds', { rooms }, databaseGroupIdsSchema, options)
  }
  emoticonURL(md5: string) {
    check(z.string().regex(/^[a-f0-9]{32}$/i), md5, 'INVALID_ARGUMENT')
    return this.call('database.emoticonURL', { md5 }, z.string().min(1).nullable())
  }
  imageHardlink(md5: string) {
    check(z.string().regex(/^[a-f0-9]{32}$/i), md5, 'INVALID_ARGUMENT')
    return this.call('database.imageHardlink', { md5 }, databaseImageHardlinkSchema)
  }
  imageHardlinkAsync(md5: string, options?: CallOptions) {
    check(z.string().regex(/^[a-f0-9]{32}$/i), md5, 'INVALID_ARGUMENT')
    return this.asyncCall('database.imageHardlink', { md5 }, databaseImageHardlinkSchema, options)
  }
  videoHardlink(md5: string) {
    check(z.string().regex(/^[a-f0-9]{32}$/i), md5, 'INVALID_ARGUMENT')
    return this.call('database.videoHardlink', { md5 }, databaseVideoHardlinkSchema)
  }
  pagedMessages(query: WechatDatabaseQuery) {
    const input = check(databasePagedQuerySchema, query, 'INVALID_ARGUMENT')
    const owner = { sessionId: this.accountInfo().sessionId }
    this.require('database.messagesOpen')
    this.require('database.messagesRead')
    this.require('database.messagesClose')
    const raw = this.rpc.call('database.messagesOpen', json({ ...owner, query: input }))
    const allocated = databaseCursorSchema.shape.queryId.safeParse(
      (raw as { queryId?: unknown })?.queryId
    )
    const rows: z.infer<typeof databaseMessageSchema>[] = []
    let complete = false
    let size = 0
    try {
      const cursor = check(databaseCursorSchema, raw)
      if (cursor.reverse !== (query.kind !== 'image' && query.order !== 'desc'))
        throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
      for (;;) {
        const page = check(
          databasePageSchema,
          this.rpc.call('database.messagesRead', { ...owner, queryId: cursor.queryId })
        )
        size += Buffer.byteLength(JSON.stringify(page.rows))
        if (size > 256 * 1024 * 1024) throw new RuntimeRpcError('RESULT_TOO_LARGE')
        rows.push(...page.rows)
        if (rows.length > (query.limit ?? 1000000))
          throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
        if (page.done) break
      }
      complete = true
      return cursor.reverse ? rows.reverse() : rows
    } finally {
      try {
        if (allocated.success)
          check(
            z.literal(true),
            this.rpc.call('database.messagesClose', { ...owner, queryId: allocated.data })
          )
      } catch (error) {
        if (complete) throw error
      }
    }
  }
  async pagedMessagesAsync(query: WechatDatabaseQuery, options?: CallOptions) {
    const input = check(databasePagedQuerySchema, query, 'INVALID_ARGUMENT')
    const owner = { sessionId: this.accountInfo().sessionId }
    this.require('database.messagesOpen')
    this.require('database.messagesRead')
    this.require('database.messagesClose')
    const raw = await this.rpc.callAsync(
      'database.messagesOpen',
      json({ ...owner, query: input }),
      options
    )
    const allocated = databaseCursorSchema.shape.queryId.safeParse(
      (raw as { queryId?: unknown })?.queryId
    )
    const rows: z.infer<typeof databaseMessageSchema>[] = []
    let complete = false
    let size = 0
    try {
      const cursor = check(databaseCursorSchema, raw)
      if (cursor.reverse !== (query.kind !== 'image' && query.order !== 'desc'))
        throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
      for (;;) {
        const page = check(
          databasePageSchema,
          await this.rpc.callAsync(
            'database.messagesRead',
            { ...owner, queryId: cursor.queryId },
            options
          )
        )
        size += Buffer.byteLength(JSON.stringify(page.rows))
        if (size > 256 * 1024 * 1024) throw new RuntimeRpcError('RESULT_TOO_LARGE')
        rows.push(...page.rows)
        if (rows.length > (query.limit ?? 1000000))
          throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
        if (page.done) break
      }
      complete = true
      return cursor.reverse ? rows.reverse() : rows
    } finally {
      try {
        if (allocated.success)
          check(
            z.literal(true),
            await this.rpc.callAsync('database.messagesClose', {
              ...owner,
              queryId: allocated.data
            })
          )
      } catch (error) {
        if (complete) throw error
      }
    }
  }
  messages(query: WechatDatabaseQuery) {
    return this.call(
      'database.messages',
      { query: check(databaseQuerySchema, query, 'INVALID_ARGUMENT') },
      z.array(databaseMessageSchema).max(100000)
    )
  }
  messagesAsync(query: WechatDatabaseQuery, options?: CallOptions) {
    return this.asyncCall(
      'database.messages',
      { query: check(databaseQuerySchema, query, 'INVALID_ARGUMENT') },
      z.array(databaseMessageSchema).max(100000),
      options
    )
  }
  countAsync(query: WechatDatabaseQuery, options?: CallOptions) {
    return this.asyncCall(
      'database.count',
      { query: check(databaseQuerySchema, query, 'INVALID_ARGUMENT') },
      databaseCountSchema,
      options
    )
  }
  countProbeAsync(query: WechatDatabaseQuery, options?: CallOptions) {
    return this.asyncCall(
      'database.countProbe',
      { query: check(databaseQuerySchema, query, 'INVALID_ARGUMENT') },
      databaseCountSchema.extend({ typeColumn: z.string().nullable() }),
      options
    )
  }
  members(room: string) {
    return this.call('database.groupMembers', { room }, z.array(databaseMemberSchema).max(100000))
  }
  membersAsync(room: string, options?: CallOptions) {
    return this.asyncCall(
      'database.groupMembers',
      { room },
      z.array(databaseMemberSchema).max(100000),
      options
    )
  }
  roomInfo(room: string) {
    return this.call('database.roomInfo', { room }, databaseRoomSchema)
  }
  roomInfoAsync(room: string, options?: CallOptions) {
    return this.asyncCall('database.roomInfo', { room }, databaseRoomSchema, options)
  }
  catalogAsync(kind: WechatDatabaseCatalog, limit: number, options?: CallOptions) {
    check(databaseCatalogSchema, kind, 'INVALID_ARGUMENT')
    check(z.number().int().min(1).max(2000), limit, 'INVALID_ARGUMENT')
    return this.asyncCall('database.catalog', { kind, limit }, databaseRowsSchema, options)
  }
  resourceStatusAsync(localId: number, created: number, kind?: number, options?: CallOptions) {
    for (const value of [localId, created, ...(kind === undefined ? [] : [kind])])
      check(z.number().int().safe().nonnegative(), value, 'INVALID_ARGUMENT')
    return this.asyncCall(
      'database.resourceStatus',
      { localId, created, kind },
      databaseRowsSchema,
      options
    )
  }
  async voiceAsync(query: WechatVoiceQuery, options?: CallOptions) {
    return this.asyncCall(
      'database.voice',
      { query: check(databaseVoiceQuerySchema, query, 'INVALID_ARGUMENT') },
      databaseVoiceSchema,
      options
    )
  }
  observeAsync(options?: CallOptions) {
    return this.asyncCall('database.observe', {}, databaseObservationSchema, options)
  }
  startMonitor(changed: (type: string, json: string) => void, failed: (error: unknown) => void) {
    return this.monitor.start(changed, failed)
  }
  stopMonitor(): void {
    this.monitor.stop()
  }
  close(): void {
    this.stopMonitor()
    if (this.opening) throw new RuntimeRpcError('DATABASE_OPENING')
    if (!this.account) return
    if (this.stopping) return
    this.closing = true
    try {
      check(z.literal(true), this.rpc.call('database.close', { sessionId: this.account.sessionId }))
    } catch (error) {
      if (!(error instanceof RuntimeRpcError && error.code === 'SESSION_NOT_FOUND')) throw error
    }
    this.account = undefined
  }
  async closeAsync(timeoutMs = 8000): Promise<boolean> {
    this.stopMonitor()
    if (this.opening) throw new RuntimeRpcError('DATABASE_OPENING')
    if (!this.account) return true
    if (this.stopping) return this.stopping
    this.closing = true
    this.stopping = this.drain(timeoutMs).finally(() => {
      this.stopping = undefined
    })
    return this.stopping
  }
  private async drain(timeoutMs: number): Promise<boolean> {
    try {
      check(
        z.literal(true),
        await this.rpc.callAsync(
          'database.close',
          { sessionId: this.account!.sessionId },
          { timeoutMs }
        )
      )
      this.account = undefined
      return true
    } catch (error) {
      if (error instanceof RuntimeRpcError && error.code === 'SESSION_NOT_FOUND') {
        this.account = undefined
        return true
      }
      if (
        error instanceof RuntimeRpcError &&
        (error.code === 'DEADLINE_EXCEEDED' || error.code === 'CANCELLED')
      )
        return false
      throw error
    }
  }
}
