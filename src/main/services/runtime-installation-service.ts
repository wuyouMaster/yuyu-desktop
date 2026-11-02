import { runtimeCatalog, runtimeCompatibilityError } from '../runtime-catalog'
import {
  installRuntime,
  readActive,
  selectRuntime,
  verifyRuntime
} from '../../../scripts/runtime-store.mjs'
import { runtimeHome } from '../runtime-paths'
import type {
  RuntimeInstallationStatus,
  RuntimeInstallRequest,
  RuntimeInstallProgress
} from '../../shared/runtime-installation'

const installedThisSession = new Set<string>()
let controller: AbortController | undefined
let progress: RuntimeInstallProgress | null = null
export function getRuntimeInstallProgress(): RuntimeInstallProgress | null {
  return progress ? { ...progress } : null
}
export function assertRuntimeRestartAllowed(): void {
  if (controller) throw new Error('请等待安装完成或取消安装后再重启')
  if (!installedThisSession.size) throw new Error('没有等待启用的运行时')
}
export function cancelRuntimeInstall(): void {
  if (progress?.phase !== 'activating') controller?.abort()
}

export async function listRuntimeInstallations(): Promise<RuntimeInstallationStatus[]> {
  const active = await readActive(runtimeHome())
  const target = `${process.platform}-${process.arch}`
  return Promise.all(
    runtimeCatalog().packages.map(async (item): Promise<RuntimeInstallationStatus> => {
      const base = {
        application: item.application,
        version: item.version,
        target: item.target,
        sourceLabel: process.env.YUYU_RUNTIME_TEST_BASE_URL ? '本机验收下载源' : '默认下载源'
      }
      if (item.target !== target) return { ...base, status: 'unsupported' }
      const incompatibility = runtimeCompatibilityError(item)
      if (incompatibility) return { ...base, status: 'unsupported', error: incompatibility }
      if (active[item.application]?.sha256 !== item.sha256)
        return { ...base, status: 'not-installed' }
      try {
        await verifyRuntime(runtimeHome(), item)
        return {
          ...base,
          status: 'installed',
          restartRequired: installedThisSession.has(item.application)
        }
      } catch {
        return { ...base, status: 'invalid', error: '文件校验失败，请检查或重新安装运行时' }
      }
    })
  )
}
export async function installSelectedRuntime(request: unknown): Promise<void> {
  if (!request || typeof request !== 'object') throw new Error('运行时请求无效')
  const { application, version, downloadUrl } = request as RuntimeInstallRequest
  const item = selectRuntime(
    runtimeCatalog(),
    application,
    version,
    `${process.platform}-${process.arch}`
  )
  const incompatibility = runtimeCompatibilityError(item)
  if (incompatibility) throw new Error(incompatibility)
  if (controller) throw new Error('已有运行时安装正在执行')
  const current = new AbortController()
  controller = current
  progress = { application, phase: 'connecting', downloaded: 0 }
  try {
    await installRuntime({
      signal: current.signal,
      onProgress: (next) => {
        progress = { application, ...next }
      },
      home: runtimeHome(),
      item,
      downloadUrl,
      token: process.env.YUYU_RUNTIME_TOKEN,
      // Test mirror is configured by the developer process, never supplied by the renderer.
      baseUrl: process.env.YUYU_RUNTIME_TEST_BASE_URL,
      allowLoopback: process.env.YUYU_RUNTIME_ALLOW_LOOPBACK === '1'
    })
    installedThisSession.add(application)
    progress = { ...progress!, phase: 'completed' }
  } catch (error) {
    const message = current.signal.aborted
      ? '下载已取消，可重新安装'
      : error instanceof Error
        ? error.message
        : '安装失败，请重试'
    progress = {
      ...progress!,
      phase: current.signal.aborted ? 'cancelled' : 'failed',
      error: message
    }
    throw new Error(message)
  } finally {
    controller = undefined
  }
}
