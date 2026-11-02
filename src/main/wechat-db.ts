import type { DatabaseConnectionRegistration } from '../shared/database-runtime-port'
import { databaseRuntimeProviders } from './services/database-runtime-registry'
import { CapabilityUnavailableError } from './services/capability-provider-registry'
import { wcdbDebugLog } from './wcdb-debug'
import type { DatabasePort, DatabaseMessageQueryOptions } from '../shared/database-port'
import {
  DatabaseProviderRegistry,
  type DatabaseProviderRegistration
} from './services/database-provider-registry'

export interface UserContact {
  m_nsUsrName: string
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
}

export interface WechatMessage {
  mesLocalID: string
  mesDes: number
  messageType: string
  msgCreateTime: string
  msgContent: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export interface Contact {
  m_nsUsrName: string
  m_nsNickName: string
  md5: string
  type: 'user' | 'group'
  avatar?: string
}

export interface GroupMemberInfo {
  m_nsUsrName: string
  nickname: string
  m_nsHeadImgUrl: string
}

function mergeExportMessages(messages: WechatMessage[]): WechatMessage[] {
  const merged = new Map<string, WechatMessage>()
  for (const message of messages) {
    const serverId = String(message.serverId || '')
    const recovered = Boolean(message.raw?.['_yuyu_recovered'] || message['_yuyu_recovered'])
    const identity =
      serverId && serverId !== '0'
        ? `server:${serverId}`
        : `local:${message.mesLocalID}:${message.msgCreateTime}`
    merged.set(recovered ? `recovered:${identity}` : identity, message)
  }
  return Array.from(merged.values()).sort(
    (left, right) =>
      Number(left.msgCreateTime || 0) - Number(right.msgCreateTime || 0) ||
      Number(left.mesLocalID || 0) - Number(right.mesLocalID || 0)
  )
}

export class WechatDb {
  private readonly connection: DatabaseConnectionRegistration
  private readonly databasePort: DatabasePort
  private readonly providerRegistry: DatabaseProviderRegistry
  private state: 'open' | 'closing' | 'closed' = 'open'
  private closePromise?: Promise<boolean>
  private monitorGeneration = 0
  private monitorPending?: Promise<boolean>
  private chatMd5ToUsername = new Map<string, string>()
  private chatTableMappingLoaded = false

  /** Convenience for resource-free read providers. Owned transports use fromConnection. */
  static fromProvider(registration: DatabaseProviderRegistration): WechatDb {
    return WechatDb.fromConnection({
      ...registration,
      lifecycle: { close: () => {}, closeAsync: async () => true }
    })
  }

  static fromConnection(connection: DatabaseConnectionRegistration): WechatDb {
    try {
      return new WechatDb('', undefined, connection)
    } catch (error) {
      try {
        connection.lifecycle?.close?.()
      } catch {
        /* preserve the contract error */
      }
      throw error
    }
  }

  static async create(rawKey: string, accountRoot?: string): Promise<WechatDb> {
    const runtime = databaseRuntimeProviders.resolveComplete().port
    const connection = await runtime.openAsync({ rawKey, accountRoot })
    try {
      if (connection.source !== 'wechat')
        throw new Error('Database factory returned a different source')
      return new WechatDb('', undefined, connection)
    } catch (error) {
      try {
        await connection.lifecycle?.closeAsync?.()
      } catch {
        /* preserve the open error */
      }
      throw error
    }
  }

  static bootstrap(): Promise<void> {
    return databaseRuntimeProviders.resolveComplete().port.bootstrap()
  }

  constructor(
    rawKey: string,
    accountRoot?: string,
    connectionOverride?: DatabaseConnectionRegistration,
    initialChatTables?: { name: string; db_number: string }[]
  ) {
    const connection =
      connectionOverride ??
      databaseRuntimeProviders.resolveComplete().port.open({ rawKey, accountRoot })
    const registry = new DatabaseProviderRegistry(connection.source, connection.accountId)
    try {
      if (
        !connection.lifecycle ||
        typeof connection.lifecycle.close !== 'function' ||
        typeof connection.lifecycle.closeAsync !== 'function'
      ) {
        throw new CapabilityUnavailableError('Database connection must implement lifecycle cleanup')
      }
      if (
        connection.observation &&
        (typeof connection.observation.startMonitor !== 'function' ||
          typeof connection.observation.stopMonitor !== 'function')
      ) {
        throw new CapabilityUnavailableError('Incomplete database observation capability')
      }
      if (
        connection.recallJournal &&
        typeof connection.recallJournal.installRecallJournal !== 'function'
      ) {
        throw new CapabilityUnavailableError('Incomplete recall journal capability')
      }
      if (!connectionOverride && connection.source !== 'wechat')
        throw new Error('Database factory returned a different source')
      registry.register(connection)
      this.databasePort = registry.resolveComplete().port
    } catch (error) {
      if (!connectionOverride) {
        try {
          connection.lifecycle?.close?.()
        } catch {
          /* preserve the open error */
        }
      }
      throw error
    }
    this.providerRegistry = registry
    this.connection = { ...connection }
    for (const table of initialChatTables || []) {
      if (table.name.startsWith('Chat_')) {
        this.chatMd5ToUsername.set(table.name.substring(5), table.db_number)
      }
    }
    this.chatTableMappingLoaded = Boolean(initialChatTables)
  }

  /** Bound read capability; native construction and lifecycle stay inside the registered owner. */
  public getDatabasePort(): DatabasePort {
    return this.databasePort
  }

  private ensureChatTableMapping(): void {
    if (this.chatTableMappingLoaded) return
    for (const table of this.databasePort.getChatTables()) {
      if (table.name.startsWith('Chat_')) {
        this.chatMd5ToUsername.set(table.name.substring(5), table.db_number)
      }
    }
    this.chatTableMappingLoaded = true
  }

  public getUserList(nicknameFilter?: string): UserContact[] {
    const keyword = (nicknameFilter || '').trim().toLowerCase()
    return this.databasePort
      .getSessions()
      .map((session) => ({
        m_nsUsrName: session.username,
        nickname: session.nickname || session.username,
        avatar: session.avatar,
        wechatNickname: session.wechatNickname,
        remark: session.remark,
        alias: session.alias,
        wechatId:
          session.wechatId || this.databasePort.getContactIdentity(session.username)?.wechatId,
        wxid:
          session.wxid ||
          this.databasePort.getContactIdentity(session.username)?.wxid ||
          session.username,
        legacyIdentifier:
          session.legacyIdentifier ||
          this.databasePort.getContactIdentity(session.username)?.legacyIdentifier,
        isFolded: session.isFolded,
        isMuted: session.isMuted
      }))
      .filter((contact) => {
        if (!keyword) return true
        return [
          contact.remark,
          contact.wechatNickname,
          contact.nickname,
          contact.alias,
          contact.wechatId,
          contact.wxid,
          contact.m_nsUsrName
        ].some((value) => value?.toLocaleLowerCase().includes(keyword))
      })
  }

  public async hydrateContactIdentitiesAsync(): Promise<void> {
    const sessions = this.databasePort.getSessions()
    await this.databasePort.hydrateContactIdentitiesAsync(
      sessions.map((session) => session.username)
    )
  }

  public getAllGroupContacts(): Record<string, string> {
    const groupContacts: Record<string, string> = {}
    for (const session of this.databasePort.getSessions()) {
      if (session.username.endsWith('@chatroom')) {
        groupContacts[this.md5(session.username)] = session.nickname || session.username
      }
    }
    return groupContacts
  }

  public getAllGroupMembers(): Record<string, string> {
    const members: Record<string, string> = {}
    for (const session of this.databasePort.getSessions()) {
      if (!session.username.endsWith('@chatroom')) continue
      for (const member of this.databasePort.getGroupMembers(session.username)) {
        if (member.m_nsUsrName) {
          members[member.m_nsUsrName] = member.nickname || member.m_nsUsrName
        }
      }
    }
    return members
  }

  public getGroupMembersForChat(userMd5: string): Record<string, string> {
    this.ensureChatTableMapping()
    const username = this.chatMd5ToUsername.get(userMd5)
    if (!username || !username.endsWith('@chatroom')) return {}

    const members: Record<string, string> = {}
    for (const member of this.databasePort.getGroupMembers(username)) {
      if (member.m_nsUsrName) {
        members[member.m_nsUsrName] = member.nickname || member.m_nsUsrName
      }
    }
    return members
  }

  public getGroupMember(wxid: string, chatroomId?: string): GroupMemberInfo | null {
    if (!chatroomId) return null
    return (
      this.databasePort.getGroupMembers(chatroomId).find((member) => member.m_nsUsrName === wxid) ||
      null
    )
  }

  public getAllChatTables(): { name: string; db_number: string }[] {
    return this.databasePort.getChatTables()
  }

  public getMyAvatarUrl(): string | undefined {
    return this.databasePort.getMyAvatarUrl()
  }

  public getRuntimeCapabilities(): { monitoring: boolean; recallJournal: boolean } {
    return {
      monitoring: Boolean(this.connection.observation),
      recallJournal: Boolean(this.connection.recallJournal)
    }
  }

  public startMonitor(callback: (type: string, json: string) => void): Promise<boolean> {
    if (this.state !== 'open' || !this.connection.observation) return Promise.resolve(false)
    // Do not start a competing native subscription while the previous start is in flight.
    if (this.monitorPending) return this.monitorPending
    const generation = ++this.monitorGeneration
    const observation = this.connection.observation
    const pending = (async (): Promise<boolean> => {
      const started = await observation.startMonitor((type, json) => {
        if (this.state === 'open' && generation === this.monitorGeneration) callback(type, json)
      })
      if (this.state !== 'open') return false // owner.closeAsync drains/cancels pending starts
      if (generation !== this.monitorGeneration) {
        observation.stopMonitor()
        return false
      }
      return started
    })()
    this.monitorPending = pending
    void pending
      .finally(() => {
        if (this.monitorPending === pending) this.monitorPending = undefined
      })
      .catch(() => undefined)
    return pending
  }

  public stopMonitor(): void {
    this.monitorGeneration += 1
    if (this.state === 'open') this.connection.observation?.stopMonitor()
  }

  public installRecallJournal(usernames: string[]): { installed: number; failed: number } {
    if (this.state !== 'open' || !this.connection.recallJournal) {
      throw new CapabilityUnavailableError('Recall journal capability is unavailable')
    }
    return this.connection.recallJournal.installRecallJournal(usernames)
  }

  public close(): void {
    if (this.state !== 'open') return
    this.state = 'closed'
    this.monitorGeneration += 1
    this.providerRegistry.clear()
    this.connection.lifecycle.close()
  }

  public closeAsync(timeoutMs?: number): Promise<boolean> {
    if (this.closePromise) return this.closePromise
    // A synchronous close cannot promise that in-flight work drained.
    if (this.state === 'closed') return Promise.resolve(false)
    this.state = 'closing'
    this.monitorGeneration += 1
    this.providerRegistry.clear()
    this.closePromise = (async (): Promise<boolean> => {
      try {
        return await this.connection.lifecycle.closeAsync(timeoutMs)
      } finally {
        this.state = 'closed'
      }
    })()
    return this.closePromise
  }

  public getUserMessages(
    userMd5: string,
    startTime?: number,
    endTime?: number,
    options?: DatabaseMessageQueryOptions
  ): WechatMessage[] {
    this.ensureChatTableMapping()
    const username = this.chatMd5ToUsername.get(userMd5)
    if (!username) return []
    return this.databasePort.getMessages(username, startTime, endTime, options).map((message) => ({
      ...message.raw,
      ...message
    }))
  }

  public async getUserMessagesAsync(
    userMd5: string,
    startTime?: number,
    endTime?: number,
    options?: DatabaseMessageQueryOptions,
    requestId = 'NO-REQUEST'
  ): Promise<WechatMessage[]> {
    this.ensureChatTableMapping()
    const username = this.chatMd5ToUsername.get(userMd5)
    if (!username) return []
    const startedAt = Date.now()
    wcdbDebugLog(`[${requestId}] WechatDb getUserMessagesAsync start username=${username}`)
    const messages = await this.databasePort.getMessagesAsync(
      username,
      startTime,
      endTime,
      options,
      requestId
    )
    const mapped = messages.map((message) => ({ ...message.raw, ...message }))
    wcdbDebugLog(
      `[${requestId}] WechatDb getUserMessagesAsync end rows=${mapped.length} cost=${Date.now() - startedAt}ms`
    )
    return mapped
  }

  public async getUserMessagesForExport(
    userMd5: string,
    startTime?: number,
    endTime?: number
  ): Promise<WechatMessage[]> {
    this.ensureChatTableMapping()
    const username = this.chatMd5ToUsername.get(userMd5)
    if (!username) return []
    if (startTime && endTime && startTime > endTime) return []

    // The async client merges cursor and shard-table results while applying the
    // time range in SQLite. Avoid loading the entire conversation when exporting
    // a narrow range; this is especially important for chats with long history.
    const rows = await this.databasePort.getMessagesAsync(username, startTime, endTime)
    const messages = rows.map((message) => ({ ...message.raw, ...message }))
    console.log(
      `[WechatDb] export scan username=${username} raw=${rows.length} filtered=${messages.length} start=${startTime || 0} end=${endTime || 0}`
    )
    return mergeExportMessages(messages)
  }

  public async getUserVoiceMessageCountAsync(
    userMd5: string,
    startTime?: number,
    endTime?: number
  ): Promise<number | null> {
    this.ensureChatTableMapping()
    const username = this.chatMd5ToUsername.get(userMd5)
    if (!username) return 0
    return this.databasePort.countVoiceMessagesAsync(username, startTime, endTime)
  }

  public searchAllMessages(keyword: string): string | null {
    const lowerKeyword = keyword.trim().toLowerCase()
    if (!lowerKeyword) return null
    for (const session of this.databasePort.getSessions()) {
      const found = this.databasePort
        .getMessages(session.username)
        .some((message) => message.msgContent.toLowerCase().includes(lowerKeyword))
      if (found) return `Chat_${this.md5(session.username)}`
    }
    return null
  }

  public md5(str: string): string {
    return this.databasePort.md5(str)
  }
}
