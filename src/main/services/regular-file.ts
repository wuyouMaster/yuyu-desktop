import { constants, promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'

/** O_NOFOLLOW is unavailable on Windows. Check the path and opened identity as well. */
export async function openRegularFile(path: string): Promise<FileHandle> {
  const before = await fs.lstat(path, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Expected a regular file')
  const handle = await fs.open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
  )
  try {
    const opened = await handle.stat({ bigint: true })
    const current = await fs.lstat(path, { bigint: true })
    if (
      !opened.isFile() ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino
    )
      throw new Error('File identity changed while opening')
    return handle
  } catch (error) {
    await handle.close()
    throw error
  }
}
