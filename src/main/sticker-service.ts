import crypto from 'crypto'
import fs from 'fs-extra'
import http from 'http'
import https from 'https'
import os from 'os'
import path from 'path'
import type { DatabasePort } from '../shared/database-port'
import { classifyStickerHttpFailure, StickerFailureCode } from '../shared/sticker'
import { decryptMessagePayload } from './runtime-rpc/application-media-decrypt'

type DatabaseReader = Pick<DatabasePort, 'resolveEmoticonCdnUrl' | 'getAccountRoot'>

type StickerResult = {
  success: boolean
  data?: string
  error?: string
  failureCode?: StickerFailureCode
  httpStatus?: number
}

const downloadCache = new Map<string, Promise<StickerResult>>()

export class StickerService {
  private readonly cacheDir: string

  constructor(private readonly database?: DatabaseReader | null) {
    this.cacheDir = path.join(os.homedir(), 'Documents', 'YUYU', 'Emojis')
  }

  async resolveSticker(
    cdnUrl?: string,
    md5?: string,
    options?: { encryptUrl?: string; aeskey?: string }
  ): Promise<StickerResult> {
    const normalizedMd5 = this.normalizeMd5(md5)
    const encryptUrl = String(options?.encryptUrl || '').trim()
    const aeskey = String(options?.aeskey || '').trim()
    let url = String(cdnUrl || '').trim()

    const cacheKey =
      normalizedMd5 || (url ? crypto.createHash('md5').update(url).digest('hex') : '')
    if (cacheKey) {
      const cached = await this.readCached(cacheKey)
      if (cached) return { success: true, data: cached }
    }

    if (normalizedMd5 && this.database) {
      const wechatCached = await this.readWechatEmoticonCache(normalizedMd5)
      if (wechatCached) return { success: true, data: wechatCached }
    }

    if (!url && normalizedMd5 && this.database) {
      url = this.database.resolveEmoticonCdnUrl(normalizedMd5) || ''
      if (!url) {
        console.warn(`[StickerService] emoticon CDN URL not found for md5=${normalizedMd5}`)
      }
    }

    const resolvedCacheKey =
      cacheKey || crypto.createHash('md5').update(url || encryptUrl || aeskey).digest('hex')

    const pending = downloadCache.get(resolvedCacheKey)
    if (pending) return pending

    const task = this.resolveRemote(url, encryptUrl, aeskey, resolvedCacheKey)
    downloadCache.set(resolvedCacheKey, task)
    try {
      return await task
    } finally {
      downloadCache.delete(resolvedCacheKey)
    }
  }

  /**
   * Prefer plaintext `cdnurl` (20401). If missing/fails/non-image, fall back to
   * `encrypturl` (20402) + message aeskey (AES-128-CBC, IV = aeskey).
   */
  private async resolveRemote(
    url: string,
    encryptUrl: string,
    aeskey: string,
    cacheKey: string
  ): Promise<StickerResult> {
    if (url) {
      const primary = await this.downloadToDataUrl(url, cacheKey)
      if (primary.success) return primary
      if (!encryptUrl || !aeskey) return primary
    } else if (!encryptUrl || !aeskey) {
      return { success: false, error: '未找到表情包 CDN URL' }
    }

    const encrypted = await this.downloadBuffer(encryptUrl)
    if (encrypted.kind !== 'ok') {
      return {
        success: false,
        error: encrypted.message,
        failureCode: encrypted.failureCode,
        httpStatus: encrypted.httpStatus
      }
    }
    let plain: Buffer
    try {
      plain = await decryptMessagePayload(aeskey, encrypted.data)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '表情包解密失败'
      }
    }
    const ext = this.detectExtension(plain)
    if (!ext) {
      return { success: false, error: '表情包解密结果不是支持的图片格式' }
    }
    try {
      await fs.ensureDir(this.cacheDir)
      await fs.writeFile(path.join(this.cacheDir, `${cacheKey}${ext}`), plain)
    } catch {
      // Cache is best effort.
    }
    return { success: true, data: this.toDataUrl(plain, ext) }
  }

  private async readCached(cacheKey: string): Promise<string | null> {
    const extensions = ['.gif', '.png', '.webp', '.jpg', '.jpeg']
    const cacheDirs = [this.cacheDir]
    for (const cacheDir of cacheDirs) {
      for (const ext of extensions) {
        const filePath = path.join(cacheDir, `${cacheKey}${ext}`)
        if (!fs.existsSync(filePath)) continue
        const buffer = await fs.readFile(filePath)
        const detectedExtension = this.detectExtension(buffer)
        if (!detectedExtension) {
          console.warn(`[StickerService] ignored invalid local cache key=${cacheKey}`)
          continue
        }
        return this.toDataUrl(buffer, detectedExtension)
      }
    }
    return null
  }

  private async readWechatEmoticonCache(md5: string): Promise<string | null> {
    const accountRoot = this.database?.getAccountRoot()
    if (!accountRoot) return null

    const cacheRoot = path.join(accountRoot, 'cache')
    if (!fs.existsSync(cacheRoot)) return null

    const prefix = md5.slice(0, 2)
    let months: string[] = []
    try {
      months = fs
        .readdirSync(cacheRoot)
        .filter((name) => /^\d{4}-\d{2}$/.test(name))
        .sort()
        .reverse()
    } catch {
      return null
    }

    for (const month of months) {
      const filePath = path.join(cacheRoot, month, 'Emoticon', prefix, md5)
      if (!fs.existsSync(filePath)) continue
      const buffer = await fs.readFile(filePath)
      const ext = this.detectExtension(buffer)
      if (!ext) {
        console.warn(`[StickerService] ignored invalid WeChat cache md5=${md5} month=${month}`)
        continue
      }
      return this.toDataUrl(buffer, ext)
    }

    return null
  }

  private downloadBuffer(
    url: string,
    redirectCount = 0
  ): Promise<
    | { kind: 'ok'; data: Buffer }
    | { kind: 'fail'; message: string; failureCode?: StickerFailureCode; httpStatus?: number }
  > {
    return new Promise((resolve) => {
      if (redirectCount > 5) {
        resolve({ kind: 'fail', message: '表情包下载重定向过多' })
        return
      }
      const client = url.startsWith('https:') ? https : http
      const request = client.get(
        url,
        {
          headers: {
            'User-Agent': 'MicroMessenger Client',
            Referer: 'https://weixin.qq.com/'
          }
        },
        (response) => {
          const redirectUrl = response.headers.location
          if (redirectUrl && [301, 302, 303, 307, 308].includes(Number(response.statusCode || 0))) {
            const nextUrl = new URL(redirectUrl, url).toString()
            response.resume()
            this.downloadBuffer(nextUrl, redirectCount + 1).then(resolve)
            return
          }
          if (response.statusCode !== 200) {
            const statusCode = Number(response.statusCode || 0)
            const failure = classifyStickerHttpFailure(statusCode, url)
            response.resume()
            console.warn(
              `[StickerService] download failed code=${failure.code} status=${statusCode} host=${this.getUrlHost(url)}`
            )
            resolve({
              kind: 'fail',
              message: failure.message,
              failureCode: failure.code,
              httpStatus: statusCode
            })
            return
          }
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => chunks.push(chunk))
          response.on('end', () => {
            const data = Buffer.concat(chunks)
            if (data.length === 0) {
              resolve({ kind: 'fail', message: '表情包内容为空' })
              return
            }
            resolve({ kind: 'ok', data })
          })
        }
      )
      request.on('error', (error) => resolve({ kind: 'fail', message: error.message }))
      request.setTimeout(15000, () => {
        request.destroy()
        resolve({ kind: 'fail', message: '表情包下载超时' })
      })
    })
  }

  private async downloadToDataUrl(url: string, cacheKey: string): Promise<StickerResult> {
    const fetched = await this.downloadBuffer(url)
    if (fetched.kind !== 'ok') {
      return {
        success: false,
        error: fetched.message,
        failureCode: fetched.failureCode,
        httpStatus: fetched.httpStatus
      }
    }
    const buffer = fetched.data
    const ext = this.detectExtension(buffer)
    if (!ext) {
      console.warn(
        `[StickerService] download returned invalid image md5=${cacheKey} host=${this.getUrlHost(url)}`
      )
      return { success: false, error: '表情包响应不是支持的图片格式' }
    }
    try {
      await fs.ensureDir(this.cacheDir)
      await fs.writeFile(path.join(this.cacheDir, `${cacheKey}${ext}`), buffer)
    } catch {
      // Cache is best effort; the data URL can still be displayed.
    }
    return { success: true, data: this.toDataUrl(buffer, ext) }
  }

  private detectExtension(buffer: Buffer): string | null {
    if (buffer.length >= 6 && buffer.subarray(0, 3).toString('ascii') === 'GIF') return '.gif'
    if (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    )
      return '.png'
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
      return '.jpg'
    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return '.webp'
    }
    return null
  }

  private getUrlHost(url: string): string {
    try {
      return new URL(url).hostname || 'unknown'
    } catch {
      return 'unknown'
    }
  }

  private toDataUrl(buffer: Buffer, ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.gif': 'image/gif',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg'
    }
    return `data:${mimeTypes[ext] || 'image/gif'};base64,${buffer.toString('base64')}`
  }

  private normalizeMd5(value?: string): string | undefined {
    const md5 = String(value || '')
      .trim()
      .toLowerCase()
    return /^[a-f0-9]{32}$/.test(md5) ? md5 : undefined
  }
}
