import type { Message, ParsedContent } from '../shared/types'
import {
  parseSnsMessageRow,
  parseSnsTimelineXml,
  snsPostDisplayText,
  snsRowToContent
} from '../shared/sns-timeline'
import type { SnsTimelineComment, SnsTimelinePost } from '../shared/sns-timeline'
import type { DatabasePort } from '../shared/database-port'

type DatabaseReader = Pick<DatabasePort, 'listSnsTimeline' | 'listSnsMessages'>

/** 朋友圈只读服务：sns.db → 可读卡片 / 导出消息。 */
export class SnsTimelineService {
  constructor(private readonly database: DatabaseReader) {}

  private async loadComments(): Promise<
    Map<string, { comments: SnsTimelineComment[]; likeCount: number }>
  > {
    const rows = await this.database.listSnsMessages(1000)
    const byFeed = new Map<string, { comments: SnsTimelineComment[]; likeCount: number }>()
    for (const row of rows) {
      const msg = parseSnsMessageRow(row)
      const key = String(msg.feedId ?? '')
      if (!key) continue
      const bucket = byFeed.get(key) || { comments: [], likeCount: 0 }
      if (msg.type === 1) bucket.likeCount += 1
      else if (msg.content && !msg.delStatus) bucket.comments.push(msg)
      byFeed.set(key, bucket)
    }
    return byFeed
  }

  private attach(row: Record<string, unknown>, byFeed: Map<string, { comments: SnsTimelineComment[]; likeCount: number }>): SnsTimelinePost {
    const content = String(row.content ?? '')
    const post = parseSnsTimelineXml(content)
    const tid = String(row.tid ?? post.tid ?? '')
    const extra = byFeed.get(tid)
    if (extra) {
      post.comments = extra.comments
      post.likeCount = extra.likeCount || undefined
    }
    return post
  }

  async listContents(limit = 200): Promise<ParsedContent[]> {
    const rows = await this.database.listSnsTimeline(limit)
    const byFeed = await this.loadComments()
    return rows.map((row) => {
      const post = this.attach(row, byFeed)
      const mapped = snsRowToContent({ ...row, content: String(row.content ?? '') }) as ParsedContent & {
        des?: string
        content?: string
      }
      const extra = snsPostDisplayText(post)
      if (mapped.type === 'text') mapped.content = extra
      else mapped.des = extra
      return mapped
    })
  }

  async listExportMessages(limit = 200): Promise<Message[]> {
    const rows = await this.database.listSnsTimeline(limit)
    const byFeed = await this.loadComments()
    return rows.map((row, index) => {
      const post = this.attach(row, byFeed)
      const contentData = snsRowToContent({ ...row, content: String(row.content ?? '') }) as ParsedContent & {
        des?: string
        content?: string
      }
      const display = snsPostDisplayText(post)
      if (contentData.type === 'text') contentData.content = display
      else contentData.des = display
      const createTime = post.createTime || 0
      return {
        id: `sns-${row.tid ?? index}`,
        from: 'sns',
        type: '朋友圈',
        datetime: createTime ? new Date(createTime * 1000).toISOString() : '',
        content: display,
        isSender: false,
        createTime,
        name: '朋友圈',
        contentData
      } as Message
    })
  }

  async searchHits(query: string, limit = 20): Promise<Array<{ text: string; timestamp?: number }>> {
    const needle = String(query || '').trim().toLowerCase()
    if (!needle) return []
    const rows = await this.database.listSnsTimeline(500)
    const byFeed = await this.loadComments()
    return rows
      .map((row) => {
        const post = this.attach(row, byFeed)
        return { text: snsPostDisplayText(post), timestamp: post.createTime }
      })
      .filter((hit) => hit.text.toLowerCase().includes(needle))
      .slice(0, limit)
  }
}
