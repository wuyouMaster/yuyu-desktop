import { afterEach, describe, expect, it } from 'vitest'
import { PassThrough } from 'node:stream'
import { RuntimeRpcClient } from '../../src/main/runtime-rpc/client'
import { serveRuntimeRpc } from '../../src/main/runtime-rpc/server'
import {
  encodeRuntimeRpcFrame,
  parseRuntimeRpcFrame,
  RuntimeRpcFrameReader,
  RUNTIME_RPC_MAX_FRAME_BYTES
} from '../../src/shared/runtime-rpc'

const clients: RuntimeRpcClient[] = []
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()))
})
function child(source: string): RuntimeRpcClient {
  const client = new RuntimeRpcClient({ executable: process.execPath, args: ['-e', source] })
  clients.push(client)
  return client
}
const echo = `require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const f = JSON.parse(line); if (f.type !== 'request') return;
  const reply = () => process.stdout.write(JSON.stringify({ protocol:1, type:'result', id:f.id, value:f.params })+'\\n');
  setTimeout(reply, f.params.delay || 0);
});`

describe('runtime protocol framing', () => {
  it('preserves Chinese text split inside a UTF-8 character and multiple frames', () => {
    const frame = { protocol: 1, type: 'result', id: 'fixture', value: '合成中文' } as const
    const bytes = Buffer.from(encodeRuntimeRpcFrame(frame))
    const at = bytes.indexOf(Buffer.from('合')) + 1
    const reader = new RuntimeRpcFrameReader()
    expect(reader.push(bytes.subarray(0, at))).toEqual([])
    expect(reader.push(Buffer.concat([bytes.subarray(at), bytes]))).toEqual([frame, frame])
    reader.end()
  })
  it.each([
    '{',
    '{"protocol":2,"type":"cancel","id":"x"}',
    '{"protocol":1,"type":"cancel","id":"x","extra":true}',
    '{"protocol":1,"type":"request","id":"x","method":"../execute","params":null}',
    '{"protocol":1,"type":"error","id":"x","code":"secret path","resultUnknown":false}'
  ])('rejects malformed or incompatible frames: %s', (input) => {
    expect(() => parseRuntimeRpcFrame(input)).toThrow('INVALID_FRAME')
  })
  it('rejects incomplete, oversized and invalid UTF-8 input', () => {
    const reader = new RuntimeRpcFrameReader()
    reader.push(Buffer.from('{'))
    expect(() => reader.end()).toThrow('TRUNCATED_FRAME')
    expect(() =>
      new RuntimeRpcFrameReader().push(Buffer.alloc(RUNTIME_RPC_MAX_FRAME_BYTES + 1, 32))
    ).toThrow('FRAME_TOO_LARGE')
    expect(() => new RuntimeRpcFrameReader().push(Buffer.from([255, 10]))).toThrow()
  })
  it('does not silently turn non-finite values into null', () => {
    expect(() =>
      encodeRuntimeRpcFrame({ protocol: 1, type: 'result', id: 'x', value: NaN })
    ).toThrow('INVALID_VALUE')
  })
})

describe('real child transport', () => {
  it('waits for native cleanup beyond the ordinary host budget when explicitly configured', async () => {
    const client = new RuntimeRpcClient({
      executable: process.execPath,
      shutdownGraceMs: 1500,
      args: ['-e', `${echo}\nprocess.stdin.on('end',()=>setTimeout(()=>process.exit(0),1100));`]
    })
    await client.call('echo', {})
    await expect(client.close()).resolves.toBeUndefined()
  })
  it('reports forced termination as unconfirmed cleanup', async () => {
    const client = new RuntimeRpcClient({
      executable: process.execPath,
      shutdownGraceMs: 100,
      args: ['-e', `${echo}\nsetInterval(()=>{},1000);`]
    })
    await client.call('echo', {})
    await expect(client.close()).rejects.toMatchObject({
      code: 'RUNTIME_CLEANUP_UNCONFIRMED',
      resultUnknown: true
    })
  })
  it('correlates concurrent out-of-order responses without retry', async () => {
    const client = child(echo)
    expect(
      await Promise.all([
        client.call('echo', { id: 1, delay: 40 }),
        client.call('echo', { id: 2, delay: 1 })
      ])
    ).toEqual([
      { id: 1, delay: 40 },
      { id: 2, delay: 1 }
    ])
  })
  it('marks timed-out side effects unknown and ignores late results', async () => {
    const client = child(echo)
    await expect(
      client.call('send', { delay: 150 }, { timeoutMs: 30, sideEffect: true })
    ).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED', resultUnknown: true })
    expect(await client.call('echo', { delay: 200 })).toEqual({ delay: 200 })
  })
  it('does not start a process for an already aborted request', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      child('process.exit(99)').call('echo', {}, { signal: controller.signal })
    ).rejects.toMatchObject({ code: 'CANCELLED', resultUnknown: false })
  })
  it('aborts a pending request without claiming that a send was undone', async () => {
    const controller = new AbortController()
    const task = child(echo).call(
      'send',
      { delay: 500 },
      { signal: controller.signal, sideEffect: true }
    )
    controller.abort()
    await expect(task).rejects.toMatchObject({ code: 'CANCELLED', resultUnknown: true })
  })
  it('rejects stdout noise without exposing private diagnostics', async () => {
    await expect(
      child('console.log("fixture-private-value")').call('echo', {})
    ).rejects.toMatchObject({ code: 'INVALID_RUNTIME_RESPONSE' })
  })
  it('rejects exit, unavailable executable and requests after close', async () => {
    await expect(child('process.exit(7)').call('echo', {})).rejects.toMatchObject({
      code: 'RUNTIME_EXITED'
    })
    const missing = new RuntimeRpcClient({ executable: '/fixture/nonexistent/runtime' })
    clients.push(missing)
    await expect(missing.call('echo', {})).rejects.toMatchObject({ code: 'RUNTIME_START_FAILED' })
    const client = child(echo)
    await client.close()
    await expect(client.call('echo', {})).rejects.toMatchObject({ code: 'RUNTIME_CLOSED' })
  })
})

describe('host isolation', () => {
  it('retains cleanup uncertainty when a side-effect owner exited before close', async () => {
    const client = new RuntimeRpcClient({
      executable: process.execPath,
      args: ['-e', 'process.exit(7)']
    })
    await expect(client.call('send', {}, { sideEffect: true })).rejects.toMatchObject({
      code: 'RUNTIME_EXITED',
      resultUnknown: true
    })
    await expect(client.close()).rejects.toMatchObject({
      code: 'RUNTIME_CLEANUP_UNCONFIRMED',
      resultUnknown: true
    })
  })
  it('uses an explicit method allowlist and redacts implementation exceptions', async () => {
    const input = new PassThrough(),
      output = new PassThrough()
    let text = ''
    output.on('data', (chunk) => {
      text += chunk.toString()
    })
    let disposed = false
    const host = serveRuntimeRpc({
      input,
      output,
      methods: {
        'fixture.fail': {
          run: () => {
            throw new Error('fixture-private-value')
          }
        },
        'fixture.echo': { run: (params) => params }
      },
      dispose: () => {
        disposed = true
      }
    })
    for (const [id, method] of [
      ['a', 'constructor'],
      ['b', 'fixture.fail'],
      ['c', 'fixture.echo']
    ]) {
      input.write(
        encodeRuntimeRpcFrame({ protocol: 1, type: 'request', id, method, params: { count: 1 } })
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
    input.end()
    await host.finished
    const frames = text.trim().split('\n').map(parseRuntimeRpcFrame)
    expect(frames).toContainEqual({
      protocol: 1,
      type: 'error',
      id: 'a',
      code: 'METHOD_UNAVAILABLE',
      resultUnknown: false
    })
    expect(frames).toContainEqual({
      protocol: 1,
      type: 'error',
      id: 'b',
      code: 'OPERATION_FAILED',
      resultUnknown: false
    })
    expect(frames).toContainEqual({ protocol: 1, type: 'result', id: 'c', value: { count: 1 } })
    expect(text).not.toContain('fixture-private-value')
    expect(disposed).toBe(true)
  })
})
