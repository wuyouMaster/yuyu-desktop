import { useEffect, useMemo, useState } from 'react'
import { resolveUnifiedAsset } from '../utils/unified-entity-adapter'

interface VideoBubbleProps {
  assetId?: string
  md5?: string
  newMd5?: string
  rawMd5?: string
  createTime?: number
  byteLength?: number
  duration?: number
  width?: number
  height?: number
}

export function VideoBubble({
  assetId,
  md5,
  newMd5,
  rawMd5,
  createTime,
  byteLength,
  duration,
  width,
  height
}: VideoBubbleProps): React.ReactElement {
  const hashes = useMemo(
    () => [rawMd5, newMd5, md5].filter((value): value is string => Boolean(value)),
    [md5, newMd5, rawMd5]
  )
  const [media, setMedia] = useState<{ url?: string; poster?: string; error?: string }>({})

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const asset = await resolveUnifiedAsset(assetId)
        if (asset?.state === 'available' && asset.uri) {
          if (!cancelled) {
            setMedia({ url: asset.uri, poster: asset.thumbnailUri })
          }
          return
        }
        if (!hashes.length) {
          if (!cancelled) {
            setMedia({
              error:
                (asset?.extensions?.wechat as { error?: string } | undefined)?.error ||
                '视频暂不可用'
            })
          }
          return
        }
        const result = await window.api.getVideo(hashes, {
          createTime,
          byteLength,
          duration,
          width,
          height
        })
        if (!cancelled) setMedia(result.success ? result : { error: result.error })
      } catch (error) {
        if (!cancelled) setMedia({ error: error instanceof Error ? error.message : String(error) })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [assetId, byteLength, createTime, duration, hashes, height, width])

  if (!media.url) {
    return <div className="video-placeholder">{media.error || '视频加载中…'}</div>
  }

  return (
    <div className="video-message">
      <video
        className="video-content"
        src={media.url}
        poster={media.poster}
        controls
        preload="metadata"
      />
      {duration ? <span className="video-duration">{duration} 秒</span> : null}
    </div>
  )
}
