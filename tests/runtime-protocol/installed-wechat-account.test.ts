import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { readFile, writeFile, mkdtemp, rm, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve, basename } from 'node:path'
import { installRuntime, verifyRuntime, type RuntimePackage } from '../../scripts/runtime-store.mjs'
import {
  openInstalledWechatAccount,
  type InstalledWechatAccount,
  type InstalledWechatAccountOptions
} from '../../src/main/runtime-rpc/installed-wechat-account'

const archive = process.env.YUYU_TEST_WECHAT_ARCHIVE
const sourceRoot = process.env.YUYU_TEST_DATABASE_DETAILS_ROOT
const hevcPath = process.env.YUYU_TEST_HEVC_FIXTURE
if (!archive || !sourceRoot || !hevcPath || ![archive, sourceRoot, hevcPath].every(isAbsolute))
  throw new Error('Packaged native candidate and synthetic database/HEVC fixtures are required')
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex')
let root: string,
  options: InstalledWechatAccountOptions,
  item: RuntimePackage,
  server: Server,
  installed: string
const owners: InstalledWechatAccount[] = []
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'synthetic-installed-account-'))
  const bytes = await readFile(archive!)
  const manifestBytes = await readFile(`${archive}.manifest.json`)
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  expect(manifest.files.map((f: { path: string }) => f.path)).toContain(
    'third-party/ffmpeg/ffmpeg-9.0.2.tar.xz'
  )
  server = createServer((request, response) => {
    expect(request.headers.authorization).toBeUndefined()
    response.setHeader('Content-Length', bytes.length)
    response.end(bytes)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Loopback listener missing')
  item = {
    application: manifest.application,
    version: manifest.version,
    target: manifest.target,
    sourceCommit: manifest.sourceCommit,
    releaseStatus: manifest.releaseStatus,
    sha256: digest(bytes),
    manifestSha256: digest(manifestBytes),
    files: manifest.files.map((file: { path: string }) => file.path),
    asset: basename(archive!),
    url: `http://127.0.0.1:${address.port}/candidate.zip`
  }
  const home = join(root, 'runtime')
  await installRuntime({ home, item, allowLoopback: true })
  installed = await verifyRuntime(home, item)
  const accountRoot = join(root, 'account')
  await cp(sourceRoot!, accountRoot, { recursive: true })
  const hevc = await readFile(hevcPath!)
  await writeFile(
    join(accountRoot, 'synthetic-image.dat'),
    Buffer.concat([Buffer.from([119, 120, 103, 102, 12, 0, 0, 0, 0, 0, 0, 0]), hevc])
  )
  options = {
    home,
    item,
    workerPath: resolve('out/worker/main/runtime-rpc/bridge-worker.js'),
    accountRoot,
    rawKey: Buffer.from('fixture-only-account-key-32-byte').toString('hex'),
    cacheDirectory: join(root, 'cache')
  }
})
afterAll(async () => {
  await Promise.all(owners.map((owner) => owner.close()))
  if (server) await new Promise<void>((done) => server.close(() => done()))
  if (root) await rm(root, { recursive: true, force: true })
})
describe('installed candidate composes one owned database/image application session', () => {
  it('downloads without credentials, opens actual native ports and restores cache after owner restart', async () => {
    const first = await openInstalledWechatAccount(options)
    owners.push(first)
    expect(await first.database.implementation.getSessionsAsync!()).toHaveLength(1)
    expect(first.storage.parseMessageContent('合成消息', 1)).toEqual({
      type: 'text',
      content: '合成消息'
    })
    const path = join(options.accountRoot, 'synthetic-image.dat')
    const image = await first.images.decryptImageToBase64WithFallbackAsync(path, false)
    expect(image?.filePath).toBe(path)
    const data = Buffer.from(image!.data.split(',')[1], 'base64')
    expect(data.readUInt32BE(16)).toBe(32)
    expect(data.readUInt32BE(20)).toBe(24)
    await first.images.cacheDecodedImage('synthetic-key', { ...image!, isThumbnail: false })
    expect(await first.database.lifecycle.closeAsync()).toBe(true)
    expect(() => first.database.implementation.getSessions!()).toThrow('DATABASE_CLOSED')
    expect(() => first.images.decryptImage(path)).toThrow('MEDIA_SESSION_CLOSED')
    const second = await openInstalledWechatAccount(options)
    owners.push(second)
    expect((await second.images.getCachedDecodedImage('synthetic-key'))?.data).toBe(image!.data)
    expect(await second.database.implementation.getSessionsAsync!()).toHaveLength(1)
    await second.close()
    await second.close()
  })
  it('rejects a changed installed binary before starting a worker or falling back', async () => {
    const path = join(installed, 'ffmpeg'),
      bytes = await readFile(path)
    try {
      const changed = Buffer.from(bytes)
      changed[changed.length - 1] ^= 1
      await writeFile(path, changed)
      await expect(
        openInstalledWechatAccount({ ...options, workerPath: join(root, 'must-not-start.js') })
      ).rejects.toThrow('运行时文件校验失败')
    } finally {
      await writeFile(path, bytes)
    }
    await expect(
      openInstalledWechatAccount({
        ...options,
        item: { ...item, files: item.files.filter((file) => file !== 'wechat-storage-host') }
      })
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
  })
})
