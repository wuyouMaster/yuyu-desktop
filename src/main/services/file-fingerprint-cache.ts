import { createHash } from 'crypto'
import { createReadStream, promises as fs, type BigIntStats } from 'fs'

function identity(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
}

/** Cache file digests, never process readiness; replacements and writes invalidate the entry. */
export class FileFingerprintCache {
  private readonly entries = new Map<string, { identity: string; digest: Promise<string> }>()

  async hash(filePath: string): Promise<string> {
    const before = identity(await fs.stat(filePath, { bigint: true }))
    const cached = this.entries.get(filePath)
    if (cached?.identity === before) return cached.digest
    const digest = this.readDigest(filePath, before)
    const entry = { identity: before, digest }
    this.entries.delete(filePath)
    this.entries.set(filePath, entry)
    if (this.entries.size > 16) this.entries.delete(this.entries.keys().next().value!)
    try {
      return await digest
    } catch (error) {
      if (this.entries.get(filePath) === entry) this.entries.delete(filePath)
      throw error
    }
  }

  private async readDigest(filePath: string, expectedIdentity: string): Promise<string> {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(filePath)) hash.update(chunk)
    if (identity(await fs.stat(filePath, { bigint: true })) !== expectedIdentity) {
      throw new Error('File changed during fingerprint verification')
    }
    return hash.digest('hex')
  }
}
