import { describe, expect, it, vi } from 'vitest'
import {
  WechatDatabaseClient,
  type DatabaseRpcTransport
} from '../../src/main/runtime-rpc/wechat-database-client'
import { RuntimeRpcError } from '../../src/shared/runtime-rpc'

const key = '12'.repeat(32)
const opened = {
  sessionId: 'ab'.repeat(24),
  accountRoot: '/fixture/account',
  selfCandidates: ['wxid_fixture'],
  readOnly: true
}
function fixture(
  methods = [
    'database.open',
    'database.close',
    'database.sessions',
    'database.messages',
    'database.count'
  ]
) {
  const call = vi.fn((method: string) => {
    if (method === 'runtime.describe')
      return {
        application: 'wechat',
        protocol: 1,
        implementation: 'go',
        version: '0.1.0-fixture',
        platform: 'darwin',
        arch: 'arm64',
        methods
      }
    if (method === 'database.open') return { ...opened }
    if (method === 'database.close') return true
    return []
  })
  const rpc = {
    call,
    callAsync: vi.fn(async (method: string) => call(method))
  } as unknown as DatabaseRpcTransport & { call: typeof call; callAsync: ReturnType<typeof vi.fn> }
  return { rpc, client: new WechatDatabaseClient(rpc) }
}
describe('public database consumer validation and ownership', () => {
  it('rejects invalid credentials before starting an account', () => {
    const { rpc, client } = fixture()
    expect(() => client.open('/fixture/account', 'short')).toThrow('INVALID_ARGUMENT')
    expect(rpc.call).not.toHaveBeenCalled()
  })
  it('does not invent capabilities absent from the runtime', async () => {
    const { client } = fixture(['database.open'])
    client.open('/fixture/account', key)
    await expect(client.countAsync({ conversation: 'fixture' })).rejects.toThrow(
      'CAPABILITY_UNAVAILABLE'
    )
  })
  it('rejects malformed rows and malformed count results', async () => {
    const { rpc, client } = fixture()
    client.open('/fixture/account', key)
    rpc.call.mockReturnValueOnce([{ username: 'fixture', nickname: 123 }] as never)
    expect(() => client.sessions()).toThrow('INVALID_RUNTIME_RESPONSE')
    rpc.callAsync.mockResolvedValueOnce({ count: -1, maxLocalId: 0 })
    await expect(client.countAsync({ conversation: 'fixture' })).rejects.toThrow(
      'INVALID_RUNTIME_RESPONSE'
    )
  })
  it('shares the account token and rejects a second open', async () => {
    const { rpc, client } = fixture()
    const result = client.open('/fixture/account', key)
    result.sessionId = 'cd'.repeat(24)
    client.sessions(false)
    await client.sessionsAsync(false)
    expect(rpc.call).toHaveBeenCalledWith('database.sessions', {
      hydrate: false,
      sessionId: opened.sessionId
    })
    expect(rpc.callAsync).toHaveBeenCalledWith(
      'database.sessions',
      { hydrate: false, sessionId: opened.sessionId },
      undefined
    )
    expect(() => client.open('/fixture/account', key)).toThrow('DATABASE_ALREADY_OPEN')
  })
  it('retains closing state after timeout and permits confirmed cleanup retry', async () => {
    const { rpc, client } = fixture()
    client.open('/fixture/account', key)
    rpc.callAsync.mockRejectedValueOnce(new RuntimeRpcError('DEADLINE_EXCEEDED'))
    expect(await client.closeAsync(10)).toBe(false)
    expect(() => client.sessions()).toThrow('DATABASE_CLOSED')
    rpc.callAsync.mockRejectedValueOnce(new RuntimeRpcError('SESSION_NOT_FOUND'))
    expect(await client.closeAsync()).toBe(true)
    expect(await client.closeAsync()).toBe(true)
  })
  it('cancels pending monitor initialization when its account closes', async () => {
    const { rpc, client } = fixture(['database.open', 'database.close', 'database.observe'])
    client.open('/fixture/account', key)
    let complete!: (value: string) => void
    rpc.callAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    const changed = vi.fn()
    const started = client.startMonitor(changed, vi.fn())
    const signal = rpc.callAsync.mock.calls[0][2].signal as AbortSignal
    expect(await client.closeAsync()).toBe(true)
    expect(signal.aborted).toBe(true)
    complete('a'.repeat(64))
    expect(await started).toBe(false)
    expect(changed).not.toHaveBeenCalled()
  })
  it('coalesces simultaneous close calls without freeing twice', async () => {
    const { rpc, client } = fixture()
    client.open('/fixture/account', key)
    expect(await Promise.all([client.closeAsync(), client.closeAsync()])).toEqual([true, true])
    expect(rpc.callAsync).toHaveBeenCalledTimes(1)
    client.close()
  })
})
