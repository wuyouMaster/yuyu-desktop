import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { installRuntime, verifyRuntime, type RuntimePackage } from '../../scripts/runtime-store.mjs'
import { createInstalledRuntimeHost } from '../../src/main/runtime-rpc/installed-runtime-host'
import { TelegramStorageClient } from '../../src/main/runtime-rpc/telegram-storage-client'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
import { runtimeCompatibilityError } from '../../src/main/runtime-catalog'

const archive = process.env.YUYU_TEST_TELEGRAM_ARCHIVE
const fixturePath = process.env.YUYU_TEST_TELEGRAM_FIXTURE
if (!archive || !fixturePath || ![archive, fixturePath].every(isAbsolute))
  throw new Error('Absolute Telegram candidate archive and synthetic fixture required')
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex')
let root: string, home: string, installed: string, item: RuntimePackage, server: Server

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'synthetic-telegram-install-')))
  home = join(root, 'runtime')
  const bytes = await readFile(archive!)
  const manifestBytes = await readFile(`${archive}.manifest.json`)
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  expect(manifest.application).toBe('telegram')
  expect(manifest.target).toBe(`${process.platform}-${process.arch}`)
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
  expect(runtimeCompatibilityError(item)).toBeUndefined()
  await installRuntime({ home, item, allowLoopback: true })
  installed = await verifyRuntime(home, item)
}, 120_000)

afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()))
  if (root) await rm(root, { recursive: true, force: true })
})

describe('installed Telegram candidate', () => {
  it('starts the verified packaged host and negotiates its actual protocol', async () => {
    const rpc = createInstalledRuntimeHost({
      home, item, workerPath: resolve('out/worker/main/runtime-rpc/bridge-worker.js')
    })
    const client = new TelegramStorageClient({ call: rpc.callAsync.bind(rpc), close: rpc.close.bind(rpc) })
    try {
      await expect(rpc.callAsync('runtime.describe', {})).resolves.toMatchObject({
        application: 'telegram', protocol: 1,
        methods: expect.arrayContaining(['storage.inspect', 'cache.open', 'cache.resolve', 'cache.close'])
      })
      const fixture = JSON.parse(await readFile(fixturePath!, 'utf8')) as { files: Record<string, string> }
      const dataRoot = join(root, 'synthetic-tdata')
      for (const [name, data] of Object.entries(fixture.files)) {
        if (!/^[a-zA-Z0-9_/-]+$/.test(name) || name.split('/').includes('..'))
          throw new Error('Invalid synthetic fixture path')
        const file = join(dataRoot, name)
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, Buffer.from(data, 'base64'))
      }
      await mkdir(join(dataRoot, 'user_data', 'cache'), { recursive: true })
      const inspection = await client.inspect(dataRoot)
      expect(inspection.storageVersion).toBe(7002005)
      expect(inspection.accounts).toMatchObject([
        { label: '合成 Telegram 甲', slot: 0, state: 'metadata_read', isActive: false },
        { label: '合成 Telegram 乙', slot: 2, state: 'metadata_read', isActive: true }
      ])
    } finally {
      await client.close()
    }
  })

  it('refuses a modified host before starting the process', async () => {
    const host = join(installed, 'telegram', 'telegram-storage-host')
    const original = await readFile(host)
    const changed = Buffer.from(original)
    changed[changed.length - 1] ^= 1
    try {
      await writeFile(host, changed)
      expect(() => createInstalledRuntimeHost({
        home, item, workerPath: resolve('out/worker/main/runtime-rpc/bridge-worker.js')
      })).toThrow('RUNTIME_INTEGRITY_FAILED')
    } finally {
      await writeFile(host, original)
    }
  })
})
