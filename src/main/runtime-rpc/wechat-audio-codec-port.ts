import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AudioCodecPort, EncodedVoiceSource } from '../../shared/audio-codec-port'
import { RuntimeRpcError, type RuntimeJson } from '../../shared/runtime-rpc'
import { wechatStorageDescriptionSchema } from '../../shared/wechat-storage-protocol'
import type { DatabaseRpcTransport } from './wechat-database-client'
const maxBytes = 48 * 1024 * 1024
const chunkBytes = 512 * 1024
const methods = ['audio.open', 'audio.write', 'audio.finish', 'audio.read', 'audio.close']
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const handle = z.string().regex(/^[a-f0-9]{48}$/)
const result = z
  .object({
    size: z.number().int().positive().max(maxBytes),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sampleRate: z.number().int().positive(),
    channels: z.literal(1),
    durationMs: z
      .number()
      .int()
      .positive()
      .max(Math.ceil((maxBytes * 1000) / 16000) + 20)
  })
  .strict()
function check<T>(schema: z.ZodType<T>, value: unknown, code = 'INVALID_RUNTIME_RESPONSE'): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new RuntimeRpcError(code)
  return parsed.data
}
/** Only protocol framing and integrity checking. No SDK, WASM, FFmpeg or codec parsing. */
export class WechatAudioCodecPort implements AudioCodecPort {
  private ready?: Promise<void>
  constructor(private readonly rpc: DatabaseRpcTransport) {}
  private capabilities(signal?: AbortSignal) {
    this.ready ??= (async () => {
      const description = check(
        wechatStorageDescriptionSchema,
        await this.rpc.callAsync('runtime.describe', {}, { signal }),
        'INCOMPATIBLE_RUNTIME'
      )
      if (methods.some((method) => !description.methods.includes(method)))
        throw new RuntimeRpcError('CAPABILITY_UNAVAILABLE')
    })().catch((error) => {
      this.ready = undefined
      throw error
    })
    return this.ready
  }
  private async run(
    operation: 'encode' | 'decode',
    codec: string,
    sampleRate: number,
    input: Buffer,
    signal?: AbortSignal
  ) {
    if (
      !Buffer.isBuffer(input) ||
      !input.length ||
      input.length > maxBytes ||
      ![8000, 12000, 16000, 24000, 32000, 44100, 48000].includes(sampleRate) ||
      !['silk', 'amr'].includes(codec) ||
      (operation === 'encode' && (codec !== 'silk' || input.length % 2)) ||
      (codec === 'amr' && sampleRate !== 8000)
    )
      throw new RuntimeRpcError('INVALID_ARGUMENT')
    await this.capabilities(signal)
    const call = (method: string, params: RuntimeJson, cancel = signal) =>
      this.rpc.callAsync(method, params, { signal: cancel, timeoutMs: 35000 })
    const { jobId } = check(
      z.object({ jobId: handle }).strict(),
      await call('audio.open', {
        operation,
        codec,
        sampleRate,
        inputBytes: input.length,
        sha256: digest(input)
      })
    )
    let data: Buffer | undefined
    let success = false
    try {
      for (let offset = 0; offset < input.length; offset += chunkBytes)
        check(
          z.literal(true),
          await call('audio.write', {
            jobId,
            offset,
            data: input.subarray(offset, offset + chunkBytes).toString('base64')
          })
        )
      const info = check(result, await call('audio.finish', { jobId }))
      if (
        info.sampleRate !== sampleRate ||
        (operation === 'decode' &&
          (info.size % 2 || info.durationMs !== Math.floor((info.size * 1000) / (sampleRate * 2))))
      )
        throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
      data = Buffer.alloc(info.size)
      for (let offset = 0; offset < data.length; ) {
        const length = Math.min(chunkBytes, data.length - offset)
        const chunk = check(
          z
            .object({
              offset: z.literal(offset),
              data: z.string().max(Math.ceil(chunkBytes / 3) * 4),
              eof: z.boolean()
            })
            .strict(),
          await call('audio.read', { jobId, offset, length })
        )
        const bytes = Buffer.from(chunk.data, 'base64')
        try {
          if (
            bytes.length !== length ||
            bytes.toString('base64') !== chunk.data ||
            chunk.eof !== (offset + length === data.length)
          )
            throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
          bytes.copy(data, offset)
        } finally {
          bytes.fill(0)
        }
        offset += length
      }
      if (digest(data) !== info.sha256) throw new RuntimeRpcError('AUDIO_OUTPUT_INTEGRITY_FAILED')
      if (signal?.aborted) throw new RuntimeRpcError('CANCELLED')
      success = true
      return { data, info }
    } finally {
      try {
        // Cleanup must not inherit an already-aborted operation signal.
        check(
          z.literal(true),
          await this.rpc.callAsync('audio.close', { jobId }, { timeoutMs: 5000 })
        )
      } catch (error) {
        success = false
        throw error
      } finally {
        if (!success) data?.fill(0)
      }
    }
  }
  async decode(source: EncodedVoiceSource, signal?: AbortSignal) {
    const sampleRate = source.codec === 'amr' ? 8000 : 16000
    const value = await this.run('decode', source.codec, sampleRate, source.data, signal)
    return { pcm: value.data, sampleRate, channels: 1, sourceHash: source.sourceHash }
  }
  async encode(pcm: Buffer, sampleRate: number, signal?: AbortSignal) {
    const value = await this.run('encode', 'silk', sampleRate, pcm, signal)
    return { data: value.data, durationMs: value.info.durationMs }
  }
}
