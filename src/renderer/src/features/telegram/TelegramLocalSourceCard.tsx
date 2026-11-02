import { useEffect, useRef, useState } from 'react'
import type { TelegramLocalInspection } from '../../../../shared/telegram-local'
import { Button } from '../../components/ui'

export function TelegramLocalSourceCard({
  onConnect
}: {
  onConnect?: (slot: number, account: string) => Promise<void>
}): React.ReactElement {
  const [inspection, setInspection] = useState<TelegramLocalInspection>()
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(false)
  const epoch = useRef(0)
  useEffect(
    () => () => {
      epoch.current += 1
    },
    []
  )

  const inspect = async (): Promise<void> => {
    const request = ++epoch.current
    setChecking(true)
    setError('')
    setInspection(undefined)
    try {
      const result = await window.api.inspectTelegramLocalSource()
      if (epoch.current === request) setInspection(result)
    } catch {
      if (epoch.current === request) setError('Telegram 本地检测未完成，请重试。')
    } finally {
      if (epoch.current === request) setChecking(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        需运行本机 Telegram Desktop
        并具备可用的本地读取能力。连接后先读取已加载的会话和消息，不代表完整历史。
        可对选定会话或当前账号补载，补载会操作客户端打开会话并滚动，可随时停止；只有补载确认完整时才标记为完整历史。
        图片、语音、视频、贴纸和文件按需读取本地缓存；未缓存附件可在加载时请求 Telegram 下载。
        支持文字发送和向 Saved Messages 发送 PNG
        图片、文件、语音气泡、静态贴纸与相册，附件范围以发送窗口说明为准；仅在消息列表确认回显后报告成功。
      </p>
      <Button variant="outline" disabled={checking || connecting} onClick={() => void inspect()}>
        {checking ? '正在读取本地账号…' : inspection ? '重新检测 Telegram' : '检测本机 Telegram'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {inspection && (
        <div role="status" aria-live="polite" className="space-y-2 text-sm">
          <p>{inspection.message}</p>
          {inspection.accounts.map((account) => (
            <div key={account.id} className="rounded-md bg-accent p-3 space-y-1">
              <strong>{account.label}</strong>
              <p className="text-muted-foreground">
                {account.state === 'metadata_read' ? '账号资料已读取' : '账号资料未能读取'} ·
                聊天记录未连接
              </p>
              {account.hasMediaCache && <p>已发现媒体缓存目录，连接后按需读取缓存。</p>}
              {onConnect && account.state === 'metadata_read' && (
                <Button
                  variant="outline"
                  disabled={connecting || checking}
                  onClick={async () => {
                    const request = ++epoch.current
                    setConnecting(true)
                    setError('')
                    try {
                      await onConnect(account.slot, account.id)
                    } catch (reason) {
                      if (epoch.current === request)
                        setError(reason instanceof Error ? reason.message : '本地消息读取失败')
                    } finally {
                      if (epoch.current === request) setConnecting(false)
                    }
                  }}
                >
                  {connecting ? '正在读取本地消息…' : '读取此账号已加载的消息'}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
