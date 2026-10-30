import { createHash, randomUUID } from 'node:crypto'
import { open, link, unlink } from 'node:fs/promises'
import { dirname, join, isAbsolute } from 'node:path'
import { z } from 'zod'
import { RuntimeRpcError, type RuntimeJson } from '../../shared/runtime-rpc'
import { wechatStorageDescriptionSchema } from '../../shared/wechat-storage-protocol'
import {
  mediaChunkBytes,
  mediaDecodeBytes,
  mediaTransferBytes,
  mediaChunkSchema,
  mediaHandleSchema,
  mediaRelativePathSchema,
  mediaFileOptionsSchema,
  mediaFindQuerySchema,
  mediaTransferSchema,
  type MediaFindQuery,
  type MediaTransfer
} from '../../shared/wechat-media-files-protocol'
import type { DatabaseRpcTransport } from './wechat-database-client'

const imageInfo = z
  .object({
    size: z.number().int().nonnegative().max(mediaTransferBytes),
    datVersion: z.union([z.literal(0), z.literal(2)]),
    thumbnail: z.boolean()
  })
  .strict()
const variantPaths = z
  .array(mediaRelativePathSchema)
  .max(10001)
  .refine((paths) => new Set(paths).size === paths.length)

function check<T>(schema: z.ZodType<T>, value: unknown, code = 'INVALID_RUNTIME_RESPONSE'): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new RuntimeRpcError(code)
  return result.data
}
function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new RuntimeRpcError('CANCELLED')
}

/** Account-owned handles, bounded frames and end-to-end digest verification.
 * No media format, filesystem layout or decryption implementation lives here.
 */
export class WechatMediaFilesClient {
  private session?: string
  private methods?: Set<string>
  private opening = false
  private closing = false
  constructor(private readonly rpc: DatabaseRpcTransport) {}
  open(root: string, options: z.input<typeof mediaFileOptionsSchema> = {}): void {
    if (this.session || this.opening || this.closing)
      throw new RuntimeRpcError('MEDIA_ALREADY_OPEN')
    if (!isAbsolute(root)) throw new RuntimeRpcError('INVALID_ARGUMENT')
    const parsed = check(mediaFileOptionsSchema, options, 'INVALID_ARGUMENT')
    this.opening = true
    try {
      this.methods = new Set(
        check(
          wechatStorageDescriptionSchema,
          this.rpc.call('runtime.describe', {}),
          'INCOMPATIBLE_RUNTIME'
        ).methods
      )
      for (const method of [
        'media.open',
        'media.close',
        'media.find',
        'media.fileOpen',
        'media.decodeFile',
        'media.read',
        'media.release'
      ])
        if (!this.methods.has(method)) throw new RuntimeRpcError('CAPABILITY_UNAVAILABLE')
      this.session = check(
        z.object({ sessionId: mediaHandleSchema }).strict(),
        this.rpc.call('media.open', { root, options: parsed })
      ).sessionId
    } finally {
      this.opening = false
    }
  }
  private params(input: Record<string, unknown> = {}): RuntimeJson {
    if (!this.session || this.closing) throw new RuntimeRpcError('MEDIA_SESSION_CLOSED')
    return JSON.parse(JSON.stringify({ ...input, sessionId: this.session })) as RuntimeJson
  }
  find(query: MediaFindQuery): string | null {
    const parsed = check(mediaFindQuerySchema, query, 'INVALID_ARGUMENT')
    return check(
      mediaRelativePathSchema.nullable(),
      this.rpc.call('media.find', this.params({ query: parsed }))
    )
  }
  async findAsync(query: MediaFindQuery, signal?: AbortSignal): Promise<string | null> {
    const parsed = check(mediaFindQuerySchema, query, 'INVALID_ARGUMENT')
    return check(
      mediaRelativePathSchema.nullable(),
      await this.rpc.callAsync('media.find', this.params({ query: parsed }), { signal })
    )
  }
  private require(method: string): void {
    if (!this.methods?.has(method)) throw new RuntimeRpcError('CAPABILITY_UNAVAILABLE')
  }
  assertImageCapabilities(): void {
    this.params()
    for (const method of [
      'media.inspectImage',
      'media.variants',
      'media.selectVariant',
      'media.thumbnail'
    ])
      this.require(method)
  }
  selectVariant(path: string, allowThumbnail: boolean, preferThumbnail: boolean): string | null {
    check(mediaRelativePathSchema, path, 'INVALID_ARGUMENT')
    this.require('media.selectVariant')
    return check(
      mediaRelativePathSchema.nullable(),
      this.rpc.call('media.selectVariant', this.params({ path, allowThumbnail, preferThumbnail }))
    )
  }
  async selectVariantAsync(
    path: string,
    allowThumbnail: boolean,
    preferThumbnail: boolean
  ): Promise<string | null> {
    check(mediaRelativePathSchema, path, 'INVALID_ARGUMENT')
    this.require('media.selectVariant')
    return check(
      mediaRelativePathSchema.nullable(),
      await this.rpc.callAsync(
        'media.selectVariant',
        this.params({ path, allowThumbnail, preferThumbnail })
      )
    )
  }
  inspectImage(path: string) {
    check(mediaRelativePathSchema, path, 'INVALID_ARGUMENT')
    this.require('media.inspectImage')
    return check(imageInfo, this.rpc.call('media.inspectImage', this.params({ path })))
  }
  async inspectImageAsync(path: string) {
    check(mediaRelativePathSchema, path, 'INVALID_ARGUMENT')
    this.require('media.inspectImage')
    return check(imageInfo, await this.rpc.callAsync('media.inspectImage', this.params({ path })))
  }
  variants(path: string, allowThumbnail: boolean): string[] {
    check(mediaRelativePathSchema, path, 'INVALID_ARGUMENT')
    this.require('media.variants')
    return check(
      variantPaths,
      this.rpc.call('media.variants', this.params({ path, allowThumbnail }))
    )
  }
  async variantsAsync(path: string, allowThumbnail: boolean): Promise<string[]> {
    check(mediaRelativePathSchema, path, 'INVALID_ARGUMENT')
    this.require('media.variants')
    return check(
      variantPaths,
      await this.rpc.callAsync('media.variants', this.params({ path, allowThumbnail }))
    )
  }
  thumbnail(name: string): boolean {
    check(z.string().max(4096), name, 'INVALID_ARGUMENT')
    this.require('media.thumbnail')
    return check(z.boolean(), this.rpc.call('media.thumbnail', this.params({ name })))
  }
  async fingerprint(path: string): Promise<{ size: number; sha256: string }> {
    check(mediaRelativePathSchema, path, 'INVALID_ARGUMENT')
    const owner = this.params() as { sessionId: string }
    const raw = await this.rpc.callAsync('media.fileOpen', { ...owner, path })
    try {
      const info = this.info(raw, path, false)
      return { size: info.size, sha256: info.sha256 }
    } finally {
      const handle = mediaHandleSchema.safeParse((raw as { transferId?: unknown })?.transferId)
      if (handle.success)
        check(
          z.literal(true),
          await this.rpc.callAsync('media.release', { ...owner, transferId: handle.data })
        )
    }
  }
  private chunk(value: RuntimeJson, info: MediaTransfer, offset: number): Buffer {
    const parsed = check(mediaChunkSchema, value)
    const bytes = Buffer.from(parsed.data, 'base64')
    if (
      parsed.offset !== offset ||
      bytes.length !== Math.min(mediaChunkBytes, info.size - offset) ||
      parsed.eof !== (offset + bytes.length === info.size) ||
      bytes.toString('base64') !== parsed.data
    ) {
      bytes.fill(0)
      throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
    }
    return bytes
  }
  private info(value: RuntimeJson, path: string, decode: boolean): MediaTransfer {
    const info = check(mediaTransferSchema, value)
    if (
      info.path !== path ||
      (decode && (info.diagnostic === 'FILE' || info.size > mediaDecodeBytes)) ||
      (!decode && info.diagnostic !== 'FILE')
    )
      throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
    return info
  }
  decode(path: string): { data: Buffer; info: MediaTransfer } {
    check(mediaRelativePathSchema, path, 'INVALID_ARGUMENT')
    const owner = this.params() as { sessionId: string }
    const raw = this.rpc.call('media.decodeFile', { ...owner, path })
    let data: Buffer | undefined
    let success = false
    try {
      const info = this.info(raw, path, true)
      data = Buffer.alloc(info.size)
      const hash = createHash('sha256')
      for (let offset = 0; offset < info.size; ) {
        const bytes = this.chunk(
          this.rpc.call(
            'media.read',
            this.params({ transferId: info.transferId, offset, length: mediaChunkBytes })
          ),
          info,
          offset
        )
        hash.update(bytes)
        bytes.copy(data, offset)
        offset += bytes.length
        bytes.fill(0)
      }
      if (hash.digest('hex') !== info.sha256) throw new RuntimeRpcError('MEDIA_DIGEST_MISMATCH')
      check(
        z.literal(true),
        this.rpc.call('media.release', this.params({ transferId: info.transferId }))
      )
      success = true
      return { data, info }
    } finally {
      if (!success) {
        data?.fill(0)
        const handle = mediaHandleSchema.safeParse((raw as { transferId?: unknown })?.transferId)
        if (handle.success) {
          try {
            this.rpc.call('media.release', { ...owner, transferId: handle.data })
          } catch {
            /* Session close also drains handles. */
          }
        }
      }
    }
  }
  private async consume(
    path: string,
    decode: boolean,
    write: (data: Buffer, info: MediaTransfer) => Promise<void>,
    signal?: AbortSignal
  ): Promise<MediaTransfer> {
    check(mediaRelativePathSchema, path, 'INVALID_ARGUMENT')
    aborted(signal)
    const owner = this.params() as { sessionId: string }
    const raw = await this.rpc.callAsync(
      decode ? 'media.decodeFile' : 'media.fileOpen',
      { ...owner, path },
      { signal }
    )
    let success = false
    try {
      const info = this.info(raw, path, decode)
      const hash = createHash('sha256')
      for (let offset = 0; offset < info.size; ) {
        aborted(signal)
        const bytes = this.chunk(
          await this.rpc.callAsync(
            'media.read',
            { ...owner, transferId: info.transferId, offset, length: mediaChunkBytes },
            { signal }
          ),
          info,
          offset
        )
        try {
          hash.update(bytes)
          await write(bytes, info)
          offset += bytes.length
        } finally {
          bytes.fill(0)
        }
      }
      aborted(signal)
      if (hash.digest('hex') !== info.sha256) throw new RuntimeRpcError('MEDIA_DIGEST_MISMATCH')
      check(
        z.literal(true),
        await this.rpc.callAsync('media.release', { ...owner, transferId: info.transferId })
      )
      success = true
      return info
    } finally {
      if (!success) {
        const handle = mediaHandleSchema.safeParse((raw as { transferId?: unknown })?.transferId)
        if (handle.success) {
          try {
            await this.rpc.callAsync('media.release', { ...owner, transferId: handle.data })
          } catch {
            /* Session close also drains handles. */
          }
        }
      }
    }
  }
  async decodeAsync(
    path: string,
    signal?: AbortSignal
  ): Promise<{ data: Buffer; info: MediaTransfer }> {
    let data: Buffer | undefined
    let offset = 0
    try {
      const info = await this.consume(
        path,
        true,
        async (chunk, info) => {
          data ??= Buffer.alloc(info.size)
          chunk.copy(data, offset)
          offset += chunk.length
        },
        signal
      )
      return { data: data ?? Buffer.alloc(0), info }
    } catch (error) {
      data?.fill(0)
      throw error
    }
  }
  /** Publish the destination only after complete verification; never overwrite it. */
  async copyToFileAsync(
    path: string,
    destination: string,
    signal?: AbortSignal
  ): Promise<MediaTransfer> {
    if (!isAbsolute(destination)) throw new RuntimeRpcError('INVALID_ARGUMENT')
    aborted(signal)
    const temporary = join(dirname(destination), `.runtime-transfer-${randomUUID()}.tmp`)
    const output = await open(temporary, 'wx', 0o600)
    try {
      const info = await this.consume(
        path,
        false,
        async (data) => {
          for (let offset = 0; offset < data.length; ) {
            aborted(signal)
            const { bytesWritten } = await output.write(data, offset, data.length - offset)
            if (bytesWritten <= 0) throw new RuntimeRpcError('MEDIA_WRITE_FAILED')
            offset += bytesWritten
          }
        },
        signal
      )
      await output.sync()
      await output.close()
      aborted(signal)
      await link(temporary, destination)
      return info
    } finally {
      await output.close()
      await unlink(temporary).catch(() => {})
    }
  }
  close(): void {
    if (!this.session) return
    if (this.closing) throw new RuntimeRpcError('MEDIA_SESSION_CLOSING')
    this.closing = true
    try {
      try {
        check(z.literal(true), this.rpc.call('media.close', { sessionId: this.session }))
      } catch (error) {
        if (!(error instanceof RuntimeRpcError) || error.code !== 'SESSION_NOT_FOUND') throw error
      }
      this.session = undefined
    } finally {
      this.closing = false
    }
  }
}
