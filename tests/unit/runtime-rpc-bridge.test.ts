import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'
import { RuntimeRpcBridgeClient } from '../../src/main/runtime-rpc/bridge-client'

let root: string, worker: string
const clients: RuntimeRpcBridgeClient[] = []
const host = `let counter=0;
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
const f=JSON.parse(line);if(f.type!=='request')return;
if(f.method==='exit'){process.exit(2);return}
const value={counter:++counter,pid:process.pid,input:f.params};
setTimeout(()=>process.stdout.write(JSON.stringify({protocol:1,type:'result',id:f.id,value})+'\\n'),f.params.delay||0);
});`
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'fixture-native-bridge-'))
  for (const name of [
    'main/runtime-rpc/bridge-worker.ts',
    'main/runtime-rpc/client.ts',
    'shared/runtime-rpc.ts'
  ]) {
    const file = join(root, name.replace(/\.ts$/, '.js'))
    await mkdir(dirname(file), { recursive: true })
    const source = await readFile(resolve('src', name), 'utf8')
    const output = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText
    await writeFile(file, output)
  }
  worker = join(root, 'main/runtime-rpc/bridge-worker.js')
})
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()))
})
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})
function create(): RuntimeRpcBridgeClient {
  const client = new RuntimeRpcBridgeClient(worker, {
    executable: process.execPath,
    args: ['-e', host]
  })
  clients.push(client)
  return client
}
describe('one native owner across sync and async application methods', () => {
  it('keeps one process and request state while a synchronous call overlaps async I/O', async () => {
    const client = create()
    const first = client.call('fixture.next', {}) as { counter: number; pid: number }
    const waiting = client.callAsync('fixture.next', { delay: 60 })
    const third = client.call('fixture.next', {}) as { counter: number; pid: number }
    const second = (await waiting) as { counter: number; pid: number }
    expect([first.counter, second.counter, third.counter]).toEqual([1, 2, 3])
    expect(new Set([first.pid, second.pid, third.pid]).size).toBe(1)
  })
  it('cancels sync deadlines without retrying or reviving late replies', async () => {
    const client = create()
    client.call('fixture.next', {})
    expect(() =>
      client.call('fixture.next', { delay: 100 }, { timeoutMs: 15, sideEffect: true })
    ).toThrow('DEADLINE_EXCEEDED')
    expect(client.call('fixture.next', {})).toMatchObject({ counter: 3 })
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(client.call('fixture.next', {})).toMatchObject({ counter: 4 })
  })
  it('reports asynchronous cancellation and close instead of returning empty data', async () => {
    const client = create()
    client.call('fixture.next', {})
    const controller = new AbortController()
    const pending = client.callAsync(
      'fixture.next',
      { delay: 200 },
      { signal: controller.signal, sideEffect: true }
    )
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED', resultUnknown: true })
    await client.close()
    await client.close()
    expect(() => client.call('fixture.next', {})).toThrow('RUNTIME_CLOSED')
  })
  it('never restarts a dead native owner', async () => {
    const client = create()
    client.call('fixture.next', {})
    await expect(client.callAsync('exit', {}, { sideEffect: true })).rejects.toMatchObject({
      code: 'RUNTIME_EXITED',
      resultUnknown: true
    })
    expect(() => client.call('fixture.next', {})).toThrow('RUNTIME_EXITED')
  })
  it('closes even when the worker failed before the close request', async () => {
    const client = new RuntimeRpcBridgeClient(join(root, 'missing-worker.js'), {
      executable: process.execPath
    })
    clients.push(client)
    await expect(client.callAsync('fixture.next', {})).rejects.toThrow('BRIDGE_FAILED')
    await new Promise((resolve) => setTimeout(resolve, 30))
    await client.close()
    await client.close()
  })
})
