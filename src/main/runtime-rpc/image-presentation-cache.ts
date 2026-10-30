import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { RuntimeRpcError } from '../../shared/runtime-rpc'
import { mediaDecodeBytes, mediaRelativePathSchema } from '../../shared/wechat-media-files-protocol'

const writes = new Map<string, Promise<void>>()
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const mime = z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp'])
const metadata = z
  .object({
    version: z.literal(1),
    source: mediaRelativePathSchema,
    sourceSha256: digest,
    payload: z.string().regex(/^[a-f0-9]{64}\.[a-f0-9-]{36}\.(?:png|jpeg|gif|bmp|webp)$/),
    sha256: digest,
    size: z.number().int().positive().max(mediaDecodeBytes),
    mime,
    thumbnail: z.boolean()
  })
  .strict()
type Metadata = z.infer<typeof metadata>
export interface CachedPresentation {
  data: string
  source: string
  sourceSha256: string
  thumbnail: boolean
  mime: string
  cacheFilePath: string
}

/** Generic application presentation cache. It knows no private media format or account layout. */
export class ImagePresentationCache {
  private directory?: Promise<string>
  private memory = new Map<string, CachedPresentation>()
  private memoryBytes = 0
  constructor(
    private readonly root: string,
    private readonly scope: string,
    private readonly fingerprint: (source: string) => Promise<string>,
    private readonly limits = {
      memoryBytes: 48 * 1024 * 1024,
      diskBytes: 512 * 1024 * 1024,
      diskFiles: 512
    }
  ) {}
  private dir() {
    return (this.directory ??= mkdir(this.root, { recursive: true, mode: 0o700 }).then(() =>
      realpath(this.root)
    ))
  }
  private id(key: string) {
    return hash(JSON.stringify([1, this.scope, key]))
  }
  private remember(id: string, value: CachedPresentation) {
    const previous = this.memory.get(id)
    this.memoryBytes -= previous?.data.length ? previous.data.length * 2 : 0
    this.memory.delete(id)
    const size = value.data.length * 2
    if (size <= this.limits.memoryBytes) {
      this.memory.set(id, { ...value })
      this.memoryBytes += size
    }
    while (this.memoryBytes > this.limits.memoryBytes || this.memory.size > this.limits.diskFiles) {
      const key = this.memory.keys().next().value as string
      this.memoryBytes -= (this.memory.get(key)?.data.length ?? 0) * 2
      this.memory.delete(key)
    }
  }
  private async read(path: string, max: number): Promise<Buffer> {
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size > max) throw new RuntimeRpcError('IMAGE_CACHE_INVALID')
      const bytes = Buffer.alloc(info.size)
      let offset = 0
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
        if (!bytesRead) {
          bytes.fill(0)
          throw new RuntimeRpcError('IMAGE_CACHE_INVALID')
        }
        offset += bytesRead
      }
      const after = await file.stat()
      if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) {
        bytes.fill(0)
        throw new RuntimeRpcError('IMAGE_CACHE_INVALID')
      }
      return bytes
    } finally {
      await file.close()
    }
  }
  async get(key: string, includeData = true): Promise<CachedPresentation | null> {
    const id = this.id(key)
    const cached = this.memory.get(id)
    let data: Buffer | undefined
    try {
      const directory = await this.dir()
      const raw = await this.read(join(directory, id + '.json'), 16384)
      let record: Metadata
      try {
        record = metadata.parse(JSON.parse(raw.toString('utf8')))
      } finally {
        raw.fill(0)
      }
      if (!record.payload.startsWith(id + '.')) return null
      if ((await this.fingerprint(record.source)) !== record.sourceSha256) return null
      const path = join(directory, record.payload)
      data = await this.read(path, mediaDecodeBytes)
      if (data.length !== record.size || hash(data) !== record.sha256) return null
      const value = {
        data: includeData
          ? cached?.cacheFilePath === path && cached.sourceSha256 === record.sourceSha256
            ? cached.data
            : `data:${record.mime};base64,${data.toString('base64')}`
          : '',
        source: record.source,
        sourceSha256: record.sourceSha256,
        thumbnail: record.thumbnail,
        mime: record.mime,
        cacheFilePath: path
      }
      if (includeData) this.remember(id, value)
      return value
    } catch (error) {
      if (
        error instanceof RuntimeRpcError &&
        !['IMAGE_CACHE_INVALID', 'MEDIA_FILE_NOT_FOUND'].includes(error.code)
      )
        throw error
      return null
    } finally {
      data?.fill(0)
    }
  }
  async put(
    key: string,
    input: { data: string; source: string; sourceSha256: string; thumbnail: boolean }
  ): Promise<void> {
    const directory = await this.dir()
    const operation = (writes.get(directory) ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.write(key, input))
    writes.set(directory, operation)
    try {
      await operation
    } finally {
      if (writes.get(directory) === operation) writes.delete(directory)
    }
  }
  private async write(
    key: string,
    input: { data: string; source: string; sourceSha256: string; thumbnail: boolean }
  ): Promise<void> {
    const match = /^data:(image\/(?:png|jpeg|gif|bmp|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
      input.data
    )
    if (!match || input.data.length > Math.ceil(mediaDecodeBytes / 3) * 4 + 100)
      throw new RuntimeRpcError('IMAGE_CACHE_INVALID')
    const data = Buffer.from(match[2], 'base64')
    let payload: string | undefined, temporary: string | undefined
    try {
      if (
        !data.length ||
        data.length > mediaDecodeBytes ||
        data.toString('base64') !== match[2] ||
        !digest.safeParse(input.sourceSha256).success ||
        !mediaRelativePathSchema.safeParse(input.source).success
      )
        throw new RuntimeRpcError('IMAGE_CACHE_INVALID')
      if ((await this.fingerprint(input.source)) !== input.sourceSha256)
        throw new RuntimeRpcError('MEDIA_SOURCE_CHANGED')
      const directory = await this.dir(),
        id = this.id(key),
        extension = match[1].slice(6)
      const filename = `${id}.${randomUUID()}.${extension}`
      payload = join(directory, filename)
      const file = await open(payload, 'wx', 0o600)
      try {
        await file.writeFile(data)
        await file.sync()
      } finally {
        await file.close()
      }
      const record = metadata.parse({
        version: 1,
        source: input.source,
        sourceSha256: input.sourceSha256,
        payload: filename,
        sha256: hash(data),
        size: data.length,
        mime: match[1],
        thumbnail: input.thumbnail
      })
      temporary = join(directory, `.pending-${randomUUID()}`)
      const meta = await open(temporary, 'wx', 0o600)
      try {
        await meta.writeFile(JSON.stringify(record))
        await meta.sync()
      } finally {
        await meta.close()
      }
      await rename(temporary, join(directory, id + '.json'))
      temporary = undefined
      this.remember(id, { ...input, mime: record.mime, cacheFilePath: payload })
      payload = undefined
      await this.prune(directory)
    } finally {
      data.fill(0)
      if (temporary) await rm(temporary, { force: true })
      if (payload) await rm(payload, { force: true })
    }
  }
  private async prune(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true })
    const files = await Promise.all(
      entries
        .filter(
          (e) =>
            e.isFile() && /^[a-f0-9]{64}\.[a-f0-9-]{36}\.(?:png|jpeg|gif|bmp|webp)$/.test(e.name)
        )
        .map(async (e) => ({ name: e.name, ...(await stat(join(directory, e.name))) }))
    )
    files.sort((a, b) => a.mtimeMs - b.mtimeMs)
    let size = files.reduce((sum, f) => sum + f.size, 0),
      count = files.length
    for (const file of files) {
      if (size <= this.limits.diskBytes && count <= this.limits.diskFiles) break
      await rm(join(directory, file.name), { force: true })
      size -= file.size
      count--
    }
    // Metadata is bounded too. Remove references whose exact payload no longer exists.
    const names = new Set((await readdir(directory)).filter((name) => !name.endsWith('.json')))
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) continue
      const path = join(directory, entry.name)
      try {
        const bytes = await this.read(path, 16384)
        let value: Metadata
        try {
          value = metadata.parse(JSON.parse(bytes.toString('utf8')))
        } finally {
          bytes.fill(0)
        }
        if (!names.has(value.payload)) await rm(path, { force: true })
      } catch {
        await rm(path, { force: true })
      }
    }
  }
  clearMemory() {
    this.memory.clear()
    this.memoryBytes = 0
  }
}
