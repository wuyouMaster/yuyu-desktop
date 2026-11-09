import { describe, expect, it, vi } from 'vitest'
import { TelegramMacOSClient } from '../../src/main/runtime-rpc/telegram-macos-client'
import { TelegramMacOSService } from '../../src/main/services/telegram-macos-service'

vi.mock('../../src/main/runtime-rpc/application-runtimes', () => ({
  createApplicationRuntime: vi.fn(() => {
    throw new Error('No installed runtime in synthetic test')
  })
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

describe('native Telegram source discovery', () => {
  it('does not construct a runtime on an unsupported platform', async () => {
    const createClient = vi.fn()
    const service = new TelegramMacOSService({ platform: 'win32', createClient })
    await expect(service.inspect()).resolves.toMatchObject({
      state: 'unsupported_platform',
      candidates: []
    })
    expect(() => service.createProvider(candidateId)).toThrow('仅支持 macOS')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('deduplicates inspection, owns paths in main and closes its short-lived RPC', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(description)
      .mockResolvedValueOnce({
        clientType: 'telegram-macos',
        state: 'storage_detected',
        candidates: [
          { id: candidateId, format: 'synthetic', databaseBytes: 10, walPresent: false }
        ],
        canReadMessages: false,
        canSend: false
      })
    const close = vi.fn().mockResolvedValue(undefined)
    const createClient = vi.fn(() => new TelegramMacOSClient({ call, close }))
    const service = new TelegramMacOSService({
      platform: 'darwin',
      createClient,
      dataRoot: '/synthetic/native',
      appPath: '/synthetic/Telegram.app'
    })
    const first = service.inspect()
    expect(service.inspect()).toBe(first)
    await expect(first).resolves.toMatchObject({
      state: 'detected',
      candidates: [{ id: candidateId, label: '本地快照 1' }]
    })
    expect(call).toHaveBeenCalledWith('client.inspect', {
      clientType: 'telegram-macos',
      root: '/synthetic/native',
      appPath: '/synthetic/Telegram.app'
    })
    expect(close).toHaveBeenCalledTimes(1)
    expect(createClient).toHaveBeenCalledTimes(1)
  })

  it('reports an old runtime as needing an update and never claims an empty successful source', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const service = new TelegramMacOSService({
      platform: 'darwin',
      createClient: () =>
        new TelegramMacOSClient({
          call: vi.fn().mockResolvedValue({ ...description, methods: ['storage.inspect'] }),
          close
        })
    })
    const result = await service.inspect()
    expect(result.state).toBe('unavailable')
    expect(result.message).toContain('更新 Telegram 运行时')
    expect(result.candidates).toEqual([])
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('validates opaque candidates before creating a runtime', () => {
    const createClient = vi.fn()
    const service = new TelegramMacOSService({ platform: 'darwin', createClient })
    expect(() => service.createProvider('/arbitrary/path')).toThrow()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('cancels discovery without allowing the old result to replace a new inspection', async () => {
    let finish!: (value: unknown) => void
    const close = vi.fn().mockResolvedValue(undefined)
    const call = vi
      .fn()
      .mockResolvedValueOnce(description)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
    const nextCall = vi.fn().mockResolvedValueOnce(description).mockResolvedValueOnce({
      clientType: 'telegram-macos',
      state: 'not_found',
      candidates: [],
      canReadMessages: false,
      canSend: false
    })
    const createClient = vi
      .fn()
      .mockReturnValueOnce(new TelegramMacOSClient({ call, close }))
      .mockReturnValueOnce(
        new TelegramMacOSClient({ call: nextCall, close: vi.fn().mockResolvedValue(undefined) })
      )
    const service = new TelegramMacOSService({ platform: 'darwin', createClient })
    const pending = service.inspect()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await service.cancelInspection()
    const next = service.inspect()
    finish({
      clientType: 'telegram-macos',
      state: 'storage_detected',
      candidates: [],
      canReadMessages: false,
      canSend: false
    })
    await expect(pending).resolves.toMatchObject({ state: 'unavailable' })
    await expect(next).resolves.toMatchObject({ state: 'not_found' })
    expect(close).toHaveBeenCalledTimes(1)
  })
})
