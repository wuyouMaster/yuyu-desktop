import { describe, expect, it, vi } from 'vitest'
import { RuntimeWechatConnectorService } from '../../src/main/runtime-rpc/wechat-connector-service'
import { WechatILinkClient } from '../../src/main/runtime-rpc/wechat-ilink-client'
import { RuntimeRpcError } from '../../src/shared/runtime-rpc'
import type { DatabaseRpcTransport } from '../../src/main/runtime-rpc/wechat-database-client'
const owner = 'a'.repeat(48)
const batchId = 'b'.repeat(32)
const sample = {
  accountId: 'fixture-account',
  fromUserId: 'fixture-peer',
  messageId: '9007199254740993',
  messageType: 1,
  items: [{ type: 1, text: '合成消息' }],
  receivedAt: 1
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
const methods = [
  'ilink.open',
  'ilink.close',
  'ilink.poll',
  'ilink.ack',
  'ilink.notify',
  'ilink.typingBegin',
  'ilink.typingEnd',
  'ilink.sendPlainText',
  'ilink.sendMediaFile',
  'ilink.loginBegin',
  'ilink.loginPoll',
  'ilink.accounts'
]
function harness(
  handler: (method: string, params: any, options: any) => unknown | Promise<unknown>,
  deliver = vi.fn(async () => {}),
  sleep = vi.fn(async (_ms: number, _signal: AbortSignal) => {})
) {
  const calls: string[] = []
  const rpc = {
    call: vi.fn(),
    callAsync: vi.fn(async (method: string, params: any, options: any) => {
      calls.push(method)
      if (method === 'runtime.describe')
        return {
          protocol: 1,
          application: 'wechat',
          implementation: 'go',
          platform: 'darwin',
          arch: 'arm64',
          version: 'fixture',
          methods
        }
      if (method === 'ilink.open') return { ownerId: owner }
      if (method === 'ilink.close' || method === 'ilink.notify') return true
      return handler(method, params, options)
    })
  }
  const client = new WechatILinkClient(rpc as DatabaseRpcTransport)
  const close = vi.fn(async () => {})
  const phases = vi.fn()
  const diagnostics = vi.fn()
  const loginEvents = vi.fn()
  const service = new RuntimeWechatConnectorService(
    '/synthetic/credentials',
    async () => ({ client, close }),
    {
      onMessages: deliver,
      onPhaseChange: phases,
      onDiagnostic: diagnostics,
      onLoginEvent: loginEvents
    },
    sleep
  )
  return { service, rpc, calls, close, phases, diagnostics, loginEvents }
}
function blocked(signal: AbortSignal) {
  return new Promise<never>((_r, reject) => {
    if (signal.aborted) reject(new RuntimeRpcError('CANCELLED'))
    else
      signal.addEventListener('abort', () => reject(new RuntimeRpcError('CANCELLED')), {
        once: true
      })
  })
}
async function until(check: () => boolean) {
  await vi.waitFor(() => expect(check()).toBe(true), { timeout: 1000, interval: 1 })
}
describe('native connector orchestration', () => {
  it('redelivers failed batches, acknowledges after acceptance and cancels a live poll on stop', async () => {
    const accepted = deferred<void>()
    let attempt = 0
    let polls = 0
    const deliver = vi.fn(async () => {
      if (++attempt === 1) throw new Error('fixture private message')
      accepted.resolve()
    })
    const h = harness((method, _params, options) => {
      if (method === 'ilink.poll')
        return ++polls <= 2 ? { batchId, messages: [sample] } : blocked(options.signal)
      if (method === 'ilink.ack') return true
      throw new Error(method)
    }, deliver)
    await h.service.start('fixture-account')
    await accepted.promise
    await until(() => h.calls.filter((v) => v === 'ilink.poll').length === 3)
    expect(deliver).toHaveBeenCalledTimes(2)
    expect(h.calls.filter((v) => v === 'ilink.ack')).toHaveLength(1)
    expect(h.diagnostics.mock.calls.flat()).not.toContain('fixture private message')
    expect(h.diagnostics.mock.calls.flat()).toContain('ILINK_DELIVERY_FAILED')
    await h.service.stop()
    expect(h.service.getPhase()).toBe('stopped')
    expect(h.close).toHaveBeenCalledTimes(1)
    expect(h.calls.slice(-2)).toEqual(['ilink.notify', 'ilink.close'])
  })
  it('does not acknowledge a batch when stopping during delivery', async () => {
    const delivering = deferred<void>()
    const release = deferred<void>()
    const h = harness(
      () => ({ batchId, messages: [sample] }),
      vi.fn(async () => {
        delivering.resolve()
        await release.promise
      })
    )
    await h.service.start('fixture-account')
    await delivering.promise
    const stopping = h.service.stop()
    release.resolve()
    await stopping
    expect(h.calls).not.toContain('ilink.ack')
  })
  it('stale token stops retries, reports the phase and refuses sending', async () => {
    const h = harness(() => {
      throw new RuntimeRpcError('ILINK_STALE_TOKEN')
    })
    await h.service.start('fixture-account')
    await until(() => h.service.getPhase() === 'stale_token')
    expect(h.calls.filter((v) => v === 'ilink.poll')).toHaveLength(1)
    expect(() => h.service.sendText({ to: 'fixture-peer', text: 'fixture' })).toThrow(
      'ILINK_STALE_TOKEN'
    )
    await h.service.stop()
  })
  it('preserves unknown send outcomes, rejects other accounts and stops typing once', async () => {
    const h = harness((method, _p, o) => {
      if (method === 'ilink.poll') return blocked(o.signal)
      if (method === 'ilink.sendPlainText') throw new RuntimeRpcError('ILINK_HTTP_FAILED', true)
      if (method === 'ilink.typingBegin') return { leaseId: 'c'.repeat(32) }
      if (method === 'ilink.typingEnd') return true
      throw new Error(method)
    })
    await h.service.start('fixture-account')
    expect(() =>
      h.service.sendText({ accountId: 'foreign', to: 'fixture-peer', text: 'fixture' })
    ).toThrow('ILINK_ACCOUNT_MISMATCH')
    await expect(h.service.sendText({ to: 'fixture-peer', text: 'fixture' })).rejects.toMatchObject(
      { resultUnknown: true }
    )
    expect(h.calls.filter((v) => v === 'ilink.sendPlainText')).toHaveLength(1)
    const lease = await h.service.beginTyping({ to: 'fixture-peer' })
    await Promise.all([lease.stop(), lease.stop()])
    expect(h.calls.filter((v) => v === 'ilink.typingEnd')).toHaveLength(1)
    await h.service.stop()
  })
  it('cancels superseded starts and drains the previous account before opening another', async () => {
    const h = harness((_m, _p, o) => blocked(o.signal))
    const a = h.service.start('fixture-a')
    const b = h.service.start('fixture-b')
    await expect(a).rejects.toMatchObject({ code: 'CANCELLED' })
    await b
    expect(h.service.getActiveAccountId()).toBe('fixture-b')
    await h.service.start('fixture-c')
    const operations = h.calls.filter((v) => v === 'ilink.open' || v === 'ilink.close')
    expect(operations).toEqual(['ilink.open', 'ilink.close', 'ilink.open'])
    await h.service.stop()
  })
  it('uses bounded backoff and interrupts it promptly on stop', async () => {
    const pauses: number[] = []
    const h = harness(
      () => {
        throw new RuntimeRpcError('ILINK_HTTP_FAILED')
      },
      undefined,
      vi.fn(async (ms, signal) => {
        pauses.push(ms)
        if (pauses.length === 3) await blocked(signal)
      })
    )
    await h.service.start('fixture-account')
    await until(() => pauses.length === 3)
    expect(pauses).toEqual([2000, 2000, 30000])
    await h.service.stop()
  })
  it('closes login owners on pairing cancellation without publishing credentials', async () => {
    const h = harness((method) => {
      if (method === 'ilink.loginBegin')
        return { ownerId: owner, event: { status: 'qrcode', qrContent: 'synthetic-qr' } }
      if (method === 'ilink.loginPoll') return { status: 'need_verifycode' }
      throw new Error(method)
    })
    await h.service.startLogin()
    await until(() => h.loginEvents.mock.calls.some(([e]) => e.status === 'need_verifycode'))
    await h.service.cancelLogin()
    expect(h.calls.filter((v) => v === 'ilink.loginPoll')).toHaveLength(1)
    expect(h.calls).toContain('ilink.close')
    expect(h.close).toHaveBeenCalledTimes(1)
    expect(h.service.isLoginInProgress()).toBe(false)
    expect(() => h.service.submitVerifyCode('123456')).toThrow('ILINK_VERIFY_CODE_NOT_REQUESTED')
  })
  it('reports a confirmed login, passes pairing once and drains its transport', async () => {
    let polls = 0
    const h = harness((method, params) => {
      if (method === 'ilink.loginBegin')
        return { ownerId: owner, event: { status: 'qrcode', qrContent: 'synthetic-qr' } }
      if (method === 'ilink.loginPoll') {
        if (++polls === 1) return { status: 'need_verifycode' }
        expect(params.verifyCode).toBe('123456')
        return { status: 'confirmed', accountId: 'fixture-account' }
      }
      throw new Error(method)
    })
    await h.service.startLogin()
    await until(() => h.loginEvents.mock.calls.some(([e]) => e.status === 'need_verifycode'))
    h.service.submitVerifyCode('123456')
    await until(() => !h.service.isLoginInProgress())
    expect(h.service.getPhase()).toBe('stopped')
    expect(h.close).toHaveBeenCalledTimes(1)
    expect(h.loginEvents.mock.calls.at(-1)?.[0]).toEqual({
      status: 'confirmed',
      accountId: 'fixture-account'
    })
  })
  it('does not turn transport cleanup failure into a successful stop', async () => {
    const h = harness((_m, _p, o) => blocked(o.signal))
    await h.service.start('fixture-account')
    h.close.mockRejectedValueOnce(new RuntimeRpcError('RUNTIME_CLEANUP_UNCONFIRMED'))
    await expect(h.service.stop()).rejects.toMatchObject({ code: 'RUNTIME_CLEANUP_UNCONFIRMED' })
    expect(h.service.getPhase()).toBe('error')
  })
})
