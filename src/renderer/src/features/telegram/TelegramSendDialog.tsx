import { useMemo, useState } from 'react'
import type { EntityId } from '../../../../shared/entity-id'
import { parseEntityId } from '../../../../shared/entity-id'
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

export interface TelegramSendDialogProps {
  open: boolean
  conversationId: EntityId
  displayName: string
  context?: SourceOperationContext
  snapshot?: ProviderSnapshot
  onClose: () => void
  onSent?: () => void
}

function healthMessage(health: ProviderHealth | undefined): string {
  return health?.message || 'Telegram Desktop 发送能力尚未加载。'
}

export function TelegramSendDialog({
  open,
  conversationId,
  displayName,
  context,
  snapshot,
  onClose,
  onSent
}: TelegramSendDialogProps): React.ReactElement {
  const [text, setText] = useState('')
  const [image, setImage] = useState<{
    path: string
    paths?: string[]
    name: string
    type: 'image' | 'file' | 'sticker' | 'album' | 'audio'
  }>()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{
    kind: 'success' | 'error' | 'uncertain'
    text: string
  }>()

  const sendHealth = snapshot?.send?.health
  const sendReady = Boolean(snapshot?.send?.capabilities.canSend && sendHealth?.available)
  const canSubmit =
    !busy &&
    sendReady &&
    (image?.type === 'sticker' || image?.type === 'audio' || text.trim().length > 0)
  const localAccount = snapshot?.accountId
    ? parseEntityId(snapshot.accountId).account.startsWith('telegram-local:')
    : false
  const description = useMemo(() => {
    if (!sendReady) return healthMessage(sendHealth)
    return (
      '发送给 ' +
      displayName +
      '。只有 Telegram 消息列表出现回显才会报告成功；无法确认时请先检查 Telegram，不要重复发送。'
    )
  }, [displayName, sendHealth, sendReady])

  const selectAttachment = async (
    type: 'image' | 'file' | 'sticker' | 'album' | 'audio'
  ): Promise<void> => {
    try {
      const selected = await window.api.selectSourceSendFile(type)
      if (!selected.canceled && selected.path) {
        if (
          type === 'album' &&
          (!selected.paths || selected.paths.length < 2 || selected.paths.length > 10)
        ) {
          setResult({ kind: 'error', text: '相册请选择 2–10 张 PNG 图片。' })
          return
        }
        setResult(undefined)
        setImage({
          path: selected.path,
          paths: selected.paths,
          name:
            type === 'album'
              ? `${selected.paths!.length} 张图片`
              : selected.path.split(/[\\/]/).pop() || '附件',
          type
        })
      }
    } catch {
      setResult({ kind: 'error', text: '附件选择未完成，请重试。' })
    }
  }

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    if (!context) {
      setResult({ kind: 'error', text: '当前 Telegram 数据源尚未确认，请重新加载数据源。' })
      return
    }
    setBusy(true)
    setResult(undefined)
    const content: SendRequest['content'] = image
      ? image.type === 'album'
        ? {
            type: 'image',
            localPaths: image.paths,
            extensions: { telegram: { caption: text.trim() } }
          }
        : image.type === 'sticker' || image.type === 'audio'
          ? { type: image.type, localPath: image.path }
          : {
              type: image.type,
              localPath: image.path,
              extensions: { telegram: { caption: text.trim() } }
            }
      : { type: 'text', text: text.trim() }
    try {
      const response = await window.api.sendUnifiedMessage({
        expectedContext: context,
        conversationId,
        content
      })
      if (response.accepted) {
        setResult({
          kind: 'success',
          text: image
            ? { file: '文件', image: '图片', sticker: '贴纸', album: '相册', audio: '语音气泡' }[
                image.type
              ] + '已发送，并已在 Telegram 中确认新媒体消息。'
            : '文字已发送，并已在 Telegram 中确认回显。'
        })
        setText('')
        setImage(undefined)
        onSent?.()
      } else {
        const message = response.error || 'Telegram 发送失败'
        setResult({
          kind: message.includes('未能确认') ? 'uncertain' : 'error',
          text: message
        })
      }
    } catch (error) {
      setResult({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Telegram 发送失败'
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !busy && onClose()}>
      <DialogContent
        aria-label={'Telegram 发送给 ' + displayName}
        className="max-w-xl"
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        onPointerDownOutside={(event) => busy && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Telegram 发送</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {localAccount && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              图片发送目前支持 Telegram Saved Messages：PNG、5 MiB 以内、宽高不超过 1280
              像素。文件发送支持 32 MiB 以内的单个文件，可包含原图、音频和视频。相册支持 2–10 张
              PNG；静态贴纸支持 512 KiB 以内、宽高不超过 512 像素的 WebP。语音可选择本地音频（32
              MiB、5 分钟以内），自动转为语音气泡。图片、文件和相册需填写说明文字。请先在 Telegram
              打开收藏夹。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy || !sendReady}
                onClick={() => void selectAttachment('image')}
              >
                选择 PNG 图片
              </Button>
              <Button
                variant="outline"
                disabled={busy || !sendReady}
                onClick={() => void selectAttachment('album')}
              >
                选择相册
              </Button>
              <Button
                variant="outline"
                disabled={busy || !sendReady}
                onClick={() => void selectAttachment('sticker')}
              >
                选择贴纸
              </Button>
              <Button
                variant="outline"
                disabled={busy || !sendReady}
                onClick={() => void selectAttachment('audio')}
              >
                选择语音
              </Button>
              <Button
                variant="outline"
                disabled={busy || !sendReady}
                onClick={() => void selectAttachment('file')}
              >
                选择文件
              </Button>
            </div>
            {image && (
              <div>
                {image.name}{' '}
                <Button variant="ghost" disabled={busy} onClick={() => setImage(undefined)}>
                  移除附件
                </Button>
              </div>
            )}
          </div>
        )}
        {image?.type !== 'sticker' && image?.type !== 'audio' && (
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={image ? '输入附件说明文字' : '输入要发送给 ' + displayName + ' 的文字'}
            aria-label={
              image
                ? image.type === 'album'
                  ? 'Telegram 相册说明'
                  : image.type === 'file'
                    ? 'Telegram 文件说明'
                    : 'Telegram 图片说明'
                : 'Telegram 文字消息'
            }
            maxLength={image ? 1024 : 4096}
            disabled={busy || !sendReady}
            autoFocus
          />
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
            {busy
              ? '发送中…'
              : image
                ? '发送' +
                  {
                    file: '文件',
                    image: '图片',
                    sticker: '贴纸',
                    album: '相册',
                    audio: '语音气泡'
                  }[image.type]
                : '发送文字'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
