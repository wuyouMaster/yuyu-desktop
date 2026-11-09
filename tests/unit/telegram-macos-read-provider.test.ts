import { describe, expect, it, vi } from 'vitest'
import { TelegramMacOSReadProvider } from '../../src/main/services/telegram-macos-read-provider'
import { serializeEntityId } from '../../src/shared/entity-id'

const candidateId = 'telegram-macos-local:' + 'a'.repeat(24)
const key = (digit: string) => digit.repeat(40)
const message = {
  key: key('b'),
  peerId: '42',
  namespace: 0,
  id: 2,
  timestamp: 1700000000,
  text: 'synthetic message',
  attributeCount: 0,
  mediaCount: 0
}
const id = (native: string, account = candidateId) =>
  serializeEntityId({ source: 'telegram', account, native })
const conversationId = id('peer/42')
function fixture() {
  const client = {
    conversations: vi
      .fn()
      .mockResolvedValue({
        clientType: 'telegram-macos',
        candidateId,
        scope: 'local-snapshot',
        order: 'peer-id-desc',
        items: [{ peerId: '42', lastTimestamp: 1700000000 }],
        nextPeer: '42'
      }),
    messages: vi
      .fn()
      .mockResolvedValue({
        clientType: 'telegram-macos',
        candidateId,
        scope: 'local-snapshot',
        order: 'postbox-key-desc',
        items: [message],
        nextKey: message.key,
        mediaDecoded: false
      }),
    close: vi.fn().mockResolvedValue(undefined)
  }
  const provider = new TelegramMacOSReadProvider(
    { root: '/synthetic/native', appPath: '/synthetic/Telegram.app', candidateId },
    client
  )
  return { client, provider }
}

describe('native Telegram on-demand read provider', () => {
  it('keeps unknown names/types honest and advances a scoped conversation cursor', async () => {
    const { client, provider } = fixture()
    const first = await provider.listConversations({ limit: 2 })
    expect(first.items[0]).toMatchObject({
      title: '会话 42',
      conversationKind: 'unknown',
      id: conversationId
    })
    await provider.listConversations({ cursor: first.nextCursor, limit: 2 })
    expect(client.conversations.mock.calls[1][0]).toMatchObject({ beforePeer: '42', limit: 2 })
    expect(provider.capabilities).toMatchObject({
      canSend: false,
      supportsRealtime: false,
      supportsLazyAssets: false
    })
  })

  it('reads a bounded page for only the requested peer and preserves caption/media metadata', async () => {
    const { client, provider } = fixture()
    const media = [{ kind: 'photo', metadataState: 'decoded', width: 50, height: 30 }]
    client.messages.mockResolvedValueOnce({
      items: [{ ...message, mediaCount: 1, media }],
      nextKey: message.key
    })
    const page = await provider.listMessages({ conversationId, limit: 200 })
    expect(client.messages.mock.calls[0][0]).toMatchObject({ peerId: '42', limit: 50 })
    expect(page.items[0]).toMatchObject({
      direction: 'unknown',
      content: { type: 'text', text: message.text },
      extensions: { telegramMacOS: { mediaAvailable: false, media } }
    })
    expect(JSON.stringify(page.items)).not.toContain('assetId')
    await provider.listMessages({ conversationId, cursor: page.nextCursor })
    expect(client.messages.mock.calls[1][0]).toMatchObject({ beforeKey: message.key, peerId: '42' })
  })

  it('shows media-only messages as unavailable metadata without playable assets', async () => {
    const { client, provider } = fixture()
    client.messages.mockResolvedValueOnce({
      items: [
        {
          ...message,
          text: '',
          mediaCount: 1,
          media: [{ kind: 'video', metadataState: 'decoded', filename: 'synthetic.mp4' }]
        }
      ]
    })
    const page = await provider.listMessages({ conversationId })
    expect(page.items[0].content).toMatchObject({
      type: 'unknown',
      platformType: 'telegram-macos-media',
      raw: { available: false }
    })
    await expect(provider.resolveAsset(id('asset/file'))).rejects.toThrow('媒体元数据')
    await expect(provider.listParticipants(provider.accountId)).rejects.toThrow('联系人目录')
    await expect(provider.listMemberships(conversationId)).rejects.toThrow('成员目录')
    await expect(
      provider.listMessagesAround({ conversationId, messageId: page.items[0].id })
    ).rejects.toThrow('分页读取')
  })

  it('rejects another account or peer cursor without reading any of its messages', async () => {
    const { client, provider } = fixture()
    await expect(
      provider.listMessages({ conversationId: id('peer/42', 'another-account') })
    ).rejects.toThrow('当前')
    const page = await provider.listMessages({ conversationId })
    const reads = client.messages.mock.calls.length
    await expect(
      provider.listMessages({ conversationId: id('peer/43'), cursor: page.nextCursor })
    ).rejects.toThrow('分页游标')
    await expect(provider.listConversations({ cursor: page.nextCursor })).rejects.toThrow(
      '分页游标'
    )
    expect(client.messages).toHaveBeenCalledTimes(reads)
  })

  it('retains next cursor when time filtering removes a full page', async () => {
    const { provider } = fixture()
    const page = await provider.listMessages({ conversationId, startTime: 1800000000000 })
    expect(page.items).toEqual([])
    expect(page.nextCursor).toBeTypeOf('string')
  })

  it('discards pending reads and rejects future reads after disposal', async () => {
    const { client, provider } = fixture()
    let finish!: (value: unknown) => void
    client.messages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = provider.listMessages({ conversationId })
    await Promise.all([provider.dispose(), provider.dispose()])
    finish({ items: [message] })
    await expect(pending).rejects.toThrow('断开')
    await expect(provider.listConversations()).rejects.toThrow('断开')
    expect(client.close).toHaveBeenCalledTimes(1)
    expect(provider.health()).toMatchObject({ available: false, state: 'offline' })
  })
})
