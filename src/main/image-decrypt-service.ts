import type { DatabasePort } from '../shared/database-port'
import type { ImageMediaPort } from '../shared/image-media-port'
import { imageMediaRuntimeProviders } from './services/image-media-runtime-registry'
import type { ImageMediaRuntimePort } from '../shared/image-media-runtime-port'
import {
  ImageMediaProviderRegistry,
  type ImageMediaProviderRegistration
} from './services/image-media-provider-registry'

export type {
  DecodedImage,
  ImageDecodeDiagnostic,
  ImageDecodeDiagnosticCode
} from '../shared/image-media-port'
export const resolveFfmpegExecutable = (): string =>
  imageMediaRuntimeProviders.resolve(['resolveFfmpegExecutable']).port.resolveFfmpegExecutable()
export const inspectImageDecoderExecutable: ImageMediaRuntimePort['inspectImageDecoderExecutable'] =
  (...args) =>
    imageMediaRuntimeProviders
      .resolve(['inspectImageDecoderExecutable'])
      .port.inspectImageDecoderExecutable(...args)
export const inspectImageDecoderStatus: ImageMediaRuntimePort['inspectImageDecoderStatus'] = (
  ...args
) =>
  imageMediaRuntimeProviders
    .resolve(['inspectImageDecoderStatus'])
    .port.inspectImageDecoderStatus(...args)

type DatabaseReader = Pick<
  DatabasePort,
  'resolveImageHardlink' | 'resolveImageHardlinkAsync' | 'getAccountRoot'
>

/** Business facade. The selected implementation owns AES/XOR/WXGF and ffmpeg. */
export class ImageDecryptService implements ImageMediaPort {
  private readonly port: ImageMediaPort
  private readonly release?: () => Promise<void> | void
  private closing?: Promise<void>

  constructor(
    xorKey: string,
    aesKey: string,
    database?: DatabaseReader | null,
    configuredAccountDir?: string,
    registration?: ImageMediaProviderRegistration
  ) {
    const selected =
      registration ??
      imageMediaRuntimeProviders.resolve(['create']).port.create({
        xorKey,
        aesKey,
        database,
        accountRoot: configuredAccountDir
      })
    if (!registration && selected.source !== 'wechat') {
      throw new Error('Image factory returned a different source')
    }
    const source = selected.source
    const accountId = database?.getAccountRoot() || configuredAccountDir || selected.accountId
    const registry = new ImageMediaProviderRegistry(source, accountId)
    registry.register(selected)
    this.port = registry.resolveComplete().port
    this.release = selected.dispose?.bind(selected)
  }

  dispose(): Promise<void> {
    return this.closing ??= Promise.resolve().then(() => this.release?.())
  }

  getLastDecodeDiagnostic(
    ...args: Parameters<ImageMediaPort['getLastDecodeDiagnostic']>
  ): ReturnType<ImageMediaPort['getLastDecodeDiagnostic']> {
    return this.port.getLastDecodeDiagnostic(...args)
  }

  findImageFile(
    ...args: Parameters<ImageMediaPort['findImageFile']>
  ): ReturnType<ImageMediaPort['findImageFile']> {
    return this.port.findImageFile(...args)
  }

  findImageFileAsync(
    ...args: Parameters<ImageMediaPort['findImageFileAsync']>
  ): ReturnType<ImageMediaPort['findImageFileAsync']> {
    return this.port.findImageFileAsync(...args)
  }

  getCachedDecodedImage(
    ...args: Parameters<ImageMediaPort['getCachedDecodedImage']>
  ): ReturnType<ImageMediaPort['getCachedDecodedImage']> {
    return this.port.getCachedDecodedImage(...args)
  }

  cacheDecodedImage(
    ...args: Parameters<ImageMediaPort['cacheDecodedImage']>
  ): ReturnType<ImageMediaPort['cacheDecodedImage']> {
    return this.port.cacheDecodedImage(...args)
  }

  decryptImage(
    ...args: Parameters<ImageMediaPort['decryptImage']>
  ): ReturnType<ImageMediaPort['decryptImage']> {
    return this.port.decryptImage(...args)
  }

  decryptImageToBase64(
    ...args: Parameters<ImageMediaPort['decryptImageToBase64']>
  ): ReturnType<ImageMediaPort['decryptImageToBase64']> {
    return this.port.decryptImageToBase64(...args)
  }

  decryptImageToBase64WithFallback(
    ...args: Parameters<ImageMediaPort['decryptImageToBase64WithFallback']>
  ): ReturnType<ImageMediaPort['decryptImageToBase64WithFallback']> {
    return this.port.decryptImageToBase64WithFallback(...args)
  }

  decryptImageToBase64WithFallbackAsync(
    ...args: Parameters<ImageMediaPort['decryptImageToBase64WithFallbackAsync']>
  ): ReturnType<ImageMediaPort['decryptImageToBase64WithFallbackAsync']> {
    return this.port.decryptImageToBase64WithFallbackAsync(...args)
  }

  isThumbnailFile(
    ...args: Parameters<ImageMediaPort['isThumbnailFile']>
  ): ReturnType<ImageMediaPort['isThumbnailFile']> {
    return this.port.isThumbnailFile(...args)
  }
}
