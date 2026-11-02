import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '../../components/ui'
import type {
  DingtalkDatabaseFormat,
  DingtalkLocalInspection
} from '../../../../shared/dingtalk-local'
import { TelegramLocalSourceCard } from '../telegram/TelegramLocalSourceCard'

const FORMAT_LABELS: Record<DingtalkDatabaseFormat, string> = {
  sqlite: 'SQLite 文件 · 待验证消息结构',
  encoded_or_unknown: '非明文 SQLite · 待验证解码方式',
  truncated: '文件不完整',
  missing: '未找到',
  unreadable: '无法读取'
}

export function AddDataSourceDialog({
  application,
  open,
  onOpenChange,
  onAddWechat,
  onConnectDingtalk,
  onImportTelegram,
  onConnectTelegramLocal
}: {
  application?: 'wechat' | 'dingtalk' | 'telegram'
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddWechat: () => void
  onConnectDingtalk: () => void
  onImportTelegram: () => void
  onConnectTelegramLocal?: (slot: number, account: string) => Promise<void>
}): React.ReactElement {
  const [inspection, setInspection] = useState<DingtalkLocalInspection>()
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const epoch = useRef(0)
  useEffect(() => {
    if (!open) {
      epoch.current += 1
      setChecking(false)
    }
    return () => {
      epoch.current += 1
    }
  }, [open])

  const inspect = async (): Promise<void> => {
    const request = ++epoch.current
    setChecking(true)
    setError('')
    setInspection(undefined)
    try {
      const result = await window.api.inspectDingtalkLocalSource()
      if (epoch.current === request) setInspection(result)
    } catch {
      if (epoch.current === request) setError('本地检测未完成，请重试。')
    } finally {
      if (epoch.current === request) setChecking(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>添加数据源</DialogTitle>
          <DialogDescription>选择本机数据来源，查看可以连接的账号与能力。</DialogDescription>
        </DialogHeader>
        {(!application || application === 'wechat') && (
          <section
            className="rounded-lg border border-border p-4 space-y-3"
            aria-label="微信数据源"
          >
            <h3 className="font-semibold">微信</h3>
            <p className="text-sm text-muted-foreground">连接本地数据库，读取会话与聊天记录。</p>
            <Button variant="outline" onClick={onAddWechat}>
              选择微信数据目录
            </Button>
          </section>
        )}
        {(!application || application === 'dingtalk') && (
          <section
            className="rounded-lg border border-border p-4 space-y-3"
            aria-label="钉钉数据源"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">钉钉</h3>
              <span className="text-xs text-muted-foreground">
                {inspection?.accounts.some((account) => account.canRead) ? '可连接' : '本机只读'}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              读取本机钉钉会话和消息，用于浏览与分析。当前不支持发送，组织身份和媒体解析仍在完善。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={checking} onClick={() => void inspect()}>
                {checking ? '正在检测…' : inspection ? '重新检测钉钉' : '检测本机钉钉'}
              </Button>
              {inspection?.accounts.some((account) => account.canRead) && (
                <Button onClick={onConnectDingtalk}>连接钉钉只读数据</Button>
              )}
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {inspection && (
              <div className="space-y-3 text-sm" role="status" aria-live="polite">
                {inspection.client && (
                  <p>
                    钉钉 {inspection.client.version} · build {inspection.client.build}
                  </p>
                )}
                <p>{inspection.message}</p>
                {inspection.accounts.map((account) => (
                  <div key={account.id} className="rounded-md bg-accent p-3 space-y-1">
                    <strong>
                      {account.label} · {account.canRead ? '可读取' : '尚未连接'}
                    </strong>
                    {account.databases.map((database) => (
                      <p key={database.name} className="text-muted-foreground">
                        {database.name}：{FORMAT_LABELS[database.format]}
                        {database.walPresent ? '（存在增量日志）' : ''}
                      </p>
                    ))}
                  </div>
                ))}
                {inspection.truncated && <p>目录较多，本次仅检查前 200 个子目录。</p>}
                {inspection.accounts.length > 0 && (
                  <p className="text-muted-foreground">
                    {inspection.accounts.some((account) => account.canRead)
                      ? '连接后会进入钉钉只读工作区。不会修改钉钉数据，也不会把账号目录推断为某个公司身份。'
                      : '请先登录钉钉并重新检测。无需填写微信密钥；读取验证通过后才会开放切换。'}
                  </p>
                )}
              </div>
            )}
          </section>
        )}
        {(!application || application === 'telegram') && (
          <section
            className="rounded-lg border border-border p-4 space-y-3"
            aria-label="Telegram 数据源"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">Telegram</h3>
              <span className="text-xs text-muted-foreground">本地客户端 · JSON 导入</span>
            </div>
            <TelegramLocalSourceCard onConnect={onConnectTelegramLocal} />
            <p className="text-sm text-muted-foreground">
              导入 Telegram Desktop JSON 导出文件，浏览私聊、群组、频道和消息。发送通过正在运行的
              Telegram Desktop 完成，目前只支持文字，并需要 macOS Accessibility
              权限；媒体仍只保留元数据。
            </p>
            <Button variant="outline" onClick={onImportTelegram}>
              选择 Telegram JSON 导出
            </Button>
          </section>
        )}
      </DialogContent>
    </Dialog>
  )
}
