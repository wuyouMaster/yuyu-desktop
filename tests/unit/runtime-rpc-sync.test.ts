import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { RuntimeRpcSyncClient } from '../../src/main/runtime-rpc/sync-client'
vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))
afterEach(() => vi.resetAllMocks())

function result(stdout: string, error?: NodeJS.ErrnoException) {
  return {
    pid: 1,
    output: [],
    stdout: Buffer.from(stdout),
    stderr: Buffer.alloc(0),
    status: 0,
    signal: null,
    error
  }
}
describe('stateless synchronous runtime transport', () => {
  it('correlates one frame and keeps parameters on stdin', () => {
    vi.mocked(spawnSync).mockImplementation((_path, _args, options) => {
      const request = JSON.parse(String(options?.input))
      return result(
        JSON.stringify({ protocol: 1, type: 'result', id: request.id, value: 'fixture' }) + '\n'
      )
    })
    expect(
      new RuntimeRpcSyncClient('/fixture/host').call('message.parse', { content: 'fixture-secret' })
    ).toBe('fixture')
    expect(vi.mocked(spawnSync).mock.calls[0].slice(0, 2)).toEqual(['/fixture/host', ['--once']])
    expect(vi.mocked(spawnSync).mock.calls[0][2]).toMatchObject({
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true
    })
  })
  it.each([
    '',
    '{}\n',
    '{"protocol":1,"type":"result","id":"other","value":null}\n',
    'not-json',
    '\ufffd\n'
  ])('rejects missing or malformed responses %#', (stdout) => {
    vi.mocked(spawnSync).mockReturnValue(result(stdout))
    expect(() => new RuntimeRpcSyncClient('/fixture/host').call('runtime.describe', {})).toThrow(
      'INVALID_RUNTIME_RESPONSE'
    )
  })
  it('does not retry or expose child errors', () => {
    vi.mocked(spawnSync).mockReturnValue(
      result('', Object.assign(new Error('fixture-secret'), { code: 'ETIMEDOUT' }))
    )
    expect(() => new RuntimeRpcSyncClient('/fixture/host').call('runtime.describe', {})).toThrow(
      'TIMEOUT'
    )
    expect(spawnSync).toHaveBeenCalledTimes(1)
  })
})
