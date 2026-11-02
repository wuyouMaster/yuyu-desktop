import { constants } from 'node:fs'
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { openRegularFile } from './regular-file'

export interface TelegramSendFile {
  kind?: 'sticker' | 'voice'
  durationMs?: number
  waveform?: number[]
  path: string
  sha256: string
  name: string
  sizeBytes: number
}

/** Native ImageIO also validates one decodable WebP frame and sticker dimensions. */
export async function prepareTelegramSendSticker(
  path: string
): ReturnType<typeof prepareTelegramSendFile> {
  const prepared = await prepareTelegramSendFile(path)
  try {
    const handle = await open(prepared.file.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const header = Buffer.alloc(12)
    try {
      await handle.read(header, 0, 12, 0)
    } finally {
      await handle.close()
    }
    if (
      !/\.webp$/i.test(prepared.file.name) ||
      prepared.file.sizeBytes > 512 * 1024 ||
      header.toString('ascii', 0, 4) !== 'RIFF' ||
      header.toString('ascii', 8, 12) !== 'WEBP' ||
      header.readUInt32LE(4) + 8 !== prepared.file.sizeBytes
    )
      throw new Error('贴纸须为 512 KiB 以内的静态 WebP')
    prepared.file.kind = 'sticker'
    return prepared
  } catch (error) {
    await prepared.dispose()
    throw error
  }
}

export const TELEGRAM_SEND_FILE_LIMIT = 32 * 1024 * 1024

/** Telegram receives one stable private file URL, never the mutable source path. */
export async function prepareTelegramSendFile(path: string): Promise<{
  file: TelegramSendFile
  dispose: () => Promise<void>
}> {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0'))
    throw new Error('请选择本地文件')
  const name = basename(path)
  if (!name || /[\x00-\x1f\x7f\\]/.test(name) || Buffer.byteLength(name) > 180)
    throw new Error('文件名包含不支持的字符或过长')
  const handle = await openRegularFile(path)
  let bytes: Buffer
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size < 1 || before.size > TELEGRAM_SEND_FILE_LIMIT)
      throw new Error('Telegram 文件须为非空文件且不超过 32 MiB')
    // Fixed budget even when the source grows during the read.
    const buffer = Buffer.alloc(before.size + 1)
    let count = 0
    while (count < buffer.length) {
      const result = await handle.read(buffer, count, buffer.length - count, count)
      if (!result.bytesRead) break
      count += result.bytesRead
    }
    const after = await handle.stat()
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      count !== before.size
    )
      throw new Error('文件读取期间发生变化')
    bytes = buffer.subarray(0, count)
  } finally {
    await handle.close()
  }
  const directory = await mkdtemp(join(tmpdir(), 'tracememo-telegram-file-'))
  try {
    const copy = join(directory, name)
    await writeFile(copy, bytes, { mode: 0o600, flag: 'wx' })
    return {
      file: {
        path: copy,
        name,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')
      },
      dispose: () => rm(directory, { recursive: true, force: true })
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}
