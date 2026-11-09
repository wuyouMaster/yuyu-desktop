import { describe, expect, it, vi } from 'vitest'
import { TelegramMacOSClient } from '../../src/main/runtime-rpc/telegram-macos-client'
import { TelegramMacOSService } from '../../src/main/services/telegram-macos-service'
import { UnifiedDataSourceService } from '../../src/main/services/unified-data-source-service'

vi.mock('electron', () => ({ app: { isPackaged: false }, net: {} }))
vi.mock('../../src/main/runtime-rpc/application-runtimes', () => ({
  createApplicationRuntime: vi.fn()
}))
vi.mock('../../src/main/runtime-paths', () => ({
  managedResourcePath: () => '/synthetic/runtime/helper'
}))
vi.mock('../../src/main/services/chat-service', () => ({ isReady: () => false }))
vi.mock('../../src/main/services/personal-wechat-send-service', () => ({
  personalWechatSendService: {}
}))

const candidateId = 'telegram-macos-local:' + 'a'.repeat(24)
const description = {
  application: 'telegram',
  protocol: 1,
  version: '0.1.0-dev.5',
  methods: ['client.inspect', 'macos.conversations', 'macos.messages'],
  clientTypes: ['telegram-macos'],
  platform: 'darwin',
  arch: 'arm64'
}
const page = {
  clientType: 'telegram-macos',
  candidateId,
  scope: 'local-snapshot',
  order: 'peer-id-desc',
  items: [{ peerId: '42', lastTimestamp: 1700000000 }]
}

function fixture() {
  const call = vi.fn().mockImplementation(async (method: string) => {
    if (method === 'runtime.describe') return description
    if (method === 'macos.conversations') return page
    throw new Error('Unexpected native RPC method')
  })
  const close = vi.fn().mockResolvedValue(undefined)
  const desktopRead = vi.fn()
  const desktopSend = vi.fn()
  const native = new TelegramMacOSService({
    platform: 'darwin',
    dataRoot: '/synthetic/native',
    appPath: '/synthetic/Telegram.app',
    createClient: () => new TelegramMacOSClient({ call, close })
  })
  const service = new UnifiedDataSourceService(
    undefined,
    undefined,
    undefined,
    { send: desktopSend } as never,
    { read: desktopRead } as never,
    undefined,
    undefined,
    undefined,
    native
  )
  return { service, call, close, desktopRead, desktopSend }
}

describe('native Telegram unified source lifecycle', () => {
  it('connects only a read provider and leaves every Desktop bridge idle', async () => {
    const { service, close, desktopRead, desktopSend, call } = fixture()
    try {
      const connected = await service.connectTelegramMacOSSource(candidateId)
      expect(connected).toMatchObject({ conversationCount: 1, messageCount: 0 })
      expect(service.registry.list()).toHaveLength(1)
      expect(service.registry.list()[0].send).toBeUndefined()
      expect((await service.listConversations()).items[0]).toMatchObject({ title: '会话 42' })
      expect(desktopRead).not.toHaveBeenCalled()
      expect(desktopSend).not.toHaveBeenCalled()
      expect(call.mock.calls.map(([method]) => method)).toEqual([
        'runtime.describe',
        'macos.conversations',
        'macos.conversations'
      ])
      service.clear()
      expect(service.registry.list()).toHaveLength(0)
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      await service.dispose()
    }
  })

  it('closes a pending connect on disconnect and never registers its late result', async () => {
    const { service, close, call } = fixture()
    let finish!: (value: unknown) => void
    call.mockImplementation(async (method: string) =>
      method === 'runtime.describe'
        ? description
        : new Promise((resolve) => {
            finish = resolve
          })
    )
    const pending = service.connectTelegramMacOSSource(candidateId)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    service.clear()
    expect(close).toHaveBeenCalledTimes(1)
    finish(page)
    await expect(pending).rejects.toThrow('断开')
    expect(service.registry.list()).toHaveLength(0)
    await service.dispose()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('rejects an in-flight read after switching and waits for RPC disposal', async () => {
    const { service, close, call } = fixture()
    await service.connectTelegramMacOSSource(candidateId)
    let finish!: (value: unknown) => void
    call.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = service.listConversations()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await service.dispose()
    finish(page)
    await expect(pending).rejects.toThrow()
    expect(service.registry.list()).toHaveLength(0)
    expect(close).toHaveBeenCalledTimes(1)
    await expect(service.connectTelegramMacOSSource(candidateId)).rejects.toThrow('已关闭')
  })
})
