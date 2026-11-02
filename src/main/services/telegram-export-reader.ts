import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { promises as fsPromises } from 'node:fs'
import { parseTelegramExport, type TelegramExportDocument } from '../../shared/telegram-export'

export class TelegramExportReader {
  async read(filePath: string): Promise<TelegramExportDocument> {
    const sourceFileName = basename(filePath)
    let content: string
    try {
      content = await fsPromises.readFile(filePath, 'utf8')
    } catch {
      throw new Error('无法读取 Telegram 导出文件')
    }
    let value: unknown
    try {
      value = JSON.parse(content)
    } catch {
      throw new Error('Telegram 导出文件不是有效 JSON')
    }
    const accountKey = createHash('sha256')
      .update(sourceFileName + '\0' + content)
      .digest('hex')
      .slice(0, 24)
    return parseTelegramExport(value, 'telegram-' + accountKey, sourceFileName)
  }
}
