import { useMemo, useState } from 'react'
import type { EntityId } from '../../../../shared/entity-id'
import type { ProviderHealth, ProviderSnapshot, SendRequest } from '../../../../shared/data-source'
import type { SourceOperationContext } from '../../../../shared/source-context'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea
} from '../../components/ui'

type SendMode = 'text' | 'image' | 'audio'
type SelectedFile = { path: string; name: string }

export interface DingtalkSendDialogProps {
  open: boolean
  conversationId: EntityId
  displayName: string
  context?: SourceOperationContext
  snapshot?: ProviderSnapshot
  onClose: () => void
  onSent?: () => void
}

function healthMessage(health: ProviderHealth | undefined): string {
  return health?.message || '钉钉发送能力尚未加载，请先启动并登录钉钉。'
}

export function DingtalkSendDialog({
  open,
  conversationId,
  displayName,
  context,
  snapshot,
  onClose,
  onSent
}: DingtalkSendDialogProps): React.ReactElement {
  const [mode, setMode] = useState<SendMode>('text')
  const [text, setText] = useState('')
  const [file, setFile] = useState<SelectedFile>()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ kind: 'success' | 'error' | 'uncertain'; text: string }>()

  const sendHealth = snapshot?.send?.health
  const sendReady = Boolean(snapshot?.send?.capabilities.canSend && sendHealth?.available)
  const modeLabel = mode === 'text' ? '文字' : mode === 'image' ? '图片' : '语音'
  const canSubmit = !busy && sendReady && (mode === 'text' ? text.trim().length > 0 : Boolean(file))

  const description = useMemo(() => {
    if (!sendReady) return healthMessage(sendHealth)
    return `发送给 ${displayName}。发送结果以钉钉回调为准；若无法确认，请先检查目标会话，不要重复发送。`
  }, [displayName, sendHealth, sendReady])

  const selectFile = async (): Promise<void> => {
    setResult(undefined)
    const selected = await window.api.selectDingtalkSendFile?.(mode === 'image' ? 'image' : 'audio')
    if (!selected || selected.canceled || !selected.path) return
    const path = selected.path
    setFile({ path, name: path.split(/[\/]/).pop() || path })
  }

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    if (!context) {
      setResult({ kind: 'error', text: '当前钉钉发送身份尚未确认，请重新加载数据源。' })
      return
    }
    setBusy(true)
    setResult(undefined)
    const content: SendRequest['content'] =
      mode === 'text'
        ? { type: 'text', text: text.trim() }
        : mode === 'image'
          ? { type: 'image', localPath: file!.path }
          : { type: 'audio', localPath: file!.path }
    try {
      const response = await window.api.sendUnifiedMessage({
        expectedContext: context,
        conversationId,
        content
      })
      if (response.accepted) {
        setResult({ kind: 'success', text: `${modeLabel}已提交给钉钉` })
        if (mode === 'text') setText('')
        setFile(undefined)
        onSent?.()
      } else {
        const message = response.error || `${modeLabel}发送失败`
        setResult({
          kind: message.includes('未能确认') ? 'uncertain' : 'error',
          text: message
        })
      }
    } catch (error) {
      setResult({
        kind: 'error',
        text: error instanceof Error ? error.message : `${modeLabel}发送失败`
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !busy && onClose()}>
      <DialogContent
        aria-label={`钉钉发送给 ${displayName}`}
        className="max-w-xl"
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        onPointerDownOutside={(event) => busy && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>钉钉发送</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2" role="tablist" aria-label="钉钉消息类型">
          {(['text', 'image', 'audio'] as const).map((item) => (
            <Button
              key={item}
              type="button"
              variant={mode === item ? 'default' : 'outline'}
              size="sm"
              role="tab"
              aria-selected={mode === item}
              onClick={() => {
                setMode(item)
                setFile(undefined)
                setResult(undefined)
              }}
              disabled={busy}
            >
              {item === 'text' ? '文字' : item === 'image' ? '图片' : '语音'}
            </Button>
          ))}
        </div>

        {mode === 'text' ? (
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={`输入要发送给 ${displayName} 的文字`}
            aria-label="钉钉文字消息"
            disabled={busy || !sendReady}
            autoFocus
          />
        ) : (
          <div className="rounded-lg border border-border-subtle bg-muted/20 p-4 text-sm">
            <p className="text-muted-foreground">
              仅支持 {mode === 'image' ? 'PNG、JPEG' : 'Ogg/Opus'} 文件。
            </p>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">{file?.name || '尚未选择文件'}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void selectFile()}
                disabled={busy}
              >
                选择文件
              </Button>
            </div>
          </div>
        )}

        {result && (
          <div
            role="status"
            className={
              result.kind === 'success'
                ? 'rounded-md bg-primary/10 p-3 text-sm text-primary'
                : result.kind === 'uncertain'
                  ? 'rounded-md bg-warning/10 p-3 text-sm text-warning-foreground'
                  : 'rounded-md bg-destructive/10 p-3 text-sm text-destructive'
            }
          >
            {result.text}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            关闭
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={!canSubmit}>
            {busy ? '发送中…' : `发送${modeLabel}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
