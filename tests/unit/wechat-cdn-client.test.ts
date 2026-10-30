import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { WechatCDNClient } from '../../src/main/runtime-rpc/wechat-cdn-client'
import type { RuntimeJson } from '../../src/shared/runtime-rpc'
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
it.each(['digest', 'offset', 'length', 'eof', 'cleanup'])(
  'rejects %s failure and closes the native transaction',
  async (kind) => {
    const bytes = Buffer.alloc(600 * 1024, 3),
      id = 'a'.repeat(48)
    const callAsync = vi.fn(async (method: string, params: RuntimeJson): Promise<RuntimeJson> => {
      const p = params as Record<string, RuntimeJson>
      if (method === 'runtime.describe')
        return {
          application: 'wechat',
          implementation: 'go',
          protocol: 1,
          version: 'synthetic',
          platform: 'darwin',
          arch: 'arm64',
          methods: ['cdn.open', 'cdn.write', 'cdn.finish', 'cdn.read', 'cdn.close']
        }
      if (method === 'cdn.open') return { jobId: id }
      if (method === 'cdn.write') return true
      if (method === 'cdn.finish')
        return { size: bytes.length, sha256: kind === 'digest' ? '0'.repeat(64) : sha(bytes) }
      if (method === 'cdn.read') {
        const offset = p.offset as number,
          length = p.length as number
        return {
          offset: kind === 'offset' ? 1 : offset,
          data:
            kind === 'length' ? 'AA==' : bytes.subarray(offset, offset + length).toString('base64'),
          eof: kind === 'eof' ? true : offset + length === bytes.length
        }
      }
      if (method === 'cdn.close') {
        if (kind === 'cleanup') throw new Error('cleanup failed')
        return true
      }
      throw new Error(method)
    })
    const client = new WechatCDNClient({ call: vi.fn(), callAsync })
    await expect(client.decrypt(Buffer.alloc(16), 'ab'.repeat(16))).rejects.toThrow()
    expect(callAsync.mock.calls.at(-1)).toEqual(['cdn.close', { jobId: id }, { timeoutMs: 5000 }])
  }
)
it('rejects unaligned payloads and malformed keys before a worker call', async () => {
  const rpc = { call: vi.fn(), callAsync: vi.fn() },
    client = new WechatCDNClient(rpc)
  await expect(client.decrypt(Buffer.alloc(15), 'ab'.repeat(16))).rejects.toThrow(
    'INVALID_ARGUMENT'
  )
  await expect(client.decrypt(Buffer.alloc(16), 'wrong')).rejects.toThrow('INVALID_ARGUMENT')
  expect(rpc.callAsync).not.toHaveBeenCalled()
})
