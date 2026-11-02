import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runtimeCatalog } from './runtime-catalog'
import { verifyRuntimeSync } from '../../scripts/runtime-store.mjs'

export function managedRuntimesEnabled(): boolean { return true }
export function runtimeHome(): string {
  return (
    process.env.YUYU_RUNTIME_HOME ||
    (app.isPackaged
      ? join(app.getPath('userData'), 'runtimes')
      : join(app.getAppPath(), '.runtime'))
  )
}
export function runtimeRoot(application: string): string | undefined {
  if (!managedRuntimesEnabled()) return undefined
  const missing = join(runtimeHome(), 'missing', application)
  const activeFile = join(runtimeHome(), 'active.json')
  if (!existsSync(activeFile)) return missing
  try {
    const active = JSON.parse(readFileSync(activeFile, 'utf8'))[application]
    const item = runtimeCatalog().packages.find(
      (p) =>
        p.application === application &&
        p.sha256 === active?.sha256 &&
        p.version === active?.version &&
        p.target === `${process.platform}-${process.arch}`
    )
    if (!item) return missing
    return verifyRuntimeSync(runtimeHome(), item)
  } catch {
    return missing
  }
}
export function managedResourcePath(relativePath: string): string | undefined {
  if (!managedRuntimesEnabled()) return undefined
  const item = runtimeCatalog().packages.find((p) => p.files.includes(relativePath))
  const application =
    item?.application ||
    (relativePath.startsWith('telegram/')
      ? 'telegram'
      : relativePath.startsWith('dingtalk/')
        ? 'dingtalk'
        : /^(xkey_helper|xlogin_helper|xsend_helper|xsend-v3\/|connectors\/wechat\/|libwx|wxgf-decoder\/)/.test(
              relativePath
            )
          ? 'wechat'
          : undefined)
  return application ? join(runtimeRoot(application)!, relativePath) : undefined
}
