import { useEffect, useRef, useState } from 'react'
import type { Asset, Message } from '../../../../shared/domain-entities'
import type { Message as LegacyMessage } from '../../../../shared/types'
import { readContextKey, type ReadContext } from '../../../../shared/source-context'
import { ImageBubble } from '../../components/ImageBubble'
import { Button } from '../../components/ui'

type MediaContent = Extract<
  Message['content'],
  { type: 'image' | 'audio' | 'video' | 'file' | 'sticker' }
>

export interface TelegramDisplayMessage extends LegacyMessage {
  telegramMedia?: MediaContent
  caption?: string
}

const labels = { image: '图片', audio: '语音', video: '视频', file: '文件', sticker: '贴纸' }

export function TelegramMedia({
  content,
  context,
  onImageClick
}: {
  content: MediaContent
  context?: ReadContext
  onImageClick: (url: string) => void
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)
  const [requested, setRequested] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [asset, setAsset] = useState<Asset>()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingInClient, setLoadingInClient] = useState(false)
  const [clientStatus, setClientStatus] = useState('')
  const requestKey = JSON.stringify([content.assetId, context ? readContextKey(context) : null])
  const currentRequest = useRef(requestKey)
  currentRequest.current = requestKey
  const loadGeneration = useRef(0)
  const [saveStatus, setSaveStatus] = useState<{
    kind: 'success' | 'error' | 'canceled'
    text: string
  }>()
  const label = labels[content.type]
  const canResolve = Boolean(
    content.assetId && context && typeof window.api.resolveUnifiedAsset === 'function'
  )
  const details = asset?.extensions?.telegram
  const previewOnly = Boolean(
    details &&
    typeof details === 'object' &&
    'previewOnly' in details &&
    details.previewOnly === true
  )
  const videoSticker =
    content.type === 'sticker' && Boolean(asset?.mimeType?.toLowerCase().startsWith('video/'))
  const loadInClient = async (): Promise<void> => {
    if (loadingInClient || !content.assetId || !context || !window.api.loadTelegramMedia) return
    const current = currentRequest.current
    const generation = ++loadGeneration.current
    const isCurrent = (): boolean =>
      mounted.current && currentRequest.current === current && loadGeneration.current === generation
    setLoadingInClient(true)
    setClientStatus('正在定位附件；未缓存时将请求 Telegram 下载，完成后自动加载。')
    try {
      const resolved = await window.api.loadTelegramMedia({
        assetId: content.assetId,
        expectedContext: context.expected
      })
      if (!isCurrent()) return
      if (resolved.state === 'available' && resolved.uri) {
        setAsset(resolved)
        setError('')
      }
      const info = resolved.extensions?.telegram
      const partial = Boolean(
        info && typeof info === 'object' && 'previewOnly' in info && info.previewOnly
      )
      setClientStatus(
        resolved.state === 'available' && resolved.uri && !partial
          ? '附件已从本地缓存加载'
          : '尚未取得完整附件，Telegram 可能仍在下载。请稍后重试加载；不会重复提交下载请求。'
      )
    } catch (reason) {
      if (isCurrent())
        setClientStatus(reason instanceof Error ? reason.message : 'Telegram 附件定位失败')
    } finally {
      if (isCurrent()) setLoadingInClient(false)
    }
  }

  useEffect(() => {
    ++loadGeneration.current
    setLoadingInClient(false)
    setClientStatus('')
  }, [requestKey])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const saveFile = async (): Promise<void> => {
    if (saving || !content.assetId || typeof window.api.saveUnifiedAsset !== 'function') return
    setSaving(true)
    setSaveStatus(undefined)
    try {
      const result = await window.api.saveUnifiedAsset(content.assetId, context)
      if (!mounted.current) return
      setSaveStatus(
        result.success
          ? { kind: 'success', text: '附件已保存' }
          : result.canceled
            ? { kind: 'canceled', text: '已取消保存' }
            : { kind: 'error', text: result.error || '附件保存失败，请重试' }
      )
    } catch {
      if (mounted.current) setSaveStatus({ kind: 'error', text: '附件保存失败，请重试' })
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  useEffect(() => {
    if (requested || !canResolve || typeof IntersectionObserver === 'undefined') return
    const element = containerRef.current
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        setRequested(true)
      },
      { rootMargin: '160px 0px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [canResolve, requested])

  useEffect(() => {
    if (!requested || !content.assetId || !context || !canResolve) return
    setAsset(undefined)
    setError('')
    let active = true
    void window.api.resolveUnifiedAsset(content.assetId, context).then(
      (resolved) => {
        if (!active) return
        if (resolved.state === 'available' && resolved.uri) setAsset(resolved)
        else setError(`${label}暂不可用，未找到可用附件`)
      },
      () => {
        if (active) setError(`${label}读取失败，请重试`)
      }
    )
    return () => {
      active = false
    }
  }, [attempt, canResolve, content.assetId, context, label, requested])

  return (
    <div ref={containerRef} data-testid="telegram-media" className="max-w-full">
      {error ? (
        <div role="status" className="flex flex-wrap items-center gap-2 text-sm">
          <span>{error}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={loadingInClient}
            onClick={() => {
              setAsset(undefined)
              setError('')
              setAttempt((value) => value + 1)
            }}
          >
            重试{label}
          </Button>
        </div>
      ) : asset?.uri ? (
        <div onErrorCapture={() => setError(`${label}加载失败，附件可能已失效或格式不受支持`)}>
          {previewOnly && (
            <p className="text-sm text-muted-foreground">图片预览，原图尚未完整缓存</p>
          )}
          {content.type === 'image' || (content.type === 'sticker' && !videoSticker) ? (
            <ImageBubble
              key={JSON.stringify([requestKey, asset.uri])}
              fallbackUrl={asset.uri}
              onImageClick={onImageClick}
            />
          ) : content.type === 'audio' ? (
            <audio
              className="max-w-full"
              aria-label="Telegram 语音"
              src={asset.uri}
              controls
              preload="none"
            />
          ) : content.type === 'video' || videoSticker ? (
            <div className="video-message">
              <video
                aria-label={videoSticker ? 'Telegram 视频贴纸' : 'Telegram 视频'}
                className="video-content"
                src={asset.uri}
                poster={asset.thumbnailUri}
                controls
                muted={videoSticker}
                loop={videoSticker}
                playsInline
                preload="none"
              />
            </div>
          ) : (
            <div className="file-message">
              <Button
                variant="outline"
                disabled={saving || typeof window.api.saveUnifiedAsset !== 'function'}
                onClick={() => void saveFile()}
              >
                <span aria-hidden>📎</span>
                {saving
                  ? '正在保存…'
                  : asset.name ||
                    (content.type === 'file' ? content.name : undefined) ||
                    '保存文件'}
              </Button>
              {saveStatus && (
                <small role={saveStatus.kind === 'error' ? 'alert' : 'status'}>
                  {saveStatus.text}
                </small>
              )}
              {typeof window.api.saveUnifiedAsset !== 'function' && (
                <small>当前连接不支持保存附件</small>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            {!canResolve
              ? `${label}消息（附件内容尚未读取）`
              : requested
                ? `${label}读取中…`
                : `${label}尚未加载`}
          </span>
          {!canResolve && (
            <small>
              {!content.assetId
                ? '附件不可用：缺少附件标识'
                : !context
                  ? '附件不可用：数据源上下文尚未就绪'
                  : '附件不可用：当前连接不支持附件解析'}
            </small>
          )}
          {content.type === 'file' && content.name && <span>{content.name}</span>}
          {canResolve && !requested && (
            <Button variant="outline" size="sm" onClick={() => setRequested(true)}>
              加载{label}
            </Button>
          )}
        </div>
      )}
      {(error || previewOnly) && canResolve && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {typeof window.api.loadTelegramMedia === 'function' && (
            <Button
              variant="outline"
              size="sm"
              disabled={loadingInClient}
              onClick={() => void loadInClient()}
            >
              {loadingInClient ? '正在加载…' : '在 Telegram 中加载'}
            </Button>
          )}
          {previewOnly && (
            <Button
              variant="outline"
              size="sm"
              disabled={loadingInClient}
              onClick={() => setAttempt((value) => value + 1)}
            >
              重试原图
            </Button>
          )}
        </div>
      )}
      {clientStatus && (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {clientStatus}
        </p>
      )}
    </div>
  )
}
