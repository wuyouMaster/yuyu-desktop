import { describe, expect, it, vi } from 'vitest'
import { TelegramMacOSClient } from '../../src/main/runtime-rpc/telegram-macos-client'
import { TelegramStorageClient } from '../../src/main/runtime-rpc/telegram-storage-client'
import { telegramMacOSPeerSchema } from '../../src/shared/telegram-macos-protocol'

const candidateId = 'telegram-macos-local:' + 'a'.repeat(24)
const options = {
  root: '/synthetic/native',
  appPath: '/synthetic/Telegram.app',
  candidateId,
  limit: 2
}
const description = {
  application: 'telegram',
  protocol: 1,
  version: '0.1.0-dev.5',
  methods: ['client.inspect', 'macos.conversations', 'macos.messages', 'storage.inspect'],
  clientTypes: ['telegram-desktop', 'telegram-macos'],
  platform: 'darwin',
  arch: 'arm64'
}
const inspection = {
  clientType: 'telegram-macos',
  state: 'storage_detected',
  candidates: [{ id: candidateId, format: 'synthetic', databaseBytes: 1024, walPresent: true }],
  canReadMessages: false,
  canSend: false
}
const key = (digit: string) => digit.repeat(40)
const message = {
  key: key('b'),
  peerId: '42',
  namespace: 0,
  id: 2,
  timestamp: 1700000000,
  text: 'synthetic text',
  attributeCount: 0,
  mediaCount: 0
}
const messages = {
  clientType: 'telegram-macos',
  candidateId,
  scope: 'local-snapshot',
  order: 'postbox-key-desc',
  items: [message],
  mediaDecoded: false,
  nextKey: message.key
}
const conversations = {
  clientType: 'telegram-macos',
  candidateId,
  scope: 'local-snapshot',
  order: 'peer-id-desc',
  items: [{ peerId: '42', lastTimestamp: 1700000000 }],
  nextPeer: '42'
}

describe('native Telegram public protocol consumer', () => {
  it('keeps Desktop compatible with optional client types and older descriptions', async () => {
    for (const runtime of [description, { ...description, clientTypes: undefined }]) {
      const call = vi
        .fn()
        .mockResolvedValueOnce(runtime)
        .mockResolvedValueOnce({ storageVersion: 1, accounts: [] })
      const client = new TelegramStorageClient({ call, close: vi.fn() })
      await expect(client.inspect('/synthetic/tdata')).resolves.toEqual({
        storageVersion: 1,
        accounts: []
      })
    }
  })

  it('requires advertised native capabilities before any local data request', async () => {
    for (const runtime of [
      { ...description, clientTypes: undefined },
      { ...description, methods: ['client.inspect', 'macos.messages'] }
    ]) {
      const call = vi.fn().mockResolvedValue(runtime)
      const client = new TelegramMacOSClient({ call, close: vi.fn() })
      await expect(client.inspect(options.root, options.appPath)).rejects.toMatchObject({
        code: 'CAPABILITY_UNAVAILABLE'
      })
      expect(call).toHaveBeenCalledTimes(1)
    }
  })

  it('negotiates once and reads bounded, scoped pages without Desktop helper methods', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(description)
      .mockResolvedValueOnce(inspection)
      .mockResolvedValueOnce(conversations)
      .mockResolvedValueOnce(messages)
    const client = new TelegramMacOSClient({ call, close: vi.fn() })
    expect(await client.inspect(options.root, options.appPath)).toEqual(inspection)
    expect(await client.conversations(options)).toEqual(conversations)
    expect(await client.messages({ ...options, peerId: '42' })).toEqual(messages)
    expect(call.mock.calls.map(([method]) => method)).toEqual([
      'runtime.describe',
      'client.inspect',
      'macos.conversations',
      'macos.messages'
    ])
    expect(call.mock.calls[3][1]).toEqual({ ...options, peerId: '42' })
  })

  it('rejects a wrong candidate, cross-peer messages, unordered keys and private response fields', async () => {
    for (const page of [
      { ...messages, candidateId: 'telegram-macos-local:' + 'b'.repeat(24) },
      { ...messages, items: [{ ...message, peerId: '43' }] },
      { ...messages, items: [{ ...message, key: key('a') }, message] },
      {
        ...messages,
        items: [
          {
            ...message,
            media: [{ kind: 'file', metadataState: 'decoded', filePath: '/private/data' }]
          }
        ]
      },
      { ...messages, nextKey: key('a') }
    ]) {
      const client = new TelegramMacOSClient({
        call: vi.fn().mockResolvedValueOnce(description).mockResolvedValueOnce(page),
        close: vi.fn()
      })
      await expect(client.messages({ ...options, peerId: '42' })).rejects.toMatchObject({
        code: 'INVALID_RUNTIME_RESPONSE'
      })
    }
  })

  it('rejects invalid int64 peers and arguments before starting the host', async () => {
    for (const peer of ['-0', '01', '9223372036854775808', '-9223372036854775809', '1.5'])
      expect(telegramMacOSPeerSchema.safeParse(peer).success).toBe(false)
    expect(telegramMacOSPeerSchema.parse('-9223372036854775808')).toBe('-9223372036854775808')
    const call = vi.fn()
    const client = new TelegramMacOSClient({ call, close: vi.fn() })
    await expect(client.messages({ ...options, limit: 51 })).rejects.toThrow()
    expect(call).not.toHaveBeenCalled()
  })

  it('rejects a repeated conversation cursor and duplicate rows', async () => {
    for (const page of [
      conversations,
      { ...conversations, items: [conversations.items[0], conversations.items[0]] }
    ]) {
      const client = new TelegramMacOSClient({
        call: vi.fn().mockResolvedValueOnce(description).mockResolvedValueOnce(page),
        close: vi.fn()
      })
      await expect(client.conversations({ ...options, beforePeer: '42' })).rejects.toMatchObject({
        code: 'INVALID_RUNTIME_RESPONSE'
      })
    }
  })

  it('uses serialized peer order across signed peers and rejects order/boundary violations', async () => {
    const page = {
      ...conversations,
      items: [
        { peerId: '-1', lastTimestamp: 1 },
        { peerId: '42', lastTimestamp: 2 }
      ]
    }
    const client = new TelegramMacOSClient({
      call: vi.fn().mockResolvedValueOnce(description).mockResolvedValueOnce(page),
      close: vi.fn()
    })
    await expect(client.conversations(options)).resolves.toEqual(page)
    for (const [items, beforePeer] of [
      [page.items.slice().reverse(), undefined],
      [page.items, '42']
    ] as const) {
      const invalid = new TelegramMacOSClient({
        call: vi
          .fn()
          .mockResolvedValueOnce(description)
          .mockResolvedValueOnce({ ...page, items, nextPeer: items.at(-1)?.peerId }),
        close: vi.fn()
      })
      await expect(invalid.conversations({ ...options, beforePeer })).rejects.toMatchObject({
        code: 'INVALID_RUNTIME_RESPONSE'
      })
    }
  })

  it('preserves zero media metadata and refuses inconsistent counts or playable media claims', async () => {
    const media = { kind: 'file', metadataState: 'decoded', byteLength: 0, durationSeconds: 0 }
    const accepted = { ...messages, items: [{ ...message, mediaCount: 1, media: [media] }] }
    const client = new TelegramMacOSClient({
      call: vi.fn().mockResolvedValueOnce(description).mockResolvedValueOnce(accepted),
      close: vi.fn()
    })
    await expect(client.messages(options)).resolves.toEqual(accepted)
    for (const page of [
      { ...accepted, mediaDecoded: true },
      { ...accepted, items: [{ ...message, mediaCount: 0, media: [media] }] },
      {
        ...accepted,
        items: [{ ...message, mediaCount: 1, media: [{ ...media, filename: '界'.repeat(342) }] }]
      },
      {
        ...accepted,
        items: [
          {
            ...message,
            mediaCount: 1,
            media: [{ ...media, byteLength: Number.MAX_SAFE_INTEGER + 1 }]
          }
        ]
      }
    ]) {
      const invalid = new TelegramMacOSClient({
        call: vi.fn().mockResolvedValueOnce(description).mockResolvedValueOnce(page),
        close: vi.fn()
      })
      await expect(invalid.messages(options)).rejects.toMatchObject({
        code: 'INVALID_RUNTIME_RESPONSE'
      })
    }
  })

  it('closes once and discards a pending result after disconnect', async () => {
    let finish!: (value: unknown) => void
    const call = vi
      .fn()
      .mockResolvedValueOnce(description)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
    const close = vi.fn().mockResolvedValue(undefined)
    const client = new TelegramMacOSClient({ call, close })
    const pending = client.messages(options)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await Promise.all([client.close(), client.close()])
    finish(messages)
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CLOSED' })
    await expect(client.conversations(options)).rejects.toMatchObject({ code: 'SESSION_CLOSED' })
    expect(close).toHaveBeenCalledTimes(1)
  })
})
