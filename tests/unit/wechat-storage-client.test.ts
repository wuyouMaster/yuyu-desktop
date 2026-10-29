import { describe, expect, it, vi } from 'vitest'
import { WechatStorageClient } from '../../src/main/runtime-rpc/wechat-storage-client'
const description = {
  application: 'wechat',
  protocol: 1,
  implementation: 'go',
  version: '0.1.0-dev.3',
  platform: 'darwin',
  arch: 'arm64',
  methods: ['identity.read', 'identity.derive', 'message.parse', 'message.imageDataURL']
}
describe('public WeChat protocol consumer', () => {
  it('does not confuse a missing method with an empty account', () => {
    const call = vi.fn().mockReturnValueOnce({ ...description, methods: [] })
    expect(() => new WechatStorageClient({ call }).readLocalAccountIdentity('/fixture')).toThrow(
      'CAPABILITY_UNAVAILABLE'
    )
    expect(call).toHaveBeenCalledTimes(1)
  })
  it.each([
    { ...description, application: 'telegram' },
    { ...description, protocol: 2 },
    { ...description, privateSource: 'fixture' }
  ])('rejects incompatible descriptions %#', (value) => {
    expect(() =>
      new WechatStorageClient({ call: () => value }).deriveAccountWxid('fixture')
    ).toThrow('INCOMPATIBLE_RUNTIME')
  })
  it('preserves missing-profile and successful-identity distinctions', () => {
    const call = vi
      .fn()
      .mockReturnValueOnce(description)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ wxid: 'wxid_fixture', nickname: '合成账号' })
      .mockReturnValueOnce({ wxid: 'wxid_fixture', privateKey: 'fixture' })
    const client = new WechatStorageClient({ call })
    expect(client.readLocalAccountIdentity('/fixture')).toBeNull()
    expect(client.readLocalAccountIdentity('/fixture')).toEqual({
      wxid: 'wxid_fixture',
      nickname: '合成账号'
    })
    expect(() => client.readLocalAccountIdentity('/fixture')).toThrow('INVALID_RUNTIME_RESPONSE')
  })
  it('validates message variants and retains legacy invalid numeric values', () => {
    const call = vi
      .fn()
      .mockReturnValueOnce(description)
      .mockReturnValueOnce({ type: 'text', content: '合成文本' })
      .mockReturnValueOnce({ type: 'location', lat: null, lng: 2 })
      .mockReturnValueOnce({ type: 'text', content: 42 })
    const client = new WechatStorageClient({ call })
    expect(client.parseMessageContent('fixture', 1)).toEqual({ type: 'text', content: '合成文本' })
    expect(client.parseMessageContent('fixture', 48)).toEqual({
      type: 'location',
      lat: NaN,
      lng: 2
    })
    expect(() => client.parseMessageContent('fixture', 1)).toThrow('INVALID_RUNTIME_RESPONSE')
  })
  it('serializes byte rows without putting bytes or paths in arguments', () => {
    const call = vi.fn().mockReturnValueOnce(description).mockReturnValueOnce(null)
    const client = new WechatStorageClient({ call })
    expect(
      client.parseImageBufferDataUrlFromRow({ ImgBuf: Buffer.from([1, 2, 3]) })
    ).toBeUndefined()
    expect(call.mock.calls[1]).toEqual([
      'message.imageDataURL',
      { row: { ImgBuf: { type: 'Buffer', data: [1, 2, 3] } } }
    ])
  })
})
