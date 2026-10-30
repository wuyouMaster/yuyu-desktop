import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ImagePresentationCache } from '../../src/main/runtime-rpc/image-presentation-cache'
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const data =
  'data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 1, 2, 3, 4]).toString('base64')
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'synthetic-presentation-'))
  roots.push(root)
  let current = sha('source-one')
  const fingerprint = async () => current
  const entry = { data, source: 'synthetic/photo.dat', sourceSha256: current, thumbnail: false }
  return {
    root,
    entry,
    fingerprint,
    setSource: (value: string) => {
      current = sha(value)
    },
    cache: new ImagePresentationCache(root, 'synthetic-account', fingerprint)
  }
}
describe('application image presentation cache', () => {
  it('persists across instances and validates payloads even on memory hits', async () => {
    const f = await fixture()
    await f.cache.put('key', f.entry)
    const first = await f.cache.get('key')
    expect(first?.data).toBe(data)
    const restored = new ImagePresentationCache(f.root, 'synthetic-account', f.fingerprint)
    expect((await restored.get('key'))?.data).toBe(data)
    expect(await restored.get('key', false)).toMatchObject({
      data: '',
      mime: 'image/png',
      source: 'synthetic/photo.dat'
    })
    const info = await stat(first!.cacheFilePath)
    await writeFile(first!.cacheFilePath, Buffer.alloc(8, 7))
    await utimes(first!.cacheFilePath, info.atime, info.mtime)
    expect(await f.cache.get('key')).toBeNull()
    expect(await restored.get('key')).toBeNull()
  })
  it('rejects source changes and isolates accounts', async () => {
    const f = await fixture()
    await f.cache.put('key', f.entry)
    expect(
      await new ImagePresentationCache(f.root, 'another-account', f.fingerprint).get('key')
    ).toBeNull()
    f.setSource('same-size-different-bytes')
    expect(await f.cache.get('key')).toBeNull()
    await expect(f.cache.put('key', f.entry)).rejects.toMatchObject({
      code: 'MEDIA_SOURCE_CHANGED'
    })
  })
  it('rejects escaping metadata and payload symlinks without reading outside', async () => {
    const f = await fixture()
    await f.cache.put('key', f.entry)
    const value = (await f.cache.get('key'))!
    const outside = join(f.root, 'outside-fixture')
    await writeFile(outside, Buffer.from([137, 80, 78, 71, 1, 2, 3, 4]))
    await rm(value.cacheFilePath)
    await symlink(outside, value.cacheFilePath)
    expect(await f.cache.get('key')).toBeNull()
    const name = (await readdir(f.root)).find((name) => name.endsWith('.json'))!
    const metadata = JSON.parse(await readFile(join(f.root, name), 'utf8'))
    metadata.payload = '../outside-fixture'
    await writeFile(join(f.root, name), JSON.stringify(metadata))
    expect(await f.cache.get('key')).toBeNull()
  })
  it('enforces memory/disk budgets and rejects malformed data URLs', async () => {
    const f = await fixture()
    const cache = new ImagePresentationCache(f.root, 'synthetic-account', f.fingerprint, {
      memoryBytes: 1,
      diskBytes: 16,
      diskFiles: 2
    })
    for (let i = 0; i < 4; i++) await cache.put('key-' + i, f.entry)
    const entries = await readdir(f.root)
    expect(entries.filter((name) => name.endsWith('.png')).length).toBeLessThanOrEqual(2)
    expect(entries.filter((name) => name.endsWith('.json')).length).toBeLessThanOrEqual(2)
    expect((await cache.get('key-3'))?.data).toBe(data)
    await expect(
      cache.put('bad', { ...f.entry, data: 'data:image/png;base64,not-base64' })
    ).rejects.toMatchObject({ code: 'IMAGE_CACHE_INVALID' })
  })
  it('serializes concurrent writers sharing one directory without pruning the latest payloads', async () => {
    const f = await fixture()
    const limits = { memoryBytes: 1, diskBytes: 16, diskFiles: 2 }
    const first = new ImagePresentationCache(f.root, 'synthetic-account', f.fingerprint, limits)
    const second = new ImagePresentationCache(f.root, 'synthetic-account', f.fingerprint, limits)
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => (i % 2 ? first : second).put('key-' + i, f.entry))
    )
    const entries = await readdir(f.root)
    expect(entries.filter((name) => name.endsWith('.png'))).toHaveLength(2)
    const values = await Promise.all(Array.from({ length: 8 }, (_, i) => first.get('key-' + i)))
    expect(values.filter(Boolean)).toHaveLength(2)
  })
})
