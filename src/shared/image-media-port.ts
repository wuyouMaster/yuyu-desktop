import type { CapabilityProvider } from './capability-provider'

/** Main-process image capability protocol. Implementations own decoding and caches.
 * Version 1 preserves synchronous legacy consumers and explicit async worker calls.
 * A decoder miss returns null; missing capabilities are rejected at registration/selection.
 */
export type DecodedImage = {
  data: string
  filePath: string
  isThumbnail: boolean
  cacheFilePath?: string
  mimeType?: string
}

export type ImageDecodeDiagnosticCode =
  | 'NOT_RUN'
  | 'FILE_NOT_FOUND'
  | 'DIRECT_IMAGE'
  | 'UNSUPPORTED_DAT_VERSION'
  | 'MISSING_AES_KEY'
  | 'AES_DECRYPT_FAILED'
  | 'INVALID_DAT_FILE'
  | 'WXGF_REQUIRES_DECODER'
  | 'UNKNOWN_IMAGE_FORMAT'
  | 'SUCCESS'

export interface ImageDecodeDiagnostic {
  code: ImageDecodeDiagnosticCode
  detail: string
  datVersion?: number
  fileSize?: number
  imageFormat?: string
  wxgf?: boolean
}

export type ImageFindOptions = {
  allowThumbnail?: boolean
  accountDir?: string
  preferThumbnail?: boolean
  sessionId?: string
  sessionMd5?: string
  createTime?: number
}

export interface ImageMediaPort {
  getLastDecodeDiagnostic(): ImageDecodeDiagnostic
  findImageFile(md5?: string, imageDatName?: string, options?: ImageFindOptions): string | null
  findImageFileAsync(
    md5?: string,
    imageDatName?: string,
    options?: ImageFindOptions
  ): Promise<string | null>
  getCachedDecodedImage(
    key: string,
    options?: { includeData?: boolean }
  ): Promise<DecodedImage | null>
  cacheDecodedImage(key: string, image: DecodedImage): Promise<void>
  decryptImage(datPath: string): Buffer | null
  decryptImageToBase64(datPath: string): string | null
  decryptImageToBase64WithFallback(
    datPath: string,
    allowThumbnail?: boolean
  ): { data: string; filePath: string } | null
  decryptImageToBase64WithFallbackAsync(
    datPath: string,
    allowThumbnail?: boolean
  ): Promise<{ data: string; filePath: string } | null>
  isThumbnailFile(filePath: string): boolean
}

export type ImageMediaProviderRegistration = CapabilityProvider<ImageMediaPort>
