import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { WechatILinkClient } from '../../src/main/runtime-rpc/wechat-ilink-client'
import { RuntimeRpcError } from '../../src/shared/runtime-rpc'
import type { DatabaseRpcTransport } from '../../src/main/runtime-rpc/wechat-database-client'

const owner = 'a'.repeat(48)
const batchId = 'b'.repeat(32)
const message = {
  accountId: 'synthetic-account',
  fromUserId: 'synthetic-peer',
  messageId: '9223372036854775807',
  seq: '9223372036854775806',
  messageType: 1,
  items: [{ type: 1, text: 'synthetic message' }],
  receivedAt: 1
}
function fixture(handler: (method: string, params: unknown) => unknown) {
  const rpc = {
    call: vi.fn(),
    callAsync: vi.fn(async (method: string, params: unknown) => {
      if (method === 'runtime.describe')
        return {
          protocol: 1,
          application: 'wechat',
          implementation: 'go',
          platform: 'darwin',
          arch: 'arm64',
          version: '0.1.0-dev.7',
          methods: [
            'ilink.poll',
            'ilink.ack',
            'ilink.sendPlainText',
            'ilink.sendMediaFile',
            'ilink.loginPoll',
            'ilink.accounts'
          ]
        }
      return handler(method, params)
    })
  }
  return { rpc, client: new WechatILinkClient(rpc as DatabaseRpcTransport) }
}
describe('iLink protocol consumer', () => {
  it('sends an explicit file request once, validates paths and retains ambiguous failure', async () => {
    const { client, rpc } = fixture(() => {
      throw new RuntimeRpcError('ILINK_HTTP_FAILED', true)
    })
    const request = {
      root: resolve('synthetic-media'),
      path: 'synthetic.bin',
      to: 'synthetic-peer',
      kind: 'file' as const
    }
    await expect(
      client.sendMediaFile(owner, { ...request, path: '../escape' })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(rpc.callAsync).not.toHaveBeenCalled()
    await expect(client.sendMediaFile(owner, request)).rejects.toMatchObject({
      resultUnknown: true
    })
    expect(
      rpc.callAsync.mock.calls.filter(([method]) => method === 'ilink.sendMediaFile')
    ).toHaveLength(1)
    expect(rpc.callAsync).toHaveBeenCalledWith(
      'ilink.sendMediaFile',
      { ownerId: owner, ...request },
      expect.objectContaining({ sideEffect: true })
    )
  })
  it('does not accept private CDN keys or unsupported media result types', async () => {
    const { client } = fixture(() => ({
      clientId: 'yuyu-' + 'a'.repeat(32),
      itemType: 4,
      aesKey: 'must-stay-native'
    }))
    await expect(
      client.sendMediaFile(owner, {
        root: resolve('synthetic-media'),
        path: 'synthetic.bin',
        to: 'peer',
        kind: 'file'
      })
    ).rejects.toMatchObject({ code: 'INVALID_RUNTIME_RESPONSE' })
  })

  it('acknowledges only after successful delivery and preserves 64-bit identifiers', async () => {
    const order: string[] = []
    const { client } = fixture((method) => {
      order.push(method)
      return method === 'ilink.poll' ? { batchId, messages: [message] } : true
    })
    await client.consumeOnce(owner, async (messages) => {
      expect(messages[0].seq).toBe('9223372036854775806')
      order.push('delivered')
    })
    expect(order).toEqual(['ilink.poll', 'delivered', 'ilink.ack'])
  })
  it('does not acknowledge failed delivery or cancellation after delivery', async () => {
    const { client, rpc } = fixture(() => ({ batchId, messages: [message] }))
    await expect(
      client.consumeOnce(owner, async () => {
        throw new Error('delivery failed')
      })
    ).rejects.toThrow('delivery failed')
    const abort = new AbortController()
    await expect(
      client.consumeOnce(owner, async () => abort.abort(), abort.signal)
    ).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(rpc.callAsync.mock.calls.filter(([method]) => method === 'ilink.ack')).toHaveLength(0)
  })
  it('preserves an ambiguous send error without retrying', async () => {
    const { client, rpc } = fixture(() => {
      throw new RuntimeRpcError('ILINK_HTTP_FAILED', true)
    })
    await expect(client.sendPlainText(owner, 'synthetic-peer', 'hello')).rejects.toMatchObject({
      resultUnknown: true
    })
    expect(
      rpc.callAsync.mock.calls.filter(([method]) => method === 'ilink.sendPlainText')
    ).toHaveLength(1)
  })
  it('rejects token leakage or malformed results at the application boundary', async () => {
    const { client } = fixture(() => [
      {
        accountId: 'synthetic-account',
        wechatUserId: 'synthetic-user',
        bot_token: 'must-not-cross'
      }
    ])
    await expect(client.accounts('/synthetic/accounts')).rejects.toMatchObject({
      code: 'INVALID_RUNTIME_RESPONSE'
    })
  })
})

describe('iLink media and delayed reply contract', () => {
  const methods = [
    'ilink.sendMediaURL',
    'ilink.sendPlainText',
    'ilink.context',
    'ilink.poll',
    'ilink.downloadMedia'
  ]
  function native(handler: (method: string, params: any) => unknown) {
    const rpc = {
      call: vi.fn(handler),
      callAsync: vi.fn(async (method: string, params: any) =>
        method === 'runtime.describe'
          ? {
              protocol: 1,
              application: 'wechat',
              implementation: 'go',
              platform: 'darwin',
              arch: 'arm64',
              version: 'fixture',
              methods
            }
          : handler(method, params)
      )
    }
    return { rpc, client: new WechatILinkClient(rpc as DatabaseRpcTransport) }
  }
  it('preserves the original message context and never retries an uncertain remote send', async () => {
    const f = native(() => {
      throw new RuntimeRpcError('ILINK_HTTP_FAILED', true)
    })
    await expect(
      f.client.sendPlainText(owner, 'peer', 'reply', undefined, 'original-context')
    ).rejects.toMatchObject({ resultUnknown: true })
    expect(f.rpc.callAsync).toHaveBeenCalledWith(
      'ilink.sendPlainText',
      { ownerId: owner, to: 'peer', text: 'reply', contextToken: 'original-context' },
      expect.objectContaining({ sideEffect: true })
    )
    await expect(
      f.client.sendMediaURL(owner, {
        url: 'https://example.invalid/file.bin',
        to: 'peer',
        kind: 'file',
        contextToken: 'original-context'
      })
    ).rejects.toMatchObject({ resultUnknown: true })
    expect(f.rpc.callAsync.mock.calls.filter(([m]) => m === 'ilink.sendMediaURL')).toHaveLength(1)
  })
  it('accepts only opaque media references and strict download evidence', async () => {
    const ref = { id: 'c'.repeat(32), kind: 'file', name: 'synthetic.bin', size: 7 }
    const f = native((method) =>
      method === 'ilink.poll'
        ? { batchId, messages: [{ ...message, items: [{ type: 4, media: ref }] }] }
        : { size: 7, sha256: 'd'.repeat(64) }
    )
    expect((await f.client.poll(owner)).messages[0].items[0].media).toEqual(ref)
    expect(
      await f.client.downloadMedia(owner, ref.id, resolve('synthetic-media'), 'received.bin')
    ).toEqual({ size: 7, sha256: 'd'.repeat(64) })
    const bad = native(() => ({
      batchId,
      messages: [{ ...message, items: [{ type: 4, media: { ...ref, aesKey: 'secret' } }] }]
    }))
    await expect(bad.client.poll(owner)).rejects.toMatchObject({ code: 'INVALID_RUNTIME_RESPONSE' })
    const count = f.rpc.callAsync.mock.calls.length
    await expect(
      f.client.downloadMedia(owner, ref.id, resolve('synthetic-media'), '../escape')
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(f.rpc.callAsync).toHaveBeenCalledTimes(count)
  })
  it('uses a native context lookup only after capability negotiation', async () => {
    const f = native((method) =>
      method === 'ilink.poll' ? { batchId, messages: [] } : 'persisted-context'
    )
    expect(() => f.client.resolveContextToken(owner, 'peer')).toThrow('CAPABILITY_UNAVAILABLE')
    await f.client.poll(owner)
    expect(f.client.resolveContextToken(owner, 'peer')).toBe('persisted-context')
    expect(f.rpc.call).toHaveBeenCalledWith('ilink.context', { ownerId: owner, to: 'peer' })
  })
})
