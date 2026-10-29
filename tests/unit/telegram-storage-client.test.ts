import { describe, expect, it, vi } from 'vitest'
import { TelegramStorageClient } from '../../src/main/runtime-rpc/telegram-storage-client'
import type { RuntimeRpcClient } from '../../src/main/runtime-rpc/client'
const description = {
  application: 'telegram',
  protocol: 1,
  version: '0.1.0-dev.3',
  methods: ['storage.inspect', 'cache.open', 'cache.resolve', 'cache.close'],
  platform: 'darwin',
  arch: 'arm64'
}
const options = { slot: 0, account: 'telegram-local:' + 'a'.repeat(24), dataRoot: '/fixture/tdata' }

describe('public Telegram storage consumer', () => {
  it('rejects incompatible capabilities before reading account data', async () => {
    const call = vi.fn().mockResolvedValue({ ...description, methods: [] })
    const client = new TelegramStorageClient({ call } as unknown as RuntimeRpcClient)
    await expect(client.inspect('/fixture/tdata')).rejects.toMatchObject({
      code: 'INCOMPATIBLE_RUNTIME'
    })
    expect(call).toHaveBeenCalledTimes(1)
  })
  it('preserves empty accounts and rejects malformed success responses', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(description)
      .mockResolvedValueOnce({ storageVersion: 7002005, accounts: [] })
      .mockResolvedValueOnce({ accounts: [], privateKey: 'fixture' })
    const client = new TelegramStorageClient({ call } as unknown as RuntimeRpcClient)
    expect(await client.inspect('/fixture/tdata')).toEqual({
      storageVersion: 7002005,
      accounts: []
    })
    await expect(client.inspect('/fixture/tdata')).rejects.toMatchObject({
      code: 'INVALID_RUNTIME_RESPONSE'
    })
  })
  it('owns cache sessions, preserves missing-media results and disposes only once', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(description)
      .mockResolvedValueOnce({ session: 'a0a0a0a0-b1b1-42c2-83d3-e4e4e4e4e4e4' })
      .mockResolvedValue(null)
    const client = new TelegramStorageClient({ call } as unknown as RuntimeRpcClient)
    const cache = await client.openCache(options)
    expect(await cache.resolve([], { id: 'fixture', kind: 'photo' })).toBeUndefined()
    await Promise.all([cache.dispose(), cache.dispose()])
    await expect(cache.resolve([], { id: 'fixture', kind: 'photo' })).rejects.toMatchObject({
      code: 'SESSION_CLOSED'
    })
    expect(call.mock.calls.filter(([method]) => method === 'cache.close')).toHaveLength(1)
  })
})
