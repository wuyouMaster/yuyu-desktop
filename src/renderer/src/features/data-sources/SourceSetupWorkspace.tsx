import { useEffect, useState } from 'react'
import { Button } from '../../components/ui'
import { RuntimeManagerButton } from '../settings/components/RuntimeManagerButton'
import { RuntimeRestartButton } from '../settings/components/RuntimeRestartButton'
import type { RuntimeInstallationStatus } from '../../../../shared/runtime-installation'
import { pendingSourceSetup, type SetupApplication } from './workspace-entry'

const sources: { id: SetupApplication; name: string; description: string }[] = [
  { id: 'wechat', name: '微信', description: '连接本地微信数据库，浏览会话与聊天记录。' },
  { id: 'dingtalk', name: '钉钉', description: '检测本机钉钉账号，验证后连接只读数据。' },
  { id: 'telegram', name: 'Telegram', description: '连接本机客户端，或直接导入 JSON 导出文件。' }
]
export function SourceSetupWorkspace({
  onConnect,
  onImportTelegram,
  connecting = false
}: {
  onConnect: (application: SetupApplication) => void
  onImportTelegram: () => void
  connecting?: boolean
}): React.ReactElement {
  const [items, setItems] = useState<RuntimeInstallationStatus[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [pending] = useState(pendingSourceSetup)
  const refresh = async (): Promise<void> => {
    setLoading(true)
    try {
      setItems(await window.api.listRuntimeInstallations())
      setError('')
    } catch {
      setError('暂时无法读取运行时状态，请重试。')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    let lastTask = ''
    void refresh()
    const poll = async (): Promise<void> => {
      try {
        const progress = await window.api.getRuntimeInstallProgress?.()
        if (disposed) return
        const task = progress ? `${progress.application}:${progress.phase}` : ''
        if (task !== lastTask && progress?.phase === 'completed') await refresh()
        lastTask = task
      } catch {
        /* Status refresh remains available when progress cannot be read. */
      } finally {
        if (!disposed) timer = setTimeout(() => void poll(), 1000)
      }
    }
    void poll()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [])
  return (
    <main className="source-setup-workspace" aria-label="开始使用">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">尚未连接数据源</p>
        <h1 className="text-2xl font-semibold">从一个数据源开始</h1>
        <p className="text-sm text-muted-foreground">
          选择数据源 → 准备运行时 → 连接账号。连接成功后即可浏览会话；也可以先到设置中配置应用。
        </p>
        {connecting && (
          <p role="status" className="text-sm text-muted-foreground">
            正在准备或连接数据源，请稍候…
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </header>
      <div className="source-setup-cards">
        {sources.map((source) => {
          const item = items.find((candidate) => candidate.application === source.id)
          const ready = item?.status === 'installed' && !item.restartRequired
          const status = loading
            ? '正在检查运行时…'
            : !item
              ? '运行时状态未知'
              : item.status === 'unsupported'
                ? item.error || '当前平台尚无可用运行时'
                : item.status === 'invalid'
                  ? '运行时校验失败，请重新安装'
                  : item.status !== 'installed'
                    ? '尚未安装运行时'
                    : item.restartRequired
                      ? '安装完成，重启后启用'
                      : '运行时已就绪，可继续配置'
          return (
            <section
              key={source.id}
              className="rounded-xl border border-border bg-surface p-5 flex flex-col gap-4"
              aria-label={`${source.name}开始使用`}
            >
              <div className="space-y-2">
                <h2 className="text-lg font-semibold">
                  {source.name}
                  {pending === source.id && (
                    <span className="ml-2 text-sm text-muted-foreground">继续配置</span>
                  )}
                </h2>
                <p className="text-sm text-muted-foreground">{source.description}</p>
              </div>
              <div className="text-sm" role="status">
                {status}
              </div>
              {item && (
                <p className="text-xs text-muted-foreground">
                  {item.version} · {item.target}
                </p>
              )}
              <div className="mt-auto flex flex-wrap gap-2">
                <RuntimeManagerButton
                  application={source.id}
                  label={item?.status === 'installed' ? '管理运行时' : '安装运行时'}
                  onClose={() => void refresh()}
                  disabled={connecting || loading || !item || item.status === 'unsupported'}
                />
                {item?.restartRequired ? (
                  <RuntimeRestartButton application={source.id} />
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={connecting || loading || !ready}
                    onClick={() => onConnect(source.id)}
                  >
                    连接{source.name}
                  </Button>
                )}
                {source.id === 'telegram' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={connecting}
                    onClick={onImportTelegram}
                  >
                    导入 JSON（无需运行时）
                  </Button>
                )}
              </div>
            </section>
          )
        })}
      </div>
      <Button variant="ghost" size="sm" disabled={loading} onClick={() => void refresh()}>
        刷新运行时状态
      </Button>
    </main>
  )
}
