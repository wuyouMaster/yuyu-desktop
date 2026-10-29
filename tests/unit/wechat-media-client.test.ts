import { describe, expect, it, vi } from 'vitest'
import { WechatMediaClient } from '../../src/main/runtime-rpc/wechat-media-client'

function fixture(methods = ['media.decode', 'media.decryptCDN']) {
  const call = vi.fn().mockReturnValueOnce({
    application: 'wechat',
    protocol: 1,
    implementation: 'go',
    version: '0.1.0-fixture',
    platform: 'darwin',
    arch: 'arm64',
    methods
  })
  return { call, client: new WechatMediaClient({ call, callAsync: vi.fn() }) }
}
describe('public media protocol validation', () => {
  it('rejects unavailable methods without trying a private fallback', () => {
    const { call, client } = fixture([])
    expect(() => client.decode(Buffer.from([1, 2, 3, 4]))).toThrow('CAPABILITY_UNAVAILABLE')
    expect(call).toHaveBeenCalledTimes(1)
  })
  it('rejects malformed bytes and inconsistent decoder metadata', () => {
    for (const response of [
      {
        data: '*invalid*',
        mime: 'image/png',
        md5: 'a'.repeat(32),
        diagnostic: 'SUCCESS',
        requiresDecoder: false
      },
      {
        data: 'AQIDBA==',
        mime: 'image/wxgf',
        md5: 'a'.repeat(32),
        diagnostic: 'SUCCESS',
        requiresDecoder: false
      },
      {
        data: 'AQIDBA==',
        mime: 'image/png',
        md5: 'a'.repeat(32),
        diagnostic: 'WXGF_REQUIRES_DECODER',
        requiresDecoder: true
      }
    ]) {
      const { call, client } = fixture()
      call.mockReturnValueOnce(response)
      expect(() => client.decode(Buffer.from([1, 2, 3, 4]))).toThrow('INVALID_RUNTIME_RESPONSE')
    }
  })
  it('rejects bad keys, integer bounds and unknown options before dispatch', () => {
    const { call, client } = fixture()
    expect(() => client.decode(Buffer.from([1]), { xorKey: 256 })).toThrow('INVALID_ARGUMENT')
    expect(() => client.decryptCDN(Buffer.alloc(16), 'db-key-is-not-a-media-key')).toThrow(
      'INVALID_ARGUMENT'
    )
    expect(call).not.toHaveBeenCalled()
  })
})
