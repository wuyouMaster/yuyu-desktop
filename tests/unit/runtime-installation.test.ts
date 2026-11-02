import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  installRuntime,
  readActive,
  selectRuntime,
  verifyRuntime,
  type RuntimePackage
} from '../../scripts/runtime-store.mjs'

const temporary: string[] = []
const servers: Server[] = []
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve())))
  )
  await Promise.all(temporary.splice(0).map((p) => rm(p, { recursive: true, force: true })))
})
async function fixture(
  extra?: string
): Promise<{ home: string; archive: string; item: RuntimePackage }> {
  const home = await mkdtemp(join(tmpdir(), 'synthetic-runtime-'))
  temporary.push(home)
  const archive = join(home, 'fixture.zip')
  const manifest = {
    schemaVersion: 1,
    application: 'wechat',
    version: '0.1.0-test',
    target: `${process.platform}-${process.arch}`,
    sourceCommit: 'a'.repeat(40),
    files: [{ path: 'helper', size: 9, sha256: sha(Buffer.from('synthetic')), mode: 493 }]
  }
  const encoded = JSON.stringify(manifest)
  execFileSync('python3', [
    '-c',
    'import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n z.writestr("helper",b"synthetic")\n z.writestr("runtime-manifest.json",sys.argv[2])\n if len(sys.argv)>3:z.writestr(sys.argv[3],b"outside")',
    archive,
    encoded,
    ...(extra ? [extra] : [])
  ])
  return {
    home,
    archive,
    item: {
      application: 'wechat',
      version: manifest.version,
      target: manifest.target,
      sourceCommit: manifest.sourceCommit,
      sha256: sha(await readFile(archive)),
      manifestSha256: sha(Buffer.from(encoded)),
      files: ['helper'],
      repository: 'synthetic/fixture',
      tag: 'v0.1.0-test',
      asset: 'fixture.zip',
      url: 'https://example.invalid/fixture.zip',
      releaseStatus: 'development-only'
    }
  }
}
describe('fixed runtime installation', () => {
  it('downloads over explicit loopback, verifies, activates and detects later tampering', async () => {
    const { home, archive, item } = await fixture()
    const bytes = await readFile(archive)
    const server = createServer((_, res) => res.end(bytes))
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server missing')
    await installRuntime({
      home,
      item,
      baseUrl: `http://127.0.0.1:${address.port}`,
      allowLoopback: true
    })
    expect((await readActive(home)).wechat.sha256).toBe(item.sha256)
    const root = await verifyRuntime(home, item)
    await writeFile(join(root, 'helper'), 'corrupted')
    await expect(verifyRuntime(home, item)).rejects.toThrow('校验失败')
  })
  it('keeps the private repository token off redirected asset hosts', async () => {
    const { home, archive, item } = await fixture()
    const bytes = await readFile(archive)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ assets: [{ id: 7, name: item.asset }] }))
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.example.invalid/runtime.zip' }
        })
      )
      .mockResolvedValueOnce(new Response(bytes))
    vi.stubGlobal('fetch', fetchMock)
    await installRuntime({
      home,
      item: { ...item, githubAuthentication: true },
      token: 'synthetic-token'
    })
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer synthetic-token')
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer synthetic-token')
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBeUndefined()
    await verifyRuntime(home, item)
  })
  it('downloads a generic catalog URL without repository metadata or credentials', async () => {
    const { home, archive, item } = await fixture()
    const fetchMock = vi.fn().mockResolvedValue(new Response(await readFile(archive)))
    vi.stubGlobal('fetch', fetchMock)
    await installRuntime({
      home,
      item: { ...item, repository: undefined, tag: undefined },
      token: 'unused-token'
    })
    expect(String(fetchMock.mock.calls[0][0])).toBe(item.url)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined()
    await verifyRuntime(home, item)
  })
  it('uses a custom HTTPS link ahead of mirrors and never sends GitHub credentials, even after redirects', async () => {
    const { home, archive, item } = await fixture()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://api.github.com/synthetic' }
        })
      )
      .mockResolvedValueOnce(new Response(await readFile(archive)))
    vi.stubGlobal('fetch', fetchMock)
    await installRuntime({
      home,
      item: { ...item, githubAuthentication: true },
      downloadUrl: 'https://downloads.example.invalid/runtime.zip',
      baseUrl: 'http://127.0.0.1:1',
      token: 'unused-token'
    })
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://downloads.example.invalid/runtime.zip')
    for (const call of fetchMock.mock.calls) expect(call[1].headers.Authorization).toBeUndefined()
    await verifyRuntime(home, item)
  })
  it('rejects unsafe custom URLs and corrupt downloads without activation', async () => {
    const { home, item } = await fixture()
    const fetchMock = vi.fn().mockResolvedValue(new Response('corrupt'))
    vi.stubGlobal('fetch', fetchMock)
    for (const downloadUrl of [
      '',
      'not a url',
      'http://example.invalid/runtime.zip',
      'https://user:password@example.invalid/runtime.zip'
    ]) {
      await expect(installRuntime({ home, item, downloadUrl })).rejects.toThrow()
    }
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(
      installRuntime({ home, item, downloadUrl: 'https://example.invalid/runtime.zip' })
    ).rejects.toThrow('SHA-256')
    expect(await readActive(home)).toEqual({})
  })
  it('reports real download bytes and installation phases', async () => {
    const { home, archive, item } = await fixture()
    const bytes = await readFile(archive)
    const updates: import('../../scripts/runtime-store.mjs').RuntimeTransferProgress[] = []
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(bytes, { headers: { 'content-length': String(bytes.length) } })
        )
    )
    await installRuntime({ home, item, onProgress: (p) => updates.push(p) })
    expect(updates.map((p) => p.phase)).toEqual(
      expect.arrayContaining(['connecting', 'downloading', 'verifying', 'extracting', 'activating'])
    )
    expect(updates.filter((p) => p.phase === 'downloading').at(-1)).toMatchObject({
      downloaded: bytes.length,
      total: bytes.length
    })
  })
  it('cancels a streamed download, preserves the active version and releases the install lock for retry', async () => {
    const { home, archive, item } = await fixture()
    await installRuntime({ home, archive, item })
    const bytes = await readFile(archive)
    const server = createServer((_, res) => {
      res.writeHead(200, { 'content-length': bytes.length })
      res.write(bytes.subarray(0, 10))
      const timer = setTimeout(() => res.end(bytes.subarray(10)), 1000)
      res.on('close', () => clearTimeout(timer))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server missing')
    const controller = new AbortController()
    await expect(
      installRuntime({
        home,
        item,
        baseUrl: `http://127.0.0.1:${address.port}`,
        allowLoopback: true,
        signal: controller.signal,
        onProgress: (p) => {
          if (p.phase === 'downloading' && p.downloaded > 0) controller.abort()
        }
      })
    ).rejects.toThrow()
    expect((await readActive(home)).wechat.sha256).toBe(item.sha256)
    await verifyRuntime(home, item)
    await installRuntime({ home, archive, item })
  })
  it('accepts a Windows EPERM collision only when the existing package verifies', async () => {
    const { home, archive, item } = await fixture()
    await installRuntime({ home, archive, item })
    const destination = await verifyRuntime(home, item)
    const rename = fs.rename.bind(fs)
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(from).includes('.stage-') && String(to) === destination) {
        throw Object.assign(new Error('synthetic permission error'), { code: 'EPERM' })
      }
      return rename(from, to)
    })
    await expect(installRuntime({ home, archive, item })).resolves.toMatchObject({
      sha256: item.sha256
    })
    await writeFile(join(destination, 'helper'), 'corrupted')
    await expect(installRuntime({ home, archive, item })).rejects.toMatchObject({ code: 'EPERM' })
    expect(await readFile(join(destination, 'helper'), 'utf8')).toBe('corrupted')
  })
  it('does not activate a package when EPERM occurs without an existing destination', async () => {
    const { home, archive, item } = await fixture()
    const rename = fs.rename.bind(fs)
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(from).includes('.stage-')) {
        throw Object.assign(new Error('synthetic permission error'), { code: 'EPERM' })
      }
      return rename(from, to)
    })
    await expect(installRuntime({ home, archive, item })).rejects.toMatchObject({ code: 'EPERM' })
    expect(await readActive(home)).toEqual({})
  })
  it('keeps the active version after a corrupt archive is rejected', async () => {
    const { home, archive, item } = await fixture()
    await installRuntime({ home, item, archive })
    await writeFile(archive, 'bad archive')
    await expect(installRuntime({ home, item, archive })).rejects.toThrow('SHA-256')
    expect((await readActive(home)).wechat.sha256).toBe(item.sha256)
    await verifyRuntime(home, item)
  })
  it('rejects unexpected path traversal entries before activation', async () => {
    const { home, archive, item } = await fixture('../outside')
    await expect(installRuntime({ home, item, archive })).rejects.toThrow('清单之外')
    expect(await readActive(home)).toEqual({})
  })
  it('rejects an incorrect manifest identity and unsupported versions', async () => {
    const { home, archive, item } = await fixture()
    await expect(
      installRuntime({ home, item: { ...item, sourceCommit: 'b'.repeat(40) }, archive })
    ).rejects.toThrow('身份')
    expect(() => selectRuntime({ packages: [item] }, 'wechat', 'latest', item.target)).toThrow(
      '指定版本'
    )
  })
  it('does not trust a modified installed manifest', async () => {
    const { home, archive, item } = await fixture()
    await installRuntime({ home, item, archive })
    const root = await verifyRuntime(home, item)
    await writeFile(join(root, 'runtime-manifest.json'), '{}')
    await expect(verifyRuntime(home, item)).rejects.toThrow('清单校验失败')
  })
  it('rejects non-loopback test sources and plaintext remote URLs', async () => {
    const { home, item } = await fixture()
    await expect(
      installRuntime({ home, item, baseUrl: 'http://example.invalid', allowLoopback: true })
    ).rejects.toThrow('回环')
    await expect(
      installRuntime({ home, item: { ...item, url: 'http://example.invalid/archive' } })
    ).rejects.toThrow('HTTPS')
  })
})
