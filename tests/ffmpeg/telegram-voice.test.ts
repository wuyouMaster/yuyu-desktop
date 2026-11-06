import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prepareTelegramSendVoice } from '../../src/main/services/telegram-send-voice'

if (!process.env.FFMPEG_BIN) throw new Error('FFMPEG_BIN must point to the verified candidate')
// Packaged callers resolve app.asar paths to their unpacked executable.
const ffmpeg = process.env.FFMPEG_BIN.replace('app.asar', 'app.asar.unpacked')
let root: string
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'synthetic-telegram-voice-')) })
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }) })

function syntheticWav(): Buffer {
  const samples = 16_000, pcm = Buffer.alloc(samples * 2), header = Buffer.alloc(44)
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(Math.round(5000 * Math.sin(i * 2 * Math.PI * 440 / 16000)), i * 2)
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

describe('reviewed FFmpeg through the real Telegram voice preparation service', () => {
  it('converts synthetic WAV to Opus, reads its duration and removes its temporary files', async () => {
    const input = join(root, 'synthetic.wav')
    await writeFile(input, syntheticWav())
    const prepared = await prepareTelegramSendVoice(input, new AbortController().signal)
    try {
      expect(prepared.file).toMatchObject({ kind: 'voice', name: 'voice.ogg' })
      expect(prepared.file.durationMs).toBeGreaterThan(900)
      expect(prepared.file.durationMs).toBeLessThan(1100)
      expect(prepared.file.waveform).toHaveLength(100)
      expect((await readFile(prepared.file.path)).subarray(0, 4).toString()).toBe('OggS')
    } finally {
      await prepared.dispose()
    }
    await expect(stat(prepared.file.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects invalid audio without creating an output', async () => {
    const input = join(root, 'invalid.wav')
    await writeFile(input, 'synthetic-invalid-audio')
    await expect(prepareTelegramSendVoice(input, new AbortController().signal)).rejects.toThrow('语音准备失败')
  })

  it.each([['flac', 'flac'], ['aac', 'aac'], ['ogg', 'libopus']])(
    'converts synthetic %s audio through the real preparation service', async (extension, encoder) => {
      const source = join(root, `source-${extension}.wav`)
      const input = join(root, `synthetic.${extension}`)
      await writeFile(source, syntheticWav())
      execFileSync(ffmpeg, ['-v', 'error', '-nostdin', '-i', source, '-c:a', encoder, '-y', input])
      const prepared = await prepareTelegramSendVoice(input, new AbortController().signal)
      try {
        expect(prepared.file.kind).toBe('voice')
        expect(prepared.file.durationMs).toBeGreaterThan(800)
        expect(prepared.file.waveform).toHaveLength(100)
      } finally {
        await prepared.dispose()
      }
    }
  )

  it('preserves every synthetic PCM sample through the WeChat pipe conversion', () => {
    const input = syntheticWav()
    const result = spawnSync(ffmpeg, [
      '-v', 'error', '-i', 'pipe:0', '-f', 's16le', '-ar', '16000', '-ac', '1', 'pipe:1'
    ], { input, maxBuffer: 1024 * 1024 })
    expect(result.status).toBe(0)
    expect(result.stdout.equals(input.subarray(44))).toBe(true)
  })
})
