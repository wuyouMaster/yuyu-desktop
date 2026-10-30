import { realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { verifyRuntime, type RuntimePackage } from '../../../scripts/runtime-store.mjs'
import { RuntimeRpcError } from '../../shared/runtime-rpc'
import type { ImageMediaPort } from '../../shared/image-media-port'
import type { DatabaseConnectionRegistration } from '../../shared/database-runtime-port'
import { RuntimeRpcBridgeClient } from './bridge-client'
import { WechatDatabaseRuntime } from './wechat-database-runtime'
import { WechatImageMediaPort } from './wechat-image-media-port'
import { WechatMediaFilesClient } from './wechat-media-files-client'
import { WechatStorageClient } from './wechat-storage-client'
import { WechatAudioCodecPort } from './wechat-audio-codec-port'

/** Main-process inputs only. item must come from the application's reviewed catalog,
 * not renderer IPC. Credentials are neither persisted nor placed in argv/environment.
 */
export interface InstalledWechatAccountOptions {
  home: string
  item: RuntimePackage
  workerPath: string
  accountRoot: string
  rawKey: string
  imageKeys?: { xorKey?: number; aesKey?: string }
  cacheDirectory: string
}
export interface InstalledWechatAccount {
  database: DatabaseConnectionRegistration
  images: ImageMediaPort
  storage: WechatStorageClient
  audio: WechatAudioCodecPort
  /** Shared owner: cancels observation and releases images before the database/transport. */
  close(): Promise<void>
}

/** Verify the complete installed package before starting a single account-owned process.
 * This is an explicit composition entrypoint, not a replacement for production defaults.
 */
export async function openInstalledWechatAccount(
  options: InstalledWechatAccountOptions
): Promise<InstalledWechatAccount> {
  if (
    options.item.application !== 'wechat' ||
    options.item.target !== `${process.platform}-${process.arch}` ||
    ![options.home, options.workerPath, options.accountRoot, options.cacheDirectory].every(
      isAbsolute
    )
  )
    throw new RuntimeRpcError('INVALID_ARGUMENT')
  const name = process.platform === 'win32' ? 'wechat-storage-host.exe' : 'wechat-storage-host'
  if (!options.item.files.includes(name)) throw new RuntimeRpcError('CAPABILITY_UNAVAILABLE')
  const directory = await verifyRuntime(options.home, options.item)
  const root = await realpath(options.accountRoot)
  const env: NodeJS.ProcessEnv = { PATH: '', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }
  if (process.platform === 'win32' && process.env.SystemRoot)
    env.SystemRoot = process.env.SystemRoot
  const rpc = new RuntimeRpcBridgeClient(options.workerPath, {
    executable: join(directory, name),
    env
  })
  let connection: DatabaseConnectionRegistration | undefined
  let image: WechatImageMediaPort | undefined
  const files = new WechatMediaFilesClient(rpc)
  try {
    connection = await new WechatDatabaseRuntime(() => rpc).openAsync({
      accountRoot: root,
      rawKey: options.rawKey
    })
    files.open(root, options.imageKeys)
    const data = connection.implementation
    if (!data.getAccountRoot || !data.resolveImageHardlink || !data.resolveImageHardlinkAsync)
      throw new RuntimeRpcError('CAPABILITY_UNAVAILABLE')
    image = new WechatImageMediaPort(files, options.accountRoot, options.cacheDirectory, {
      getAccountRoot: data.getAccountRoot.bind(data),
      resolveImageHardlink: data.resolveImageHardlink.bind(data),
      resolveImageHardlinkAsync: data.resolveImageHardlinkAsync.bind(data)
    })
    const databaseClose = connection.lifecycle.closeAsync
    let closing: Promise<void> | undefined
    const close = (timeoutMs?: number): Promise<void> => {
      closing ??= (async () => {
        let failure: unknown
        connection!.observation?.stopMonitor()
        try {
          image!.dispose()
        } catch (error) {
          failure = error
        }
        try {
          if (!(await databaseClose(timeoutMs))) throw new RuntimeRpcError('DATABASE_CLOSE_TIMEOUT')
        } catch (error) {
          failure ??= error
        }
        // Always stop the process, even if a per-session close failed. Propagate the failure.
        try {
          await rpc.close()
        } catch (error) {
          failure ??= error
        }
        if (failure) throw failure
      })()
      return closing
    }
    return {
      database: {
        ...connection,
        lifecycle: {
          close: () => {
            void close().catch(() => {
              /* Async close is the authoritative result. */
            })
          },
          closeAsync: async (timeoutMs) => {
            await close(timeoutMs)
            return true
          }
        }
      },
      images: image,
      storage: new WechatStorageClient(rpc),
      audio: new WechatAudioCodecPort(rpc),
      close
    }
  } catch (error) {
    let failure: unknown = error
    try {
      image ? image.dispose() : files.close()
    } catch (cleanupError) {
      failure = cleanupError
    }
    try {
      await connection?.lifecycle.closeAsync()
    } catch (cleanupError) {
      failure = cleanupError
    }
    try {
      await rpc.close()
    } catch (cleanupError) {
      failure = cleanupError
    }
    throw failure
  }
}
