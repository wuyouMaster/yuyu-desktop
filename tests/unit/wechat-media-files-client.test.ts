import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { WechatMediaFilesClient } from '../../src/main/runtime-rpc/wechat-media-files-client'
import type { RuntimeJson } from '../../src/shared/runtime-rpc'

function fixture(data = Buffer.from([137, 80, 78, 71, 1])) {
  const info = {
    transferId: 'b'.repeat(48),
    path: 'fixture.dat',
    size: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
    mime: 'image/png',
    diagnostic: 'DIRECT_IMAGE',
    requiresDecoder: false
  }
  const chunk = { offset: 0, data: data.toString('base64'), eof: true }
  const call = vi.fn((method: string): RuntimeJson => {
    if (method === 'runtime.describe')
      return {
        application: 'wechat',
        protocol: 1,
        implementation: 'go',
        version: 'fixture',
        platform: 'darwin',
        arch: 'arm64',
        methods: [
          'media.open',
          'media.close',
          'media.find',
          'media.fileOpen',
          'media.decodeFile',
          'media.read',
          'media.release'
        ]
      }
    if (method === 'media.open') return { sessionId: 'a'.repeat(48) }
    if (method === 'media.fileOpen')
      return { ...info, mime: 'application/octet-stream', diagnostic: 'FILE' }
    if (method === 'media.decodeFile') return info
    if (method === 'media.read') return chunk
    return true
  })
  const callAsync = vi.fn(async (method: string) => call(method))
  const client = new WechatMediaFilesClient({ call, callAsync })
  client.open(resolve('fixture'))
  return { client, call, callAsync, info, chunk }
}
describe('bounded media transfer consumer', () => {
  it('refuses a complete image adapter when the runtime only supports byte transfers', () => {
    const f = fixture()
    expect(() => f.client.assertImageCapabilities()).toThrow('CAPABILITY_UNAVAILABLE')
    f.client.close()
    expect(() => f.client.assertImageCapabilities()).toThrow('MEDIA_SESSION_CLOSED')
  })
  it('verifies exact bytes in sync and async decoding and releases both handles', async () => {
    const f = fixture()
    expect(f.client.decode('fixture.dat').data).toEqual(Buffer.from([137, 80, 78, 71, 1]))
    expect((await f.client.decodeAsync('fixture.dat')).data).toEqual(
      Buffer.from([137, 80, 78, 71, 1])
    )
    expect(f.call.mock.calls.filter(([method]) => method === 'media.release')).toHaveLength(2)
    f.client.close()
    expect(() => f.client.decode('fixture.dat')).toThrow('MEDIA_SESSION_CLOSED')
  })
  it('rejects wrong offsets, truncation, noncanonical bytes, false EOF and changed content', async () => {
    for (const bad of [
      { offset: 1 },
      { data: 'AQ==' },
      { data: 'iVBORwF=' },
      { eof: false },
      { data: Buffer.from([137, 80, 78, 71, 2]).toString('base64') }
    ]) {
      const f = fixture()
      Object.assign(f.chunk, bad)
      await expect(f.client.decodeAsync('fixture.dat')).rejects.toThrow(
        /INVALID_RUNTIME_RESPONSE|MEDIA_DIGEST_MISMATCH/
      )
      expect(f.call).toHaveBeenCalledWith('media.release')
    }
  })
  it('releases malformed transfer metadata and rejects traversal before opening', async () => {
    const f = fixture()
    f.info.size = 49 * 1024 * 1024
    await expect(f.client.decodeAsync('fixture.dat')).rejects.toThrow('INVALID_RUNTIME_RESPONSE')
    expect(f.call).toHaveBeenCalledWith('media.release')
    f.call.mockClear()
    expect(() => f.client.decode('../fixture.dat')).toThrow('INVALID_ARGUMENT')
    expect(f.call).not.toHaveBeenCalled()
  })
  it('never publishes partial or digest-mismatched output and preserves existing destinations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'media-consumer-'))
    try {
      const destination = join(root, 'result.bin')
      const corrupt = fixture()
      corrupt.info.sha256 = '0'.repeat(64)
      await expect(corrupt.client.copyToFileAsync('fixture.dat', destination)).rejects.toThrow(
        'MEDIA_DIGEST_MISMATCH'
      )
      expect(await readdir(root)).toEqual([])
      const good = fixture()
      await good.client.copyToFileAsync('fixture.dat', destination)
      expect(await readFile(destination)).toEqual(Buffer.from([137, 80, 78, 71, 1]))
      await writeFile(destination, 'preserve')
      await expect(good.client.copyToFileAsync('fixture.dat', destination)).rejects.toMatchObject({
        code: 'EEXIST'
      })
      expect(await readFile(destination, 'utf8')).toBe('preserve')
      expect(await readdir(root)).toEqual(['result.bin'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('cleans temporary output and releases native handle when cancellation arrives during a read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'media-cancel-'))
    const f = fixture()
    const abort = new AbortController()
    f.callAsync.mockImplementation(async (method) => {
      const value = f.call(method)
      if (method === 'media.read') abort.abort()
      return value
    })
    try {
      await expect(
        f.client.copyToFileAsync('fixture.dat', join(root, 'result'), abort.signal)
      ).rejects.toThrow('CANCELLED')
      expect(await readdir(root)).toEqual([])
      expect(f.call).toHaveBeenCalledWith('media.release')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
