import type { Message, ParsedContent } from '../shared/types'
import { fMessageToContent, fMessageText } from '../shared/f-message'
import type { DatabasePort } from '../shared/database-port'

type DatabaseReader = Pick<DatabasePort, 'listFMessageItems'>

/** 好友申请只读服务：general.db / FMessageTable。 */
export class FMessageService {
  constructor(private readonly database: DatabaseReader) {}

  async listContents(limit = 200): Promise<ParsedContent[]> {
    const rows = await this.database.listFMessageItems(limit)
    return rows.map((row) => fMessageToContent(row) as ParsedContent)
  }

  async listExportMessages(limit = 200): Promise<Message[]> {
    const rows = await this.database.listFMessageItems(limit)
    return rows.map((row, index) => {
      const contentData = fMessageToContent(row) as ParsedContent
      const ts = Number(row.timestamp_) || 0
      return {
        id: `fmsg-${ts}-${index}`,
        from: 'system',
        type: '系统消息',
        datetime: ts ? new Date(ts * 1000).toISOString() : '',
        content: fMessageText(row),
        isSender: false,
        createTime: ts,
        name: '好友申请',
        contentData
      } as Message
    })
  }

  async searchHits(query: string, limit = 20): Promise<Array<{ text: string; timestamp?: number }>> {
    const needle = String(query || '').trim().toLowerCase()
    if (!needle) return []
    const rows = await this.database.listFMessageItems(500)
    return rows
      .map((row) => ({
        text: fMessageText(row),
        timestamp: Number(row.timestamp_) || undefined
      }))
      .filter((hit) => hit.text.toLowerCase().includes(needle))
      .slice(0, limit)
  }
}
