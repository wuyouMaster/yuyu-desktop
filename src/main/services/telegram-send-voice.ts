import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { prepareTelegramSendFile, type TelegramSendFile } from './telegram-send-file'

const execute = promisify(execFile)

/** 100 unsigned five-bit peaks, the client's unpacked VoiceWaveform format. */
export function telegramVoiceWaveform(pcm: Buffer): number[] {
  if (pcm.length < 2 || pcm.length % 2) throw new Error('无效的语音采样')
  const peaks = Array<number>(100).fill(0)
  const samples = pcm.length / 2
  for (let i = 0; i < samples; i++) {
    const bucket = Math.min(99, Math.floor((i * 100) / samples))
    peaks[bucket] = Math.max(peaks[bucket], Math.abs(pcm.readInt16LE(i * 2)))
  }
  const max = Math.max(1, ...peaks)
  return peaks.map((value) => Math.round((value * 31) / max))
}
export function telegramOpusDuration(bytes: Buffer): number {
  if (
    bytes.length < 64 ||
    bytes.toString('ascii', 0, 4) !== 'OggS' ||
    bytes.toString('ascii', 28, 36) !== 'OpusHead'
  )
    throw new Error('无效的 Opus 语音')
  const skip = bytes.readUInt16LE(38)
  let offset = 0,
    granule = 0n,
    ended = false
  while (offset < bytes.length) {
    if (offset + 27 > bytes.length || bytes.toString('ascii', offset, offset + 4) !== 'OggS')
      throw new Error('语音容器不完整')
    const count = bytes[offset + 26]
    if (offset + 27 + count > bytes.length) throw new Error('语音容器不完整')
    let size = 0
    for (let i = 0; i < count; i++) size += bytes[offset + 27 + i]
    const end = offset + 27 + count + size
    if (end > bytes.length || ended) throw new Error('语音容器不完整')
    const position = bytes.readBigUInt64LE(offset + 6)
    if (position !== 0xffffffffffffffffn) granule = position
    ended = (bytes[offset + 5] & 4) !== 0
    offset = end
  }
  const duration = Math.ceil(Number(granule - BigInt(skip)) / 48)
  if (!ended || !Number.isSafeInteger(duration) || duration < 1 || duration > 300000)
    throw new Error('语音须在 5 分钟以内')
  return duration
}

export async function prepareTelegramSendVoice(
  path: string,
  signal: AbortSignal
): Promise<{
  file: TelegramSendFile
  dispose: () => Promise<void>
}> {
  const prepared = await prepareTelegramSendFile(path)
  try {
    signal.throwIfAborted()
    const output = join(dirname(prepared.file.path), 'converted-voice.ogg')
    const ffmpeg = String(ffmpegStatic || '').replace('app.asar', 'app.asar.unpacked')
    if (!ffmpeg) throw new Error('FFmpeg unavailable')
    // Decode only local audio containers. Playlists and network protocols cannot
    // turn a selected file into a request for another resource.
    await execute(
      ffmpeg,
      [
        '-v',
        'error',
        '-nostdin',
        '-protocol_whitelist',
        'file,pipe',
        '-format_whitelist',
        'wav,mp3,ogg,flac,mov,matroska,webm,aac',
        '-i',
        prepared.file.path,
        '-map',
        '0:a:0',
        '-vn',
        '-t',
        '301',
        '-ac',
        '1',
        '-ar',
        '48000',
        '-c:a',
        'libopus',
        '-b:a',
        '32k',
        '-application',
        'voip',
        '-map_metadata',
        '-1',
        '-y',
        output
      ],
      { timeout: 60000, maxBuffer: 16384, signal }
    )
    signal.throwIfAborted()
    const bytes = await readFile(output)
    if (bytes.length > 8 * 1024 * 1024) throw new Error('语音超过 8 MiB')
    const durationMs = telegramOpusDuration(bytes)
    const { stdout: pcm } = await execute(
      ffmpeg,
      [
        '-v',
        'error',
        '-nostdin',
        '-protocol_whitelist',
        'file,pipe',
        '-format_whitelist',
        'ogg',
        '-i',
        output,
        '-map',
        '0:a:0',
        '-t',
        '300',
        '-ac',
        '1',
        '-ar',
        '8000',
        '-f',
        's16le',
        'pipe:1'
      ],
      { timeout: 30000, maxBuffer: 4800002, encoding: 'buffer', signal }
    )
    signal.throwIfAborted()
    return {
      file: {
        kind: 'voice',
        name: 'voice.ogg',
        path: output,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        durationMs,
        waveform: telegramVoiceWaveform(pcm)
      },
      dispose: prepared.dispose
    }
  } catch {
    await prepared.dispose()
    signal.throwIfAborted()
    throw new Error('语音准备失败，请选择 32 MiB、5 分钟以内的本地音频，并确认 FFmpeg 可用')
  }
}
