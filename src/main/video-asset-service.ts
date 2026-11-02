import { locateApplicationAsset } from './runtime-rpc/application-assets'
import fs from 'fs-extra'
import path from 'path'
import crypto from 'crypto'
import type { DatabasePort } from '../shared/database-port'

type DatabaseReader = Pick<DatabasePort, 'resolveVideoHardlink' | 'getAccountRoot'>

export type VideoResolveOptions = {
  createTime?: number
  byteLength?: number
  duration?: number
  width?: number
  height?: number
}

export class VideoAssetService {
  private readonly urlTokens = new Map<string, string>()
  private readonly fileTokens = new Map<string, string>()
  constructor(private readonly client: DatabaseReader) {}

  async resolve(
    hashes: string[],
    options: VideoResolveOptions = {}
  ): Promise<{ success: boolean; url?: string; poster?: string; error?: string }> {
    const candidates = Array.from(
      new Set(
        hashes
          .map((value) =>
            String(value || '')
              .trim()
              .toLowerCase()
          )
          .filter((value) => /^[a-f0-9]{32}$/.test(value))
      )
    )
    const hasMetadata =
      Number(options.byteLength) > 0 ||
      Number(options.duration) > 0 ||
      (Number(options.width) > 0 && Number(options.height) > 0)
    if (candidates.length === 0 && !hasMetadata) {
      return { success: false, error: '视频标识为空' }
    }

    const hardlinkDb = path.join(
      this.client.getAccountRoot(),
      'db_storage',
      'hardlink',
      'hardlink.db'
    )
    const lookupKeys = [...candidates]
    for (const hash of candidates) {
      const resolved = this.client.resolveVideoHardlink(hash, hardlinkDb)?.resolved_md5
      if (resolved) lookupKeys.unshift(String(resolved).trim().toLowerCase())
    }
    const asset = locateApplicationAsset(this.client.getAccountRoot(), {
      kind: 'video',
      hashes: lookupKeys,
      created: options.createTime,
      byteLength: options.byteLength,
      duration: options.duration,
      width: options.width,
      height: options.height
    })
    if (asset)
      return {
        success: true,
        url: this.createLocalMediaUrl(asset.path),
        poster: asset.poster ? this.createLocalMediaUrl(asset.poster) : undefined
      }
    return { success: false, error: '本地未找到该视频文件' }
  }

  pathForToken(token: string): string | undefined {
    const filePath = this.urlTokens.get(token)
    if (!filePath || !fs.existsSync(filePath)) return undefined
    return filePath
  }

  pathForUrl(url: string): string | undefined {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'yuyu-media:' || parsed.hostname !== 'local') return undefined
      return this.pathForToken(parsed.pathname.replace(/^\/+/, ''))
    } catch {
      return undefined
    }
  }

  createLocalMediaUrl(filePath: string): string {
    const normalizedPath = path.resolve(filePath)
    const existingToken = this.fileTokens.get(normalizedPath)
    if (existingToken && this.urlTokens.get(existingToken) === normalizedPath) {
      return `yuyu-media://local/${existingToken}`
    }

    const token = crypto.randomBytes(18).toString('hex')
    this.urlTokens.set(token, normalizedPath)
    this.fileTokens.set(normalizedPath, token)
    if (this.urlTokens.size > 2048) {
      const oldestToken = this.urlTokens.keys().next().value
      if (oldestToken) {
        const oldestPath = this.urlTokens.get(oldestToken)
        this.urlTokens.delete(oldestToken)
        if (oldestPath) this.fileTokens.delete(oldestPath)
      }
    }
    return `yuyu-media://local/${token}`
  }
}
