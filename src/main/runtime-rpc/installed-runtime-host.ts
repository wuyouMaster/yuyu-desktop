import { isAbsolute, join } from 'node:path'
import { verifyRuntimeSync, type RuntimePackage } from '../../../scripts/runtime-store.mjs'
import { RuntimeRpcBridgeClient } from './bridge-client'
import { RuntimeRpcError } from '../../shared/runtime-rpc'
import type { OwnedDatabaseTransport } from './wechat-database-runtime'

export interface InstalledRuntimeHostOptions {
  home: string
  item: RuntimePackage
  workerPath: string
  shutdownGraceMs?: number
}
const executables: Record<string, string> = {
  wechat: 'wechat-storage-host',
  telegram: 'telegram-storage-host'
}
/** Main-process catalog inputs only. No arbitrary executable/arguments from renderer IPC. */
export function createInstalledRuntimeHost(
  options: InstalledRuntimeHostOptions
): OwnedDatabaseTransport {
  const name = executables[options.item.application]
  if (
    !name ||
    ![options.home, options.workerPath].every(isAbsolute) ||
    options.item.target !== `${process.platform}-${process.arch}`
  )
    throw new RuntimeRpcError('INVALID_ARGUMENT')
  const executable = name + (process.platform === 'win32' ? '.exe' : '')
  if (!options.item.files.includes(executable)) throw new RuntimeRpcError('CAPABILITY_UNAVAILABLE')
  let directory: string
  try {
    directory = verifyRuntimeSync(options.home, options.item)
  } catch {
    throw new RuntimeRpcError('RUNTIME_INTEGRITY_FAILED')
  }
  const env: NodeJS.ProcessEnv = { PATH: '', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }
  if (process.platform === 'win32' && process.env.SystemRoot)
    env.SystemRoot = process.env.SystemRoot
  return new RuntimeRpcBridgeClient(options.workerPath, {
    executable: join(directory, executable),
    env,
    shutdownGraceMs: options.shutdownGraceMs
  })
}
