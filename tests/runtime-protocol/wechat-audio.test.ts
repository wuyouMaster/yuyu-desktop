import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { RuntimeRpcBridgeClient } from '../../src/main/runtime-rpc/bridge-client'
import { WechatAudioCodecPort } from '../../src/main/runtime-rpc/wechat-audio-codec-port'
const executable = process.env.YUYU_TEST_WECHAT_AUDIO_HOST
if (!executable || !isAbsolute(executable)) throw new Error('Real audio runtime host is required')
const rpc = new RuntimeRpcBridgeClient(resolve('out/worker/main/runtime-rpc/bridge-worker.js'), {
  executable,
  env: { PATH: '' }
})
const port = new WechatAudioCodecPort(rpc)
afterAll(async () => {
  await rpc.close()
})
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex')
describe('source-built audio runtime through the application port', () => {
  it('encodes synthetic PCM and returns every independently verified decoded sample', async () => {
    const rate = 16000
    const pcm = Buffer.alloc((rate + 13) * 2)
    for (let n = 0; n < pcm.length / 2; n++)
      pcm.writeInt16LE(
        Math.round(
          4500 * Math.sin((n * 2 * Math.PI * 440) / rate) +
            1200 * Math.sin((n * 2 * Math.PI * 1700) / rate)
        ),
        n * 2
      )
    const encoded = await port.encode(pcm, rate)
    expect(encoded.durationMs).toBe(1020)
    const decoded = await port.decode({
      codec: 'silk',
      data: encoded.data,
      sourceHash: digest(encoded.data)
    })
    expect(decoded.pcm.length).toBe(32640)
    expect(digest(decoded.pcm)).toBe(
      '8822e9db57a5cb991da7549bb3e0371d706208a2e1d317bb08667abd070bd315'
    )
    expect(decoded.sampleRate).toBe(16000)
    expect(decoded.channels).toBe(1)
  })
  it('transfers PCM larger than a JSON frame and checks all decoded samples', async () => {
    const pcm = Buffer.alloc(9 * 1024 * 1024)
    const encoded = await port.encode(pcm, 48000)
    expect(encoded.durationMs).toBe(Math.ceil(pcm.length / 2 / 960) * 20)
    const decoded = await port.decode({
      codec: 'silk',
      data: encoded.data,
      sourceHash: digest(encoded.data)
    })
    expect(decoded.pcm.length).toBe(encoded.durationMs * 32)
    expect(digest(decoded.pcm)).toBe(
      'c4b6aed118ec311db46242360f9c6e87ac875731110c455d9411d5484be9d902'
    )
  })
  it('decodes every AMR frame and refuses a truncated final frame', async () => {
    const frame = Buffer.concat([Buffer.from([0x3c]), Buffer.alloc(31)])
    const data = Buffer.concat([Buffer.from('#!AMR\n'), ...Array.from({ length: 50 }, () => frame)])
    const audio = await port.decode({ codec: 'amr', data, sourceHash: digest(data) })
    expect(audio.sampleRate).toBe(8000)
    expect(audio.pcm.length).toBe(16000)
    expect(digest(audio.pcm)).toBe(
      '2d8571779042d4729a2df18d5af59d264c8c89e53c7848ae659cb6130396e790'
    )
    await expect(
      port.decode({ codec: 'amr', data: data.subarray(0, -1), sourceHash: 'synthetic' })
    ).rejects.toThrow('AUDIO_INVALID_ARGUMENT')
  })
  it('rejects damaged streams and keeps the runtime usable', async () => {
    for (const data of [Buffer.from('invalid'), Buffer.from('\x02#!SILK_V3\x01\x04')])
      await expect(port.decode({ codec: 'silk', data, sourceHash: digest(data) })).rejects.toThrow(
        'AUDIO_CODEC_FAILED'
      )
    const encoded = await port.encode(Buffer.alloc(640), 16000)
    expect(encoded.durationMs).toBe(20)
  })
})
