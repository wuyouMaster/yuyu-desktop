import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import bundled from '../../runtime.lock.json'
import { selectRuntime, type RuntimePackage } from '../../scripts/runtime-store.mjs'
// Explicit developer fixture catalog; never controlled by renderer IPC or packaged builds.
export function runtimeCatalog(): { packages: RuntimePackage[] } {
  const file = process.env.YUYU_RUNTIME_TEST_CATALOG
  if (!file || app.isPackaged) return bundled
  if (!isAbsolute(file)) throw new Error('Test runtime catalog must use an absolute path')
  const catalog = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(catalog.packages) || catalog.packages.length > 24)
    throw new Error('Invalid test runtime catalog')
  for (const item of catalog.packages)
    selectRuntime(catalog, item.application, item.version, item.target)
  return catalog
}

/** A checksum-valid archive may still predate this application's protocol. */
export function runtimeCompatibilityError(item: RuntimePackage): string | undefined {
  const host =
    item.application === 'wechat'
      ? 'wechat-storage-host'
      : item.application === 'telegram'
        ? 'telegram-storage-host'
        : undefined
  if (host && !item.files.includes(host + (item.target.startsWith('win32-') ? '.exe' : ''))) {
    return '此运行时版本尚未提供应用所需接口，请等待兼容版本发布后安装'
  }
  return undefined
}
