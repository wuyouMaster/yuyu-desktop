import { useEffect, useRef, useState } from 'react'
import type { TelegramLocalInspection } from '../../../../shared/telegram-local'
import type { TelegramMacOSInspection } from '../../../../shared/telegram-macos'
import { Button } from '../../components/ui'

export function TelegramLocalSourceCard({
  onConnect,
  onConnectMacOS
}: {
  onConnect?: (slot: number, account: string) => Promise<void>
  onConnectMacOS?: (candidateId: string) => Promise<void>
}): React.ReactElement {
  const [clientType, setClientType] = useState<'telegram-macos' | 'telegram-desktop'>(
    'telegram-macos'
  )
  const [inspection, setInspection] = useState<TelegramLocalInspection>()
  const [macOSInspection, setMacOSInspection] = useState<TelegramMacOSInspection>()
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(false)
  const epoch = useRef(0)
  const nativeMacOS = clientType === 'telegram-macos'
  useEffect(
    () => () => {
      epoch.current += 1
    },
    []
  )

  const selectClient = (next: typeof clientType): void => {
    if (connecting || next === clientType) return
    epoch.current += 1
    setClientType(next)
    setInspection(undefined)
    setMacOSInspection(undefined)
    setChecking(false)
    setError('')
  }

  const inspect = async (): Promise<void> => {
    const request = ++epoch.current
    setChecking(true)
    setError('')
    setInspection(undefined)
    setMacOSInspection(undefined)
    try {
      if (nativeMacOS) {
        const result = await window.api.inspectTelegramMacOSSource()
        if (epoch.current === request) setMacOSInspection(result)
      } else {
        const result = await window.api.inspectTelegramLocalSource()
        if (epoch.current === request) setInspection(result)
      }
    } catch {
      if (epoch.current === request) setError('Telegram 本地检测未完成，请重试。')
    } finally {
      if (epoch.current === request) setChecking(false)
    }
  }

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Telegram 客户端" className="flex flex-wrap gap-2">
        <Button
          variant={nativeMacOS ? 'secondary' : 'outline'}
          aria-pressed={nativeMacOS}
          disabled={connecting}
          onClick={() => selectClient('telegram-macos')}
        >
          Telegram（macOS 原生版）
        </Button>
        <Button
          variant={nativeMacOS ? 'outline' : 'secondary'}
          aria-pressed={!nativeMacOS}
          disabled={connecting}
          onClick={() => selectClient('telegram-desktop')}
        >
          Telegram Desktop
        </Button>
      </div>
      {nativeMacOS ? (
        <p className="text-sm text-muted-foreground">
          连接 macOS 原生 Telegram 的本地账号，只读浏览已缓存的会话和消息，按需加载更多。
          本地记录不代表完整云端历史；暂不支持历史补载、发送和附件下载，媒体播放尚未接通。
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          需运行本机 Telegram Desktop
          并具备可用的本地读取能力。连接后先读取已加载的会话和消息，不代表完整历史。
          可对选定会话或当前账号补载，补载会操作客户端打开会话并滚动，可随时停止；只有补载确认完整时才标记为完整历史。
          图片、语音、视频、贴纸和文件按需读取本地缓存；未缓存附件可在加载时请求 Telegram 下载。
          支持文字发送和向 Saved Messages 发送 PNG
          图片、文件、语音气泡、静态贴纸与相册，附件范围以发送窗口说明为准；仅在消息列表确认回显后报告成功。
        </p>
      )}
      <Button variant="outline" disabled={checking || connecting} onClick={() => void inspect()}>
        {checking
          ? '正在读取本地账号…'
          : inspection || macOSInspection
            ? '重新检测 Telegram'
            : '检测本机 Telegram'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {macOSInspection && (
        <div role="status" aria-live="polite" className="space-y-2 text-sm">
          <p>{macOSInspection.message}</p>
          {macOSInspection.state === 'detected' &&
            macOSInspection.candidates.map((candidate) => (
              <div key={candidate.id} className="rounded-md bg-accent p-3 space-y-2">
                <strong>{candidate.label}</strong>
                <p className="text-muted-foreground">macOS 原生版 · 本地只读</p>
                {onConnectMacOS && (
                  <Button
                    variant="outline"
                    disabled={connecting || checking}
                    onClick={async () => {
                      const request = ++epoch.current
                      setConnecting(true)
                      setError('')
                      try {
                        await onConnectMacOS(candidate.id)
                      } catch (reason) {
                        if (epoch.current === request)
                          setError(reason instanceof Error ? reason.message : '本地消息读取失败')
                      } finally {
                        if (epoch.current === request) setConnecting(false)
                      }
                    }}
                  >
                    {connecting ? '正在读取本地消息…' : '只读连接此账号'}
                  </Button>
                )}
              </div>
            ))}
        </div>
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
