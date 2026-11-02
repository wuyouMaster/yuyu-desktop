import { RuntimeRestartButton } from './RuntimeRestartButton'
import { useEffect, useState } from 'react'
import { Button, Input } from '../../../components/ui'
import type {
  RuntimeInstallationStatus,
  RuntimeInstallProgress
} from '../../../../../shared/runtime-installation'

const names: Record<string, string> = { wechat: '微信', telegram: 'Telegram', dingtalk: '钉钉' }
const phases = {
  connecting: '正在连接下载源',
  downloading: '正在下载',
  verifying: '正在校验完整性',
  extracting: '正在解包文件',
  activating: '正在完成安装',
  completed: '安装完成，请重启应用启用',
  failed: '安装失败，可重试',
  cancelled: '已取消，可重新安装'
}
const ongoing = (p: RuntimeInstallProgress | null): boolean =>
  !!p && !['completed', 'failed', 'cancelled'].includes(p.phase)
const size = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const labels = {
  'not-installed': '未安装',
  installed: '已安装并通过校验',
  invalid: '校验失败',
  unsupported: '当前平台不支持'
}
export function RuntimeManagerSection({
  application
}: { application?: string } = {}): React.ReactElement {
  const [items, setItems] = useState<RuntimeInstallationStatus[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [custom, setCustom] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [progress, setProgress] = useState<RuntimeInstallProgress | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const running = busy || (ongoing(progress) ? progress!.application : null)
  const refresh = async (): Promise<void> => {
    setItems(await window.api.listRuntimeInstallations())
  }
  useEffect(() => {
    void refresh().catch(() => setMessage('无法读取运行时安装状态'))
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    let lastPhase: string | undefined
    const poll = async (): Promise<void> => {
      try {
        if (!window.api.getRuntimeInstallProgress) return
        const next = await window.api.getRuntimeInstallProgress()
        if (disposed) return
        setProgress(next)
        if (next?.phase === 'completed' && lastPhase !== 'completed') await refresh()
        lastPhase = next?.phase
      } catch {
        if (!disposed) setMessage('进度读取失败，请稍后重新打开管理界面')
      } finally {
        if (!disposed) timer = setTimeout(() => void poll(), 400)
      }
    }
    void poll()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [])
  const install = async (item: RuntimeInstallationStatus): Promise<void> => {
    setBusy(item.application)
    setCancelling(false)
    setProgress({ application: item.application, phase: 'connecting', downloaded: 0 })
    setMessage(`正在下载并校验 ${names[item.application]} ${item.version}…`)
    try {
      await window.api.installRuntime({
        application: item.application,
        version: item.version,
        ...(custom[item.application] ? { downloadUrl: urls[item.application]?.trim() || '' } : {})
      })
      setProgress((p) => (p ? { ...p, phase: 'completed' } : p))
      await refresh()
      setMessage('安装和校验完成。请重启应用以启用；安装成功不代表已连接账号或验证真实发送。')
    } catch (error) {
      setProgress((p) => (p ? { ...p, phase: 'failed' } : p))
      setMessage(
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : '安装失败'
      )
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="settings-card" aria-label="应用运行时管理">
      <h2 className="settings-section-heading">应用运行时</h2>
      <p className="text-muted-foreground text-sm">
        主应用独立启动，按需安装各应用的固定版本工具。当前提供开发验证版本。
      </p>
      <p className="text-muted-foreground text-sm">
        公开 HTTPS 链接无需凭据；私有 GitHub
        下载可选配只读凭据。自定义链接仍按所选版本的可信摘要校验。
      </p>
      <div className="space-y-4 mt-4">
        {items
          .filter((item) => !application || item.application === application)
          .map((item) => (
            <div
              key={item.application}
              className="flex items-center justify-between gap-4 border-b border-border pb-3"
            >
              <div className="flex-1 min-w-0">
                <strong>{names[item.application]}</strong>
                <p className="text-sm text-muted-foreground">
                  {item.version} · {item.target} · {labels[item.status]}
                  {item.sourceLabel ? ` · ${item.sourceLabel}` : ''}
                </p>
                {item.restartRequired && (
                  <div className="mt-2">
                    <RuntimeRestartButton application={item.application} />
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm mt-2">
                  <input
                    type="checkbox"
                    checked={!!custom[item.application]}
                    disabled={running !== null}
                    onChange={(event) =>
                      setCustom({ ...custom, [item.application]: event.target.checked })
                    }
                  />
                  使用自定义链接下载 {names[item.application]}
                </label>
                {custom[item.application] && (
                  <Input
                    aria-label={`${names[item.application]}下载链接`}
                    type="url"
                    className="mt-2"
                    placeholder="https://example.com/runtime.zip"
                    value={urls[item.application] || ''}
                    disabled={running !== null}
                    onChange={(event) =>
                      setUrls({ ...urls, [item.application]: event.target.value })
                    }
                  />
                )}
                {progress?.application === item.application && (
                  <div className="mt-3 space-y-2" aria-live="polite">
                    <p className="text-sm text-muted-foreground">{phases[progress.phase]}</p>
                    {ongoing(progress) && (
                      <>
                        <progress
                          className="w-full h-2 accent-primary"
                          aria-label={`${names[item.application]}安装进度`}
                          max={100}
                          value={
                            progress.phase === 'downloading' && progress.total
                              ? Math.min(
                                  100,
                                  Math.floor((progress.downloaded / progress.total) * 100)
                                )
                              : undefined
                          }
                        />
                        {progress.phase === 'downloading' && (
                          <p className="text-xs text-muted-foreground">
                            {size(progress.downloaded)}
                            {progress.total
                              ? ` / ${size(progress.total)} · ${Math.min(100, Math.floor((progress.downloaded / progress.total) * 100))}%`
                              : ' · 下载源未提供总大小'}
                          </p>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={cancelling || progress.phase === 'activating'}
                          onClick={() => {
                            setCancelling(true)
                            void window.api.cancelRuntimeInstall().catch(() => {
                              setCancelling(false)
                              setMessage('取消失败，请重试')
                            })
                          }}
                        >
                          {cancelling
                            ? '正在取消…'
                            : progress.phase === 'activating'
                              ? '即将完成'
                              : '取消安装'}
                        </Button>
                      </>
                    )}
                    {progress.error && (
                      <p role="alert" className="text-sm text-destructive">
                        {progress.error}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  running !== null ||
                  item.status === 'unsupported' ||
                  item.status === 'installed' ||
                  (!!custom[item.application] && !urls[item.application]?.trim())
                }
                onClick={() => void install(item)}
              >
                {running === item.application
                  ? '安装进行中…'
                  : progress?.application === item.application &&
                      ['failed', 'cancelled'].includes(progress.phase)
                    ? `重试安装 ${names[item.application]}`
                    : `安装 ${names[item.application]}`}
              </Button>
            </div>
          ))}
      </div>
      <p role="status" className="text-sm text-muted-foreground mt-3">
        {message}
      </p>
      <Button
        variant="ghost"
        size="sm"
        disabled={running !== null}
        onClick={() => void refresh().catch(() => setMessage('状态检查失败'))}
      >
        重新校验
      </Button>
    </section>
  )
}
