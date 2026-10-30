import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { DatabasePort } from '../../shared/database-port'
import type {
  ImageMediaPort,
  ImageFindOptions,
  ImageDecodeDiagnostic,
  DecodedImage,
  ImageDecodeDiagnosticCode
} from '../../shared/image-media-port'
import { RuntimeRpcError } from '../../shared/runtime-rpc'
import {
  mediaRelativePathSchema,
  type MediaTransfer
} from '../../shared/wechat-media-files-protocol'
import { WechatMediaFilesClient } from './wechat-media-files-client'
import { ImagePresentationCache } from './image-presentation-cache'

type Database = Pick<
  DatabasePort,
  'resolveImageHardlink' | 'resolveImageHardlinkAsync' | 'getAccountRoot'
>
const decodeErrors = new Set([
  'UNSUPPORTED_DAT_VERSION',
  'MISSING_AES_KEY',
  'AES_DECRYPT_FAILED',
  'INVALID_DAT_FILE',
  'UNKNOWN_IMAGE_FORMAT',
  'MEDIA_FILE_NOT_FOUND',
  'IMAGE_DECODER_FAILED'
])
const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
/** Application adapter only: paths are account-scoped, format decisions remain in the native host. */
export class WechatImageMediaPort implements ImageMediaPort {
  private diagnostic: ImageDecodeDiagnostic = { code: 'NOT_RUN', detail: '尚未执行图片解析' }
  private readonly root: string
  private readonly canonicalRoot: string
  private readonly cache: ImagePresentationCache
  private receipts = new Map<string, { sourceSha256: string; dataHash: string; mime: string }>()
  constructor(
    private readonly files: WechatMediaFilesClient,
    root: string,
    cacheDirectory: string,
    private readonly database?: Database
  ) {
    if (!isAbsolute(root) || !isAbsolute(cacheDirectory))
      throw new RuntimeRpcError('INVALID_ARGUMENT')
    files.assertImageCapabilities()
    this.root = resolve(root)
    this.canonicalRoot = realpathSync(root)
    if (database && !this.matchesRoot(database.getAccountRoot()))
      throw new RuntimeRpcError('ACCOUNT_MISMATCH')
    this.cache = new ImagePresentationCache(
      cacheDirectory,
      this.canonicalRoot,
      async (path) => (await files.fingerprint(path)).sha256
    )
  }
  private matchesRoot(path: string): boolean {
    try {
      return realpathSync(path) === this.canonicalRoot
    } catch {
      return false
    }
  }
  private local(path: string): string {
    const candidates = isAbsolute(path)
      ? [this.root, this.canonicalRoot].map((root) =>
          relative(root, resolve(path)).split(sep).join('/')
        )
      : [path]
    for (const value of candidates) {
      const parsed = mediaRelativePathSchema.safeParse(value)
      if (parsed.success) return parsed.data
    }
    throw new RuntimeRpcError('MEDIA_PATH_INVALID')
  }
  private absolute(path: string): string {
    return resolve(this.root, this.local(path))
  }
  private query(md5?: string, datName?: string, options: ImageFindOptions = {}) {
    if (options.accountDir && !this.matchesRoot(options.accountDir))
      throw new RuntimeRpcError('ACCOUNT_MISMATCH')
    return {
      md5,
      datName,
      sessionId: options.sessionId,
      sessionMd5: options.sessionMd5,
      created: options.createTime,
      allowThumbnail: options.allowThumbnail !== false,
      preferThumbnail: options.preferThumbnail ?? false
    }
  }
  private hardlinkPath(
    value: ReturnType<Database['resolveImageHardlink']>,
    allow: boolean,
    prefer: boolean
  ): string | null {
    const full = value?.full_path
    if (typeof full !== 'string' || !full) return null
    const selected = this.files.selectVariant(this.local(full), allow, prefer)
    return selected ? this.absolute(selected) : null
  }

  findImageFile(md5?: string, datName?: string, options: ImageFindOptions = {}): string | null {
    const query = this.query(md5, datName, options)
    if (!md5 && !datName) return null
    const path = this.files.find(query)
    if (path) return this.absolute(path)
    if (this.database)
      for (const key of new Set([md5, datName].filter((v): v is string => !!v))) {
        const selected = this.hardlinkPath(
          this.database.resolveImageHardlink(key),
          query.allowThumbnail,
          query.preferThumbnail
        )
        if (selected) return selected
      }
    return null
  }
  async findImageFileAsync(
    md5?: string,
    datName?: string,
    options: ImageFindOptions = {}
  ): Promise<string | null> {
    const query = this.query(md5, datName, options)
    if (!md5 && !datName) return null
    const path = await this.files.findAsync(query)
    if (path) return this.absolute(path)
    if (this.database)
      for (const key of new Set([md5, datName].filter((v): v is string => !!v))) {
        const value = await this.database.resolveImageHardlinkAsync(key)
        if (typeof value?.full_path !== 'string' || !value.full_path) continue
        const selected = await this.files.selectVariantAsync(
          this.local(value.full_path),
          query.allowThumbnail,
          query.preferThumbnail
        )
        if (selected) return this.absolute(selected)
      }

    return null
  }
  getLastDecodeDiagnostic(): ImageDecodeDiagnostic {
    return { ...this.diagnostic }
  }
  private failure(error: unknown): null {
    if (!(error instanceof RuntimeRpcError) || !decodeErrors.has(error.code)) throw error
    this.diagnostic = {
      ...this.diagnostic,
      code: (error.code === 'IMAGE_DECODER_FAILED'
        ? 'UNKNOWN_IMAGE_FORMAT'
        : error.code === 'MEDIA_FILE_NOT_FOUND'
          ? 'FILE_NOT_FOUND'
          : error.code) as ImageDecodeDiagnosticCode,
      detail: error.code
    }
    return null
  }
  private decoded(path: string, value: { data: Buffer; info: MediaTransfer }): Buffer | null {
    if (value.info.requiresDecoder) {
      value.data.fill(0)
      this.diagnostic = {
        ...this.diagnostic,
        code: 'WXGF_REQUIRES_DECODER',
        detail: '该图片需要运行时 HEVC 解码器',
        wxgf: true
      }
      return null
    }
    if (!value.info.sourceSha256) {
      value.data.fill(0)
      throw new RuntimeRpcError('INCOMPATIBLE_RUNTIME')
    }
    this.diagnostic = {
      ...this.diagnostic,
      code: value.info.diagnostic as ImageDecodeDiagnosticCode,
      detail: '图片解析成功',
      imageFormat: value.info.mime.slice(6).toUpperCase()
    }
    this.receipts.delete(path)
    this.receipts.set(path, {
      sourceSha256: value.info.sourceSha256,
      dataHash: digest(value.data),
      mime: value.info.mime
    })
    while (this.receipts.size > 512)
      this.receipts.delete(this.receipts.keys().next().value as string)
    return value.data
  }
  decryptImage(path: string): Buffer | null {
    const local = this.local(path)
    this.diagnostic = { code: 'NOT_RUN', detail: '正在解析图片' }
    try {
      const info = this.files.inspectImage(local)
      this.diagnostic = { ...this.diagnostic, datVersion: info.datVersion, fileSize: info.size }
      return this.decoded(local, this.files.decode(local))
    } catch (error) {
      return this.failure(error)
    }
  }
  decryptImageToBase64(path: string): string | null {
    const data = this.decryptImage(path)
    if (!data) return null
    try {
      return `data:image/${this.diagnostic.imageFormat!.toLowerCase()};base64,${data.toString('base64')}`
    } finally {
      data.fill(0)
    }
  }
  decryptImageToBase64WithFallback(
    path: string,
    allowThumbnail = true
  ): { data: string; filePath: string } | null {
    for (const candidate of this.files.variants(this.local(path), allowThumbnail)) {
      const data = this.decryptImageToBase64(candidate)
      if (data) return { data, filePath: this.absolute(candidate) }
    }
    return null
  }
  async decryptImageToBase64WithFallbackAsync(
    path: string,
    allowThumbnail = true
  ): Promise<{ data: string; filePath: string } | null> {
    for (const candidate of await this.files.variantsAsync(this.local(path), allowThumbnail)) {
      this.diagnostic = { code: 'NOT_RUN', detail: '正在解析图片' }
      let data: Buffer | null = null
      try {
        const info = await this.files.inspectImageAsync(candidate)
        this.diagnostic = { ...this.diagnostic, datVersion: info.datVersion, fileSize: info.size }
        const value = await this.files.decodeAsync(candidate)
        data = this.decoded(candidate, value)
        if (data)
          return {
            data: `data:${value.info.mime};base64,${data.toString('base64')}`,
            filePath: this.absolute(candidate)
          }
      } catch (error) {
        this.failure(error)
      } finally {
        data?.fill(0)
      }
    }
    return null
  }
  isThumbnailFile(path: string): boolean {
    return this.files.thumbnail(this.local(path))
  }
  async cacheDecodedImage(key: string, image: DecodedImage): Promise<void> {
    const local = this.local(image.filePath)
    let receipt = this.receipts.get(local)
    if (!receipt) {
      const decoded = this.decoded(local, await this.files.decodeAsync(local))
      if (!decoded) throw new RuntimeRpcError('IMAGE_CACHE_INVALID')
      decoded.fill(0)
      receipt = this.receipts.get(local)
    }
    if (
      image.data.length > Math.ceil((48 * 1024 * 1024) / 3) * 4 + 100 ||
      !image.data.startsWith(`data:${receipt?.mime};base64,`)
    )
      throw new RuntimeRpcError('IMAGE_CACHE_INVALID')
    const encoded = image.data.slice(image.data.indexOf(',') + 1)
    const bytes = Buffer.from(encoded, 'base64')
    try {
      if (!receipt || digest(bytes) !== receipt.dataHash)
        throw new RuntimeRpcError('IMAGE_CACHE_INVALID')
    } finally {
      bytes.fill(0)
    }
    if (this.isThumbnailFile(local) !== image.isThumbnail)
      throw new RuntimeRpcError('IMAGE_CACHE_INVALID')
    await this.cache.put(key, {
      data: image.data,
      source: local,
      sourceSha256: receipt.sourceSha256,
      thumbnail: image.isThumbnail
    })
  }
  async getCachedDecodedImage(
    key: string,
    options: { includeData?: boolean } = {}
  ): Promise<DecodedImage | null> {
    const value = await this.cache.get(key, options.includeData !== false)
    return value
      ? {
          data: value.data,
          filePath: this.absolute(value.source),
          isThumbnail: value.thumbnail,
          mimeType: value.mime,
          cacheFilePath: value.cacheFilePath
        }
      : null
  }
  dispose() {
    this.receipts.clear()
    this.cache.clearMemory()
    this.files.close()
  }
}
