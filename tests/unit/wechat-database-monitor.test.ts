import { afterEach, describe, expect, it, vi } from 'vitest'
import { WechatDatabaseMonitor } from '../../src/main/runtime-rpc/wechat-database-monitor'

afterEach(() => vi.useRealTimers())
describe('account-bound database observation lifecycle', () => {
  it('emits only on committed token changes and keeps one poll in flight', async () => {
    vi.useFakeTimers()
    const observeAsync = vi.fn().mockResolvedValue('a')
    const monitor = new WechatDatabaseMonitor({ observeAsync })
    const changed = vi.fn(),
      failed = vi.fn()
    expect(await monitor.start(changed, failed)).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(changed).not.toHaveBeenCalled()
    let complete!: (value: string) => void
    observeAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    await vi.advanceTimersByTimeAsync(5000)
    expect(observeAsync).toHaveBeenCalledTimes(3)
    complete('b')
    await vi.advanceTimersByTimeAsync(0)
    expect(changed).toHaveBeenCalledExactlyOnceWith('update', '{"action":"update"}')
    monitor.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(observeAsync).toHaveBeenCalledTimes(3)
    expect(failed).not.toHaveBeenCalled()
  })
  it('aborts and suppresses an in-flight response after stop or source switch', async () => {
    vi.useFakeTimers()
    let complete!: (value: string) => void
    const observeAsync = vi
      .fn()
      .mockResolvedValueOnce('a')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve
          })
      )
      .mockResolvedValue('new-source')
    const monitor = new WechatDatabaseMonitor({ observeAsync })
    const changed = vi.fn(),
      failed = vi.fn()
    await monitor.start(changed, failed)
    await vi.advanceTimersByTimeAsync(1000)
    const signal = observeAsync.mock.calls[1][0].signal
    monitor.stop()
    expect(signal.aborted).toBe(true)
    await monitor.start(changed, failed)
    complete('stale-source')
    await vi.advanceTimersByTimeAsync(0)
    expect(changed).not.toHaveBeenCalled()
    monitor.stop()
  })
  it('reports backend failure and does not silently restart or report success', async () => {
    vi.useFakeTimers()
    const error = new Error('DATABASE_SOURCE_REPLACED')
    const observeAsync = vi.fn().mockResolvedValueOnce('a').mockRejectedValue(error)
    const monitor = new WechatDatabaseMonitor({ observeAsync })
    const failed = vi.fn()
    await monitor.start(vi.fn(), failed)
    await vi.advanceTimersByTimeAsync(5000)
    expect(failed).toHaveBeenCalledExactlyOnceWith(error)
    expect(observeAsync).toHaveBeenCalledTimes(2)
  })
  it('rejects failed initialization instead of advertising a working monitor', async () => {
    const monitor = new WechatDatabaseMonitor({
      observeAsync: vi.fn().mockRejectedValue(new Error('CAPABILITY_UNAVAILABLE'))
    })
    await expect(monitor.start(vi.fn(), vi.fn())).rejects.toThrow('CAPABILITY_UNAVAILABLE')
  })
})
