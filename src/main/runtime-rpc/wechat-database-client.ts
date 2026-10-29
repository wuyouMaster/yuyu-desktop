import { z } from 'zod'
import { RuntimeRpcError, type RuntimeJson } from '../../shared/runtime-rpc'
import { wechatStorageDescriptionSchema } from '../../shared/wechat-storage-protocol'
import {
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
  private methods?: Set<string>
  private account?: WechatDatabaseOpen
  private opening = false
  private closing = false
  private stopping?: Promise<boolean>
  constructor(private readonly rpc: DatabaseRpcTransport) {}
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
  close(): void {
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
