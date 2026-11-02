import { useState, useCallback, useEffect, useRef } from 'react'
import type { JSX, KeyboardEvent, MouseEvent } from 'react'
import { getCachedLoadedImage, requestImage } from './image-loader'
import { resolveUnifiedAsset } from '../utils/unified-entity-adapter'
import { isMissingImageKeyError, useImageKeyGuidance } from './chat/image-key-guidance'
import { Button } from './ui'

interface ImageBubbleProps {
  assetId?: string
  imageMd5?: string
  imageDatName?: string
  sessionId?: string
  isThumb?: boolean
  fallbackUrl?: string
  onImageClick?: (imageUrl: string) => void
}

export function ImageBubble({
  assetId,
  imageMd5,
  imageDatName,
  sessionId,
  fallbackUrl,
  onImageClick
}: ImageBubbleProps): JSX.Element {
  const guidance = useImageKeyGuidance()
  const initialCachedImage = getCachedLoadedImage(imageMd5, imageDatName, {
    preferThumbnail: true
  })
  const [imageUrl, setImageUrl] = useState<string | null>(initialCachedImage?.data || null)
  const [loading, setLoading] = useState(false)
  const [upgrading, setUpgrading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usingFallback, setUsingFallback] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)
  const requiresWechatKey = Boolean(
    (imageMd5 || imageDatName || assetId?.startsWith('wechat:')) &&
    (!assetId || assetId.startsWith('wechat:')) &&
    !fallbackUrl
  )
  const missingKey =
    !imageUrl &&
    (isMissingImageKeyError(error) ||
      (!error && requiresWechatKey && guidance?.configured === false))
  const previousConfiguredRef = useRef(guidance?.configured)

  useEffect(() => {
    if (!missingKey || !guidance?.registerLockedImage) return
    return guidance.registerLockedImage()
  }, [missingKey, guidance?.registerLockedImage])

  useEffect(() => {
    const newlyConfigured = previousConfiguredRef.current === false && guidance?.configured === true
    previousConfiguredRef.current = guidance?.configured
    if (newlyConfigured && isMissingImageKeyError(error)) setError(null)
  }, [guidance?.configured, error])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const loadImage = useCallback(
    async (priority = 0) => {
      if (imageUrl) return
      if (!imageMd5 && !imageDatName) {
        if (assetId) {
          const asset = await resolveUnifiedAsset(assetId)
          if (asset?.state === 'available' && asset.uri) {
            if (!mountedRef.current) return
            setImageUrl(asset.uri)
            setUsingFallback(false)
            setError(null)
            return
          }
          if (!fallbackUrl) {
            setError(
              (asset?.extensions?.wechat as { error?: string } | undefined)?.error || '图片未缓存'
            )
            return
          }
        }
        if (fallbackUrl) {
          setImageUrl(fallbackUrl)
          setUsingFallback(true)
          setError(null)
          return
        }
        setError('缺少图片标识')
        return
      }
      if (loading) {
        if (priority === 0) {
          void requestImage(
            imageMd5,
            imageDatName,
            sessionId,
            { preferThumbnail: true },
            priority
          ).catch(() => undefined)
        }
        return
      }

      setLoading(true)
      try {
        if (assetId) {
          const asset = await resolveUnifiedAsset(assetId)
          if (asset?.state === 'available' && asset.uri) {
            if (!mountedRef.current) return
            setImageUrl(asset.uri)
            setUsingFallback(false)
            setError(null)
            return
          }
        }
        const result = await requestImage(
          imageMd5,
          imageDatName,
          sessionId,
          { preferThumbnail: true },
          priority
        )
        if (!mountedRef.current) return
        setImageUrl(result.data)
        setUsingFallback(false)
        setError(null)
      } catch (error) {
        if (!mountedRef.current) return
        if (fallbackUrl) {
          setImageUrl(fallbackUrl)
          setUsingFallback(true)
          setError(null)
        } else {
          setError(error instanceof Error ? error.message : '加载图片失败')
        }
      } finally {
        if (mountedRef.current) setLoading(false)
      }
    },
    [assetId, fallbackUrl, imageDatName, imageMd5, imageUrl, loading, sessionId]
  )

  useEffect(() => {
    if (imageUrl || error) return
    const element = containerRef.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      const timer = window.setTimeout(() => void loadImage(0), 0)
      return () => window.clearTimeout(timer)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.find((candidate) => candidate.isIntersecting)
        if (!entry) return
        const rect = entry.boundingClientRect
        const isInViewport =
          rect.bottom >= 0 &&
          rect.top <= window.innerHeight &&
          rect.right >= 0 &&
          rect.left <= window.innerWidth
        observer.disconnect()
        void loadImage(isInViewport ? 0 : 1)
      },
      { rootMargin: loading ? '0px' : '400px 0px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [error, imageUrl, loadImage, loading])

  const handleCopy = async (event: MouseEvent): Promise<void> => {
    event.stopPropagation()
    if (!imageUrl) return
    await window.api.copyImage(imageUrl)
    alert('图片已复制')
  }

  const handleClick = async (): Promise<void> => {
    if (!imageUrl && !error) return
    if (!imageMd5 && !imageDatName) {
      if (assetId) {
        const asset = await resolveUnifiedAsset(assetId)
        if (asset?.state === 'available' && asset.uri) {
          setImageUrl(asset.uri)
          setError(null)
          onImageClick?.(asset.uri)
          return
        }
      }
      if (imageUrl) onImageClick?.(imageUrl)
      return
    }

    if (upgrading) {
      if (imageUrl) onImageClick?.(imageUrl)
      return
    }

    setUpgrading(true)
    try {
      if (assetId) {
        const asset = await resolveUnifiedAsset(assetId)
        if (asset?.state === 'available' && asset.uri) {
          setImageUrl(asset.uri)
          setUsingFallback(false)
          setError(null)
          onImageClick?.(asset.uri)
          return
        }
      }
      const result = await requestImage(imageMd5, imageDatName, sessionId, { force: true }, 0)
      if (result.data.startsWith('data:image/') || result.data.startsWith('yuyu-media://')) {
        setImageUrl(result.data)
        setUsingFallback(false)
        setError(null)
        onImageClick?.(result.data)
        return
      }
    } catch {
      // Fall back to the already visible image.
    } finally {
      setUpgrading(false)
    }

    if (imageUrl) onImageClick?.(imageUrl)
  }

  const handlePreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    void handleClick()
  }

  if (missingKey) {
    const content = (
      <>
        <svg
          className="image-key-lock-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="5" y="10" width="14" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
        </svg>
        <strong>图片待解锁</strong>
        <span>请先配置图片密钥</span>
      </>
    )
    return (
      <div ref={containerRef} className="image-bubble image-key-required">
        {guidance ? (
          <Button
            variant="ghost"
            className="image-key-required-action"
            onClick={guidance.onOpenSettings}
            aria-label="图片待解锁，前往配置图片密钥"
          >
            {content}
          </Button>
        ) : (
          content
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div ref={containerRef} className="image-bubble image-loading" onClick={handleClick}>
        <div className="image-loading-skeleton" aria-hidden />
        <div className="image-quality-badge">加载中</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="image-bubble image-error" onClick={() => void loadImage(0)}>
        <div className="image-error-text">{error || '图片未缓存'}</div>
        <div className="image-quality-badge">加载失败</div>
      </div>
    )
  }

  if (!imageUrl) {
    return (
      <div ref={containerRef} className="image-bubble image-placeholder">
        <div className="image-loading-skeleton" aria-hidden />
        <div className="image-quality-badge">加载中</div>
      </div>
    )
  }

  return (
    <div
      className="image-bubble image-loaded"
      role="button"
      tabIndex={0}
      aria-label="查看图片"
      onClick={handleClick}
      onKeyDown={handlePreviewKeyDown}
    >
      <img
        src={imageUrl}
        alt="图片"
        className={`image-content ${usingFallback ? 'image-fallback' : ''}`}
      />
      {upgrading && <div className="image-quality-badge">正在查找原图</div>}
      <div className="image-actions">
        <button className="image-action-btn" onClick={handleCopy} title="复制图片">
          复制
        </button>
      </div>
    </div>
  )
}
