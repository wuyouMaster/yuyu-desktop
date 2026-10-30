import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { WechatAudioCodecPort } from '../../src/main/runtime-rpc/wechat-audio-codec-port'
import { RuntimeRpcError } from '../../src/shared/runtime-rpc'
import type { DatabaseRpcTransport } from '../../src/main/runtime-rpc/wechat-database-client'
const jobId = 'a'.repeat(48)
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex')
function fixture(mutator?: (method: string, value: any, params: any) => any) {
  const output = Buffer.alloc(600 * 1024, 1)
  const uploaded: Buffer[] = []
  const rpc = {
    call: vi.fn(),
    callAsync: vi.fn(async (method: string, params: any) => {
      let value: any
      switch (method) {
        case 'runtime.describe':
          value = {
            protocol: 1,
            application: 'wechat',
            implementation: 'go',
            platform: 'darwin',
            arch: 'arm64',
            version: 'fixture',
            methods: ['audio.open', 'audio.write', 'audio.finish', 'audio.read', 'audio.close']
          }
          break
        case 'audio.open':
          value = { jobId }
          break
        case 'audio.write':
          uploaded.push(Buffer.from(params.data, 'base64'))
          value = true
          break
        case 'audio.finish':
          value = {
            size: output.length,
            sha256: digest(output),
            sampleRate: 16000,
            channels: 1,
            durationMs: output.length / 32
          }
          break
        case 'audio.read': {
          const data = output.subarray(params.offset, params.offset + params.length)
          value = {
            offset: params.offset,
            data: data.toString('base64'),
            eof: params.offset + data.length === output.length
          }
          break
        }
        case 'audio.close':
          value = true
          break
        default:
          throw new Error(method)
      }
      return mutator ? mutator(method, value, params) : value
    })
  }
  return { port: new WechatAudioCodecPort(rpc as DatabaseRpcTransport), rpc, output, uploaded }
}
describe('audio protocol port', () => {
  it('transfers multiple bounded chunks and verifies the complete output', async () => {
    const h = fixture()
    const input = Buffer.alloc(700 * 1024, 2)
    const actual = await h.port.decode({
      data: input,
      codec: 'silk',
      sourceHash: 'logical-source-id'
    })
    expect(actual).toEqual({
      pcm: h.output,
      sampleRate: 16000,
      channels: 1,
      sourceHash: 'logical-source-id'
    })
    expect(Buffer.concat(h.uploaded)).toEqual(input)
    expect(h.uploaded.map((b) => b.length)).toEqual([512 * 1024, 188 * 1024])
    expect(h.rpc.callAsync.mock.calls.at(-1)?.[0]).toBe('audio.close')
  })
  it.each(['digest', 'offset', 'length', 'eof', 'rate', 'private-field'])(
    'rejects %s corruption and still closes',
    async (kind) => {
      const h = fixture((method, value) => {
        if (method === 'audio.finish' && kind === 'digest')
          return { ...value, sha256: '0'.repeat(64) }
        if (method === 'audio.finish' && kind === 'rate') return { ...value, sampleRate: 8000 }
        if (method === 'audio.finish' && kind === 'private-field')
          return { ...value, executable: 'forbidden' }
        if (method === 'audio.read' && kind === 'offset') return { ...value, offset: 1 }
        if (method === 'audio.read' && kind === 'length') return { ...value, data: 'AA==' }
        if (method === 'audio.read' && kind === 'eof') return { ...value, eof: true }
        return value
      })
      await expect(
        h.port.decode({ data: Buffer.from([1, 2]), codec: 'silk', sourceHash: 'fixture' })
      ).rejects.toBeInstanceOf(RuntimeRpcError)
      expect(h.rpc.callAsync.mock.calls.at(-1)?.[0]).toBe('audio.close')
    }
  )
  it('does not conceal a failed native codec or cleanup failure', async () => {
    const a = fixture((method, value) => {
      if (method === 'audio.finish') throw new RuntimeRpcError('AUDIO_CODEC_FAILED')
      return value
    })
    await expect(a.port.encode(Buffer.from([1, 2]), 16000)).rejects.toMatchObject({
      code: 'AUDIO_CODEC_FAILED'
    })
    expect(a.rpc.callAsync.mock.calls.at(-1)?.[0]).toBe('audio.close')
    const b = fixture((method, value) => {
      if (method === 'audio.close') throw new RuntimeRpcError('TRANSPORT_CLOSED')
      return value
    })
    await expect(b.port.encode(Buffer.from([1, 2]), 16000)).rejects.toMatchObject({
      code: 'TRANSPORT_CLOSED'
    })
  })
  it('rejects invalid PCM, codecs and unavailable capability without fallback', async () => {
    const h = fixture()
    await expect(h.port.encode(Buffer.from([1]), 16000)).rejects.toThrow('INVALID_ARGUMENT')
    await expect(h.port.encode(Buffer.from([1, 2]), 12345)).rejects.toThrow('INVALID_ARGUMENT')
    await expect(
      h.port.decode({ data: Buffer.from([1, 2]), codec: 'foreign', sourceHash: 'fixture' })
    ).rejects.toThrow('INVALID_ARGUMENT')
    expect(h.rpc.callAsync).not.toHaveBeenCalled()
    const old = fixture((method, value) =>
      method === 'runtime.describe' ? { ...value, methods: [] } : value
    )
    await expect(old.port.encode(Buffer.from([1, 2]), 16000)).rejects.toThrow(
      'CAPABILITY_UNAVAILABLE'
    )
    expect(old.rpc.callAsync.mock.calls).toHaveLength(1)
  })
})
