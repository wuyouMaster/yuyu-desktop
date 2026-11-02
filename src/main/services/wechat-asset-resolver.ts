import type { Asset, AssetKind } from '../../shared/domain-entities'
import type { EntityId } from '../../shared/entity-id'

export interface WechatAssetHint {
  assetId: EntityId
  assetKind: AssetKind
  native: string
  name?: string
  mimeType?: string
  byteLength?: number
  durationMs?: number
  image?: {
    md5?: string
    datName?: string
    sessionId?: string
    createTime?: number
  }
  video?: {
    hashes: string[]
    createTime?: number
    byteLength?: number
    duration?: number
    width?: number
    height?: number
  }
  audio?: {
    sessionId?: string
    localId?: number
    serverId?: string
    createTime?: number
  }
  sticker?: {
    url?: string
    md5?: string
    thumbUrl?: string
    encryptUrl?: string
    aeskey?: string
  }
  file?: {
    name?: string
    createTime?: number
  }
}

interface ImageDecryptServiceLike {
  findImageFileAsync(
    md5?: string,
    imageDatName?: string,
    options?: { allowThumbnail?: boolean; sessionId?: string; createTime?: number }
  ): Promise<string | null>
  decryptImageToBase64WithFallbackAsync(
    datPath: string,
    allowThumbnail?: boolean
  ): Promise<{ data: string } | null>
}

interface VideoAssetServiceLike {
  resolve(
    hashes: string[],
    options?: {
      createTime?: number
      byteLength?: number
      duration?: number
      width?: number
      height?: number
    }
  ): Promise<{ success: boolean; url?: string; poster?: string; error?: string }>
}

interface VoiceServiceLike {
  resolveVoice(
    sessionId: string,
    localId: number,
    createTime: number,
    serverId?: string | number
  ): Promise<{ success: boolean; data?: string; error?: string }>
}

interface StickerServiceLike {
  resolveSticker(
    url?: string,
    md5?: string,
    options?: { encryptUrl?: string; aeskey?: string }
  ): Promise<{ success: boolean; data?: string; error?: string }>
}

interface FileAssetServiceLike {
  resolve(
    fileName: string,
    createTime?: number
  ): { success: boolean; filePath?: string; fileName?: string; error?: string }
}

export interface WechatAssetRuntime {
  getImageDecryptService(): ImageDecryptServiceLike | null
  getVideoAssetService(): VideoAssetServiceLike | null
  getVoiceService(): VoiceServiceLike | null
  getStickerService(): StickerServiceLike | null
  getFileAssetService(): FileAssetServiceLike | null
  createLocalMediaUrl(filePath: string): string | undefined
}

export interface ResolvedWechatAsset {
  state: Asset['state']
  uri?: string
  thumbnailUri?: string
  mimeType?: string
  name?: string
  error?: string
}

export interface WechatAssetProviderResolver {
  resolve(hint: WechatAssetHint): Promise<ResolvedWechatAsset>
}

const unavailable = (error: string): ResolvedWechatAsset => ({
  state: 'unavailable',
  error
})

function dataUrlMimeType(data: string): string | undefined {
  const match = /^data:([^;,]+)[;,]/i.exec(data)
  return match?.[1]
}

export class WechatAssetResolver implements WechatAssetProviderResolver {
  constructor(private readonly runtime: WechatAssetRuntime) {}

  async resolve(hint: WechatAssetHint): Promise<ResolvedWechatAsset> {
    try {
      switch (hint.assetKind) {
        case 'image':
          return await this.resolveImage(hint)
        case 'video':
          return await this.resolveVideo(hint)
        case 'audio':
          return await this.resolveAudio(hint)
        case 'sticker':
          return await this.resolveSticker(hint)
        case 'file':
          return this.resolveFile(hint)
      }
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : '媒体解析失败')
    }
  }

  private async resolveImage(hint: WechatAssetHint): Promise<ResolvedWechatAsset> {
    const image = hint.image
    if (!image?.md5 && !image?.datName) return unavailable('图片缺少本地标识')
    const service = this.runtime.getImageDecryptService()
    if (!service) return unavailable('未配置图片解密服务')
    const filePath = await service.findImageFileAsync(image.md5, image.datName, {
      allowThumbnail: true,
      sessionId: image.sessionId,
      createTime: image.createTime
    })
    if (!filePath) return unavailable('本地未找到图片文件')
    const decoded = await service.decryptImageToBase64WithFallbackAsync(filePath, true)
    if (!decoded?.data) return unavailable('图片解密失败')
    return { state: 'available', uri: decoded.data, mimeType: dataUrlMimeType(decoded.data) }
  }

  private async resolveVideo(hint: WechatAssetHint): Promise<ResolvedWechatAsset> {
    const video = hint.video
    if (!video?.hashes.length) return unavailable('视频缺少本地标识')
    const service = this.runtime.getVideoAssetService()
    if (!service) return unavailable('视频服务未初始化')
    const result = await service.resolve(video.hashes, {
      createTime: video.createTime,
      byteLength: video.byteLength,
      duration: video.duration,
      width: video.width,
      height: video.height
    })
    if (!result.success || !result.url) return unavailable(result.error || '本地未找到视频文件')
    return {
      state: 'available',
      uri: result.url,
      thumbnailUri: result.poster,
      mimeType: 'video/mp4'
    }
  }

  private async resolveAudio(hint: WechatAssetHint): Promise<ResolvedWechatAsset> {
    const audio = hint.audio
    if (!audio?.sessionId || audio.localId == null || !audio.createTime) {
      return unavailable('语音缺少本地定位信息')
    }
    const service = this.runtime.getVoiceService()
    if (!service) return unavailable('语音服务未初始化')
    const result = await service.resolveVoice(
      audio.sessionId,
      audio.localId,
      audio.createTime,
      audio.serverId
    )
    if (!result.success || !result.data) return unavailable(result.error || '语音解析失败')
    return {
      state: 'available',
      uri: 'data:audio/wav;base64,' + result.data,
      mimeType: 'audio/wav'
    }
  }

  private async resolveSticker(hint: WechatAssetHint): Promise<ResolvedWechatAsset> {
    const sticker = hint.sticker
    if (!sticker?.url && !sticker?.md5 && !sticker?.encryptUrl) {
      return unavailable('表情包缺少本地或远程标识')
    }
    const service = this.runtime.getStickerService()
    if (!service) return unavailable('表情包服务未初始化')
    const result = await service.resolveSticker(sticker.url, sticker.md5, {
      encryptUrl: sticker.encryptUrl,
      aeskey: sticker.aeskey
    })
    if (!result.success || !result.data) return unavailable(result.error || '表情包解析失败')
    return { state: 'available', uri: result.data, mimeType: dataUrlMimeType(result.data) }
  }

  private resolveFile(hint: WechatAssetHint): ResolvedWechatAsset {
    const file = hint.file
    if (!file?.name) return unavailable('文件缺少文件名')
    const service = this.runtime.getFileAssetService()
    if (!service) return unavailable('文件服务未初始化')
    const result = service.resolve(file.name, file.createTime)
    if (!result.success || !result.filePath)
      return unavailable(result.error || '本地未找到文件附件')
    const uri = this.runtime.createLocalMediaUrl(result.filePath)
    if (!uri) return unavailable('本地文件 URI 创建失败')
    return { state: 'available', uri, name: result.fileName }
  }
}
