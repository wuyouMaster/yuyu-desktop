import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ApplicationWechatConnector } from '../../src/main/runtime-rpc/application-wechat-connector'
import { WechatILinkClient } from '../../src/main/runtime-rpc/wechat-ilink-client'
import { RuntimeRpcError, type RuntimeJson } from '../../src/shared/runtime-rpc'
const owner = 'a'.repeat(48)
const clientId = 'yuyu-' + 'b'.repeat(32)
function fixture(login = false) {
  const close = vi.fn(async () => {})
  const events = vi.fn()
  const call = vi.fn(() => 'original-context')
  const callAsync = vi.fn(async (method: string, _params: any, options: any): Promise<RuntimeJson> => {
    if (method === 'runtime.describe')
      return {
        application: 'wechat',
        protocol: 1,
        implementation: 'go',
        version: 'fixture',
        platform: 'darwin',
        arch: 'arm64',
        methods: [
          'ilink.open',
          'ilink.close',
          'ilink.accounts',
          'ilink.notify',
          'ilink.poll',
          'ilink.sendPlainText',
          'ilink.sendMediaFile',
          'ilink.sendMediaURL',
          'ilink.context',
          'ilink.loginBegin',
          'ilink.loginPoll'
        ]
      }
    if (method === 'ilink.accounts')
      return [{ accountId: 'fixture-account', wechatUserId: 'fixture-user' }]
    if (method === 'ilink.open') return { ownerId: owner }
    if (method === 'ilink.close' || method === 'ilink.notify') return true
    if (method === 'ilink.sendPlainText') return { clientId }
    if (method === 'ilink.sendMediaFile' || method === 'ilink.sendMediaURL')
      return { clientId, itemType: 4 }
    if (method === 'ilink.loginBegin')
      return { ownerId: owner, event: { status: 'qrcode', qrContent: 'synthetic-login-content' } }
    if (method === 'ilink.loginPoll' && login)
      return { status: 'confirmed', accountId: 'fixture-account', wechatUserId: 'fixture-user' }
    if (method === 'ilink.poll')
      return new Promise<never>((_r, reject) =>
        options.signal.addEventListener('abort', () => reject(new RuntimeRpcError('CANCELLED')), {
          once: true
        })
      )
    throw new Error('Unexpected synthetic operation ' + method)
  })
  const encode = vi.fn(async () => 'data:image/png;base64,c3ludGhldGlj')
  const connector = new ApplicationWechatConnector(
    '/synthetic/credentials',
    async () => ({ client: new WechatILinkClient({ call, callAsync }), close }),
    encode
  )
  connector.setHost({ onLoginEvent: events, onMessages: async () => {} })
  return { connector, close, call, callAsync, events, encode }
}
describe('native iLink product connector', () => {
  it('refreshes account summaries without exposing credentials and retains reply context', async () => {
    const f = fixture()
    expect(await f.connector.refreshAccounts()).toEqual([
      { accountId: 'fixture-account', wechatUserId: 'fixture-user' }
    ])
    const copy = f.connector.listAccounts()
    copy[0].accountId = 'changed'
    expect(f.connector.listAccounts()[0].accountId).toBe('fixture-account')
    await f.connector.start('fixture-account')
    expect(
      await f.connector.sendText({
        to: 'peer',
        text: '**hello**',
        contextToken: 'original-context'
      })
    ).toEqual({ clientId, plainText: 'hello' })
    expect(f.callAsync).toHaveBeenCalledWith(
      'ilink.sendPlainText',
      { ownerId: owner, to: 'peer', text: 'hello', contextToken: 'original-context' },
      expect.any(Object)
    )
    expect(f.connector.resolveContextToken('fixture-account', 'peer')).toBe('original-context')
    await f.connector.sendMediaPath({ to: 'peer', filePath: resolve('synthetic.png') })
    expect(f.callAsync).toHaveBeenCalledWith(
      'ilink.sendMediaFile',
      expect.objectContaining({ path: 'synthetic.png', kind: 'image' }),
      expect.any(Object)
    )
    await f.connector.stop()
    expect(f.close).toHaveBeenCalledTimes(2)
  })
  it('orders QR presentation and refreshed account activation, then closes login ownership', async () => {
    const f = fixture(true)
    f.connector.startLogin()
    await vi.waitFor(() =>
      expect(f.events).toHaveBeenCalledWith({
        status: 'active',
        accountId: 'fixture-account',
        wechatUserId: 'fixture-user'
      })
    )
    expect(f.events.mock.calls.map(([event]) => event.status)).toEqual([
      'qrcode',
      'confirmed',
      'active'
    ])
    expect(f.encode).toHaveBeenCalledWith('synthetic-login-content')
    expect(f.connector.listAccounts()).toHaveLength(1)
    await f.connector.stop()
    expect(f.close).toHaveBeenCalledTimes(2)
  })
  it('does not let a slow QR encoder resurrect cancelled login', async () => {
    const f = fixture(true)
    let finish!: () => void
    f.encode.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = () => resolve('data:image/png;base64,c3ludGhldGlj')
        })
    )
    f.connector.startLogin()
    await vi.waitFor(() => expect(f.encode).toHaveBeenCalledOnce())
    f.connector.cancelLogin()
    finish()
    await f.connector.stop()
    expect(f.events).not.toHaveBeenCalled()
  })
  it('isolates failing UI observers from owned runtime cleanup', async () => {
    const f = fixture()
    f.connector.setHost({
      onMessages: async () => {},
      onPhaseChange: () => {
        throw new Error('closed UI')
      },
      onLog: () => {
        throw new Error('closed UI')
      }
    })
    await f.connector.start('fixture-account')
    await f.connector.stop()
    expect(f.close).toHaveBeenCalledOnce()
  })
})
