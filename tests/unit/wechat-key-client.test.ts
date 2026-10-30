import { describe, it, expect, vi } from 'vitest'
import { WechatKeyClient } from '../../src/main/runtime-rpc/wechat-key-client'
import { RuntimeRpcError } from '../../src/shared/runtime-rpc'
function fixture() {
  const callAsync = vi
    .fn()
    .mockResolvedValueOnce({
      application: 'wechat',
      protocol: 1,
      implementation: 'go',
      version: '0.1.0-fixture',
      platform: 'darwin',
      arch: 'arm64',
      methods: ['key.captureDatabase', 'key.verifyImage', 'key.inspect']
    })
  return { rpc: { call: vi.fn(), callAsync }, callAsync }
}
describe('public key acquisition protocol', () => {
  it('does not accept captured keys before database verification', async () => {
    const { rpc, callAsync } = fixture()
    callAsync.mockResolvedValueOnce({
      success: true,
      key: '12'.repeat(32),
      keyKind: 'account',
      profile: 'fixture',
      verified: false
    })
    await expect(
      new WechatKeyClient(rpc).captureDatabase(1001, '/fixture/account', 1000)
    ).rejects.toThrow('INVALID_RUNTIME_RESPONSE')
  })
  it('marks capture as a side effect without retrying or exposing helper details', async () => {
    const { rpc, callAsync } = fixture()
    callAsync.mockRejectedValueOnce(new RuntimeRpcError('KEY_HELPER_CLEANUP_UNCONFIRMED', true))
    await expect(
      new WechatKeyClient(rpc).captureDatabase(1001, '/fixture/account', 1000)
    ).rejects.toMatchObject({ code: 'KEY_HELPER_CLEANUP_UNCONFIRMED', resultUnknown: true })
    expect(callAsync).toHaveBeenCalledTimes(2)
    expect(callAsync.mock.calls[1]).toEqual([
      'key.captureDatabase',
      { pid: 1001, root: '/fixture/account', timeoutMs: 1000 },
      { timeoutMs: 8000, signal: undefined, sideEffect: true }
    ])
  })
  it('rejects missing digests before forwarding image bytes', async () => {
    const { rpc, callAsync } = fixture()
    await expect(
      new WechatKeyClient(rpc).verifyImage(new Uint8Array([1]), 1, 'fixture', '')
    ).rejects.toThrow('INVALID_ARGUMENT')
    expect(callAsync).not.toHaveBeenCalled()
  })
})
