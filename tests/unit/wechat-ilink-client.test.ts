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
