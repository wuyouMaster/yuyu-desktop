import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import type { RuntimePackage } from '../../scripts/runtime-store.mjs'
const mocks = vi.hoisted(() => ({ starts: vi.fn() }))
vi.mock('../../src/main/runtime-rpc/bridge-client', () => ({
  RuntimeRpcBridgeClient: class {
    constructor(...args: unknown[]) {
      mocks.starts(...args)
    }
  }
}))
import { createInstalledRuntimeHost } from '../../src/main/runtime-rpc/installed-runtime-host'
const dirs: string[] = []
afterEach(() => {
  dirs.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }))
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
function fixture(application: 'wechat' | 'telegram' = 'wechat') {
  const home = mkdtempSync(join(tmpdir(), 'synthetic-host-'))
  dirs.push(home)
  const name = (application === 'wechat' ? 'wechat-storage-host' : 'telegram/telegram-storage-host') +
    (process.platform === 'win32' ? '.exe' : '')
  const manifest = JSON.stringify({
    schemaVersion: 1,
    application,
    version: '0.1.0-test',
    target: `${process.platform}-${process.arch}`,
    sourceCommit: 'a'.repeat(40),
    files: [{ path: name, size: 7, sha256: sha('fixture'), mode: 493 }]
  })
  const item: RuntimePackage = {
    application,
    version: '0.1.0-test',
    target: `${process.platform}-${process.arch}`,
    sourceCommit: 'a'.repeat(40),
    sha256: 'b'.repeat(64),
    manifestSha256: sha(manifest),
    files: [name],
    asset: 'fixture.zip',
    url: 'https://example.invalid/fixture.zip',
    releaseStatus: 'development-only'
  }
  const root = join(home, 'packages', application, item.sha256)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'runtime-manifest.json'), manifest)
  mkdirSync(dirname(join(root, name)), { recursive: true })
  writeFileSync(join(root, name), 'fixture')
  chmodSync(join(root, name), 0o755)
  return { home, root, name, item, workerPath: join(home, 'synthetic-worker.js') }
}
describe('verified installed runtime ownership', () => {
  it('starts only the pinned executable with a clean environment and cleanup grace', () => {
    const f = fixture()
    vi.stubEnv('SYNTHETIC_SECRET', 'do-not-inherit')
    createInstalledRuntimeHost({ ...f, shutdownGraceMs: 7000 })
    expect(mocks.starts).toHaveBeenCalledExactlyOnceWith(f.workerPath, {
      executable: join(f.root, f.name),
      env: {
        PATH: '',
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        ...(process.platform === 'win32' && process.env.SystemRoot
          ? { SystemRoot: process.env.SystemRoot }
          : {})
      },
      shutdownGraceMs: 7000
    })
  })
  it('starts the verified Telegram host inside its packaged directory', () => {
    const f = fixture('telegram')
    createInstalledRuntimeHost(f)
    expect(mocks.starts).toHaveBeenCalledExactlyOnceWith(f.workerPath, {
      executable: join(f.root, f.name),
      env: {
        PATH: '',
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        ...(process.platform === 'win32' && process.env.SystemRoot
          ? { SystemRoot: process.env.SystemRoot }
          : {})
      },
      shutdownGraceMs: undefined
    })
  })
  it.each(['bytes', 'manifest', 'symlink', 'missing'] as const)(
    'never starts a worker for %s corruption',
    (kind) => {
      const f = fixture()
      const file = join(f.root, f.name)
      if (kind === 'bytes') writeFileSync(file, 'changed')
      if (kind === 'manifest') writeFileSync(join(f.root, 'runtime-manifest.json'), '{}')
      if (kind === 'missing') rmSync(file)
      if (kind === 'symlink') {
        rmSync(file)
        const outside = join(f.home, 'outside')
        writeFileSync(outside, 'fixture')
        chmodSync(outside, 0o755)
        symlinkSync(outside, file)
      }
      expect(() => createInstalledRuntimeHost(f)).toThrow('RUNTIME_INTEGRITY_FAILED')
      expect(mocks.starts).not.toHaveBeenCalled()
    }
  )
  it('rejects unsupported applications, foreign targets and missing host capability', () => {
    const f = fixture()
    for (const item of [
      { ...f.item, application: 'arbitrary' },
      { ...f.item, target: 'foreign' },
      { ...f.item, files: [] }
    ])
      expect(() => createInstalledRuntimeHost({ ...f, item })).toThrow()
    expect(mocks.starts).not.toHaveBeenCalled()
  })
})
