import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { openRegularFile } from './regular-file'

export interface TelegramSendImage {
  path: string
  sha256: string
  width: number
  height: number
}

/** A private stable copy, so Telegram never uploads a mutable user file by path. */
export async function prepareTelegramSendImage(path: string): Promise<{
  image: TelegramSendImage
  dispose: () => Promise<void>
}> {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0'))
    throw new Error('请选择本地 PNG 图片')
  const handle = await openRegularFile(path)
  let bytes: Buffer
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size < 33 || before.size > 5 * 1024 * 1024)
      throw new Error('Telegram 图片须为 5 MiB 以内的 PNG')
    bytes = await handle.readFile()
    const after = await handle.stat()
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      bytes.length !== before.size
    )
      throw new Error('图片读取期间发生变化')
  } finally {
    await handle.close()
  }
  // Native ImageIO additionally verifies format, frame count and decodability.
  if (
    !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw new Error('Telegram 当前图片发送仅支持 PNG')
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20)
  if (width < 1 || height < 1 || width > 1280 || height > 1280)
    throw new Error('Telegram 当前图片发送支持宽高不超过 1280 像素的 PNG')
  const directory = await mkdtemp(join(tmpdir(), 'yuyu-telegram-image-'))
  try {
    const copy = join(directory, 'image.png')
    await writeFile(copy, bytes, { mode: 0o600, flag: 'wx' })
    return {
      image: {
        path: copy,
        width,
        height,
        sha256: createHash('sha256').update(bytes).digest('hex')
      },
      dispose: () => rm(directory, { recursive: true, force: true })
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}
