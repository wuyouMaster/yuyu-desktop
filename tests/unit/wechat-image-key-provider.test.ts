import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { WechatImageKeyProvider } from '../../src/main/runtime-rpc/wechat-image-key-provider'
import { RuntimeRpcError } from '../../src/shared/runtime-rpc'
function fixture(value: unknown) {
  const close = vi.fn(async () => {})
  const callAsync = vi
    .fn()
    .mockResolvedValueOnce({
      application: 'wechat',
      protocol: 1,
      implementation: 'go',
      version: 'fixture',
      platform: 'darwin',
      arch: 'arm64',
      methods: ['key.discoverImage']
    })
    .mockImplementation(async () => {
      if (value instanceof Error) throw value
      return value
    })
  const create = vi.fn(async () => ({ call: vi.fn(), callAsync, close }))
  return { create, close, callAsync, provider: new WechatImageKeyProvider(create) }
}
const verified = { success: true, verified: true, xorKey: 7, aesKey: '1234567890abcdef' }
describe('native image-key product adapter', () => {
  it('returns only proven keys after owner close and keeps progress free of credentials', async () => {
    const f = fixture(verified),
      messages: string[] = []
    expect(
      await f.provider.autoGetImageKey(resolve('synthetic-account'), (message) => {
        messages.push(message)
        throw new Error('UI closed')
      })
    ).toEqual(verified)
    expect(f.close).toHaveBeenCalledTimes(1)
    expect(messages.join(' ')).not.toContain(verified.aesKey)
    expect(f.callAsync.mock.calls[1][0]).toBe('key.discoverImage')
    expect(f.provider).not.toHaveProperty('autoGetDbKey')
  })
  it('rejects an unverified response and never falls back to guessing keys', async () => {
    const f = fixture({ ...verified, verified: false })
    expect(await f.provider.autoGetImageKey(resolve('synthetic-account'))).toEqual({
      success: false,
      error: '图片密钥检查失败'
    })
    expect(f.callAsync).toHaveBeenCalledTimes(2)
    expect(f.close).toHaveBeenCalledOnce()
  })
  it('does not report successful acquisition if cleanup was not confirmed', async () => {
    const f = fixture(verified)
    f.close.mockRejectedValueOnce(new RuntimeRpcError('RUNTIME_CLEANUP_UNCONFIRMED'))
    expect(await f.provider.autoGetImageKey(resolve('synthetic-account'))).toEqual({
      success: false,
      error: '图片密钥运行时未确认正常关闭'
    })
  })
  it('rejects missing accounts without starting a process and redacts unexpected failures', async () => {
    const f = fixture(new Error('sensitive-source-and-key'))
    expect((await f.provider.autoGetImageKey()).success).toBe(false)
    expect(f.create).not.toHaveBeenCalled()
    expect(await f.provider.autoGetImageKey(resolve('synthetic-account'))).toEqual({
      success: false,
      error: '图片密钥检查失败'
    })
    expect(f.close).toHaveBeenCalledOnce()
  })
})
