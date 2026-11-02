import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { runtimeHome } from '../runtime-paths'
import { runtimeCatalog } from '../runtime-catalog'
import { RuntimeRpcError } from '../../shared/runtime-rpc'
import { createInstalledRuntimeHost } from './installed-runtime-host'
import type { OwnedDatabaseTransport } from './wechat-database-runtime'
import { WechatStorageClient } from './wechat-storage-client'
import { WechatAudioCodecPort } from './wechat-audio-codec-port'

const owned = new Set<OwnedDatabaseTransport>()
let shuttingDown = false
let cleanupFailure: unknown
export function createApplicationRuntime(
  application: 'wechat' | 'telegram',
  shutdownGraceMs?: number
): OwnedDatabaseTransport {
  if (shuttingDown) throw new RuntimeRpcError('RUNTIME_CLOSED')
  let active: Record<string, { version: string; sha256: string }>
  try {
    active = JSON.parse(readFileSync(join(runtimeHome(), 'active.json'), 'utf8'))
  } catch {
    throw new RuntimeRpcError('RUNTIME_NOT_INSTALLED')
  }
  const item = runtimeCatalog().packages.find(
    (p) =>
      p.application === application &&
      p.target === `${process.platform}-${process.arch}` &&
      p.sha256 === active[application]?.sha256 &&
      p.version === active[application]?.version
  )
  if (!item) throw new RuntimeRpcError('RUNTIME_NOT_INSTALLED')
  const rpc = createInstalledRuntimeHost({
    home: runtimeHome(),
    item,
    // electron-vite may move this module into out/main/chunks while the worker
    // remains an entry beside out/main/index.js.
    workerPath: join(
      basename(__dirname) === 'chunks' ? dirname(__dirname) : __dirname,
      'runtimeRpcWorker.js'
    ),
    shutdownGraceMs
  })
  let closing: Promise<void> | undefined
  const transport: OwnedDatabaseTransport = {
    call: rpc.call.bind(rpc),
    callAsync: rpc.callAsync.bind(rpc),
    close: () =>
      (closing ??= rpc
        .close()
        .catch((error) => {
          cleanupFailure ??= error
          throw error
        })
        .finally(() => owned.delete(transport)))
  }
  owned.add(transport)
  return transport
}
let storage: WechatStorageClient | undefined
export function applicationWechatStorage(): WechatStorageClient {
  return (storage ??= new WechatStorageClient(createApplicationRuntime('wechat')))
}
export function applicationCacheDirectory(name: string): string {
  return join(app.getPath('userData'), 'runtime-presentation', name)
}
export async function withWechatAudio<T>(
  run: (audio: WechatAudioCodecPort) => Promise<T>
): Promise<T> {
  const rpc = createApplicationRuntime('wechat')
  try {
    return await run(new WechatAudioCodecPort(rpc))
  } finally {
    await rpc.close()
  }
}
export async function closeApplicationRuntimes(): Promise<void> {
  shuttingDown = true
  const results = await Promise.allSettled([...owned].map((rpc) => rpc.close()))
  const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failure) throw failure.reason
  if (cleanupFailure) throw cleanupFailure
}

let assetTransport: OwnedDatabaseTransport | undefined
export function applicationMediaTransport(): OwnedDatabaseTransport {
  return (assetTransport ??= createApplicationRuntime('wechat'))
}
