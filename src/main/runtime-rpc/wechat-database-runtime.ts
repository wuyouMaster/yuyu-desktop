import type {
  DatabaseConnectionRegistration,
  DatabaseOpenOptions,
  DatabaseRuntimePort
} from '../../shared/database-runtime-port'
import { RuntimeRpcError } from '../../shared/runtime-rpc'
import { wechatStorageDescriptionSchema } from '../../shared/wechat-storage-protocol'
import { WechatDatabaseClient, type DatabaseRpcTransport } from './wechat-database-client'
import { WechatDatabasePort } from './wechat-database-port'

export interface OwnedDatabaseTransport extends DatabaseRpcTransport {
  close(): Promise<void>
}

/** The application injects a verified executable transport; this module owns
 * neither ABI libraries nor private fallback paths. One connection = one host.
 */
export class WechatDatabaseRuntime implements DatabaseRuntimePort {
  constructor(private readonly createTransport: () => OwnedDatabaseTransport) {}
  async bootstrap(): Promise<void> {
    const rpc = this.createTransport()
    try {
      const parsed = wechatStorageDescriptionSchema.safeParse(
        await rpc.callAsync('runtime.describe', {})
      )
      if (!parsed.success) throw new RuntimeRpcError('INCOMPATIBLE_RUNTIME')
      if (!parsed.data.methods.includes('database.open'))
        throw new RuntimeRpcError('CAPABILITY_UNAVAILABLE')
    } finally {
      await rpc.close()
    }
  }
  open(options: DatabaseOpenOptions): DatabaseConnectionRegistration {
    const rpc = this.createTransport()
    const client = new WechatDatabaseClient(rpc)
    try {
      client.open(options.accountRoot ?? '', options.rawKey)
      return this.connection(client, rpc, options.rawKey)
    } catch (error) {
      void rpc.close()
      throw error
    }
  }
  async openAsync(options: DatabaseOpenOptions): Promise<DatabaseConnectionRegistration> {
    const rpc = this.createTransport()
    const client = new WechatDatabaseClient(rpc)
    try {
      await client.openAsync(options.accountRoot ?? '', options.rawKey)
      return this.connection(client, rpc, options.rawKey)
    } catch (error) {
      await rpc.close()
      throw error
    }
  }
  private connection(
    client: WechatDatabaseClient,
    rpc: OwnedDatabaseTransport,
    key: string
  ): DatabaseConnectionRegistration {
    const port = new WechatDatabasePort(client, key)
    const accountId = port.getAccountRoot()
    let closed = false
    let failed = false
    const invalidate = () => {
      port.invalidateSessionCache()
      port.invalidateAvatarCache()
      port.invalidateGroupNicknameCache()
    }
    return {
      id: 'wechat-go',
      source: 'wechat',
      accountId,
      protocolVersion: 1,
      implementation: port,
      health: () => ({ state: closed || failed ? 'unavailable' : 'ready' }),
      lifecycle: {
        close: () => {
          closed = true
          port.dispose()
          try {
            client.close()
          } finally {
            void rpc.close()
          }
        },
        closeAsync: async (timeoutMs) => {
          closed = true
          port.dispose()
          const drained = await client.closeAsync(timeoutMs)
          if (drained) await rpc.close()
          return drained
        }
      },
      observation: {
        startMonitor: (callback) =>
          client.startMonitor(
            (type, json) => {
              if (!closed) {
                invalidate()
                callback(type, json)
              }
            },
            () => {
              failed = true
              invalidate()
              callback('error', JSON.stringify({ code: 'DATABASE_OBSERVATION_FAILED' }))
            }
          ),
        stopMonitor: () => client.stopMonitor()
      }
      // A read-only source cannot promise a pre-delete recall journal.
    }
  }
}
