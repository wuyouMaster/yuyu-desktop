import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { WechatDatabaseKeyProvider } from '../../src/main/runtime-rpc/wechat-database-key-provider'
import { RuntimeRpcError } from '../../src/shared/runtime-rpc'
const key = '12'.repeat(32)
const verified = { success: true, key, keyKind: 'account', profile: 'fixture', verified: true }
function fixture(value: unknown = verified) {
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
      methods: ['key.captureDatabaseAuthorized']
    })
    .mockImplementation(async () => {
      if (value instanceof Error) throw value
      return value
    })
  const create = vi.fn(async (_options: { shutdownGraceMs: number }) => ({
    call: vi.fn(),
    callAsync,
    close
  }))
  return { close, callAsync, create, provider: new WechatDatabaseKeyProvider(create) }
}
describe('authorized database key application adapter', () => {
  it('separates authorization wait from capture deadline and returns only after cleanup', async () => {
    const f = fixture(),
      progress: string[] = []
    expect(
      await f.provider.autoGetDbKey((message) => {
        progress.push(message)
        throw new Error('observer')
      }, resolve('synthetic-account'))
    ).toEqual({ success: true, key })
    expect(f.create).toHaveBeenCalledWith({ shutdownGraceMs: 7000 })
    expect(f.callAsync.mock.calls[1]).toEqual([
      'key.captureDatabaseAuthorized',
      { pid: 0, root: resolve('synthetic-account'), timeoutMs: 60000 },
      { timeoutMs: 187000, signal: expect.any(AbortSignal), sideEffect: true }
    ])
    expect(f.close).toHaveBeenCalledOnce()
    expect(progress.join(' ')).not.toContain(key)
  })
  it('refuses missing account before launching and never retries denied authorization', async () => {
    const f = fixture(new RuntimeRpcError('KEY_AUTHORIZATION_CANCELLED'))
    expect(await f.provider.autoGetDbKey()).toMatchObject({
      success: false,
      code: 'INVALID_ARGUMENT'
    })
    expect(f.create).not.toHaveBeenCalled()
    expect(await f.provider.autoGetDbKey(undefined, resolve('synthetic-account'))).toEqual({
      success: false,
      code: 'KEY_AUTHORIZATION_CANCELLED',
      error: '已取消系统授权'
    })
    expect(f.callAsync).toHaveBeenCalledTimes(2)
    expect(f.close).toHaveBeenCalledOnce()
  })
  it('rejects an unverified key and propagates unconfirmed cleanup', async () => {
    const f = fixture({ ...verified, verified: false })
    expect(await f.provider.autoGetDbKey(undefined, resolve('synthetic-account'))).toMatchObject({
      success: false,
      code: 'INVALID_RUNTIME_RESPONSE'
    })
    const other = fixture()
    other.close.mockRejectedValueOnce(new Error('private output'))
    expect(await other.provider.autoGetDbKey(undefined, resolve('synthetic-account'))).toEqual({
      success: false,
      code: 'RUNTIME_CLEANUP_UNCONFIRMED',
      error: '未确认密钥工具已安全结束，请先检查微信状态'
    })
  })
  it('keeps cancellation busy until owned transport finishes closing and discards late keys', async () => {
    const f = fixture()
    let closeDone!: () => void
    f.close.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          closeDone = resolve
        })
    )
    const pending = f.provider.autoGetDbKey(undefined, resolve('synthetic-account'))
    await vi.waitFor(() => expect(f.close).toHaveBeenCalledOnce())
    f.provider.cancel()
    expect(await f.provider.autoGetDbKey(undefined, resolve('synthetic-account'))).toMatchObject({
      success: false,
      code: 'KEY_CAPTURE_BUSY'
    })
    closeDone()
    expect(await pending).toMatchObject({ success: false, code: 'CANCELLED' })
  })
  it('redacts unexpected errors instead of forwarding privileged stderr', async () => {
    const f = fixture(new Error('sensitive fixture path'))
    expect(await f.provider.autoGetDbKey(undefined, resolve('synthetic-account'))).toEqual({
      success: false,
      code: 'KEY_OPERATION_FAILED',
      error: '数据库密钥获取或验证失败'
    })
  })
})
