/**
 * 朋友圈时间线（`sns.db` / `SnsTimeLine.content`）只读解析。
 * XML 形态：`<SnsDataItem><TimelineObject><id/><username/><createTime/><contentDesc/>…`
 * 不做点赞/评论/发送。
 */

export type SnsTimelineRecord = {
  tid?: string | number
  userName?: string
  createTime?: number
  content?: string | null
  packInfo?: string | null
}

export type SnsTimelinePost = {
  tid?: string | number
  username?: string
  createTime?: number
  /** 正文（`contentDesc`）。 */
  text?: string
  /** 摘要/第二段（`ContentObject.description` 等）。 */
  description?: string
  mediaCount?: number
  /** 分享外链（`ContentObject.contentUrl`；**不是**媒体 CDN `media/url`）。 */
  url?: string
  /** 卡片标题（`ContentObject.title`）。 */
  title?: string
  /** 最大 `videoDuration`（>0 表示视频/小视频）。 */
  videoDuration?: number
  /** 视频号名片（`finderFeed`）。 */
  finder?: {
    nickname?: string
    desc?: string
    objectId?: string
    feedType?: string
  }
  raw?: string
  /** `SnsMessage_tmp3` 评论（type=2）。 */
  comments?: SnsTimelineComment[]
  /** 点赞数（type=1）。 */
  likeCount?: number
}

/** `SnsMessage_tmp3` 单条（只读；type 1=赞，2=评论）。 */
export type SnsTimelineComment = {
  type?: number
  feedId?: string | number
  fromNickname?: string
  toNickname?: string
  content?: string
  createTime?: number
  delStatus?: number
}

function xmlValue(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml)
  const raw = match?.[1]?.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim()
  return raw || undefined
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export function parseSnsTimelineXml(content: string | null | undefined): SnsTimelinePost {
  const xml = String(content || '')
  const createTime = Number(xmlValue(xml, 'createTime'))
  const objectBody = /<ContentObject>([\s\S]*?)<\/ContentObject>/i.exec(xml)?.[1] || ''
  const mediaCount = (objectBody.match(/<media[\s>]/gi) || []).length ||
    Number(xmlValue(xml, 'mediaCount') || xmlValue(objectBody, 'mediaCount') || '') ||
    undefined
  const videoDurations = (objectBody.match(/<videoDuration>(\d+)<\/videoDuration>/gi) || [])
    .map((tag) => Number(/\d+/.exec(tag)?.[0] || 0))
  const videoDuration = videoDurations.length ? Math.max(...videoDurations) : undefined
  const finderBody = /<finderFeed>([\s\S]*?)<\/finderFeed>/i.exec(xml)?.[1] || ''
  return {
    tid: xmlValue(xml, 'id'),
    username: xmlValue(xml, 'username'),
    createTime: Number.isFinite(createTime) ? createTime : undefined,
    text: decodeXmlEntities(xmlValue(xml, 'contentDesc') || xmlValue(xml, 'contentdesc') || ''),
    description: decodeXmlEntities(
      xmlValue(objectBody, 'description') ||
      xmlValue(xml, 'contentDescShow') ||
      ''
    ) || undefined,
    title: decodeXmlEntities(xmlValue(objectBody, 'title') || '') || undefined,
    mediaCount: mediaCount || undefined,
    videoDuration: videoDuration || undefined,
    // 只取 ContentObject.contentUrl；media/url 是 CDN，不能当外链。
    url: decodeXmlEntities(xmlValue(objectBody, 'contentUrl') || xmlValue(xml, 'contentUrl') || '') ||
      undefined,
    finder: finderBody
      ? {
          nickname: decodeXmlEntities(xmlValue(finderBody, 'nickname') || '') || undefined,
          desc: decodeXmlEntities(xmlValue(finderBody, 'desc') || '') || undefined,
          objectId: xmlValue(finderBody, 'objectId'),
          feedType: xmlValue(finderBody, 'feedType')
        }
      : undefined,
    raw: xml
  }
}

/** `SnsTimeLine` 行 → 可读 text/share（导出与搜索共用）。 */
export function snsRowToContent(row: SnsTimelineRecord): {
  type: 'text' | 'share'
  content?: string
  title?: string
  des?: string
  url?: string
  appname?: string
  typeVal?: string
} {
  const post = parseSnsTimelineXml(row.content)
  const text = post.text || ''
  const mediaNote = post.mediaCount && post.mediaCount > 1 ? `（${post.mediaCount} 图）` : ''
  const videoNote = post.videoDuration ? `（视频 ${post.videoDuration}s）` : ''
  if (post.finder) {
    return {
      type: 'share',
      title: post.finder.nickname || post.title || text.slice(0, 80) || '视频号',
      des: [post.finder.desc || post.description || text, mediaNote + videoNote]
        .filter(Boolean)
        .join(' · ') || undefined,
      url: post.url,
      appname: '视频号',
      typeVal: 'sns-finder'
    }
  }
  if (post.url) {
    return {
      type: 'share',
      title: post.title || text.slice(0, 80) || '朋友圈',
      des: post.description || text.slice(80, 200) || undefined,
      url: post.url,
      appname: '朋友圈',
      typeVal: 'sns'
    }
  }
  const suffix = [mediaNote, videoNote].filter(Boolean).join('')
  return {
    type: 'text',
    content: (text || '[朋友圈]') + suffix
  }
}

export function snsTextOf(row: SnsTimelineRecord): string {
  const mapped = snsRowToContent(row)
  return mapped.type === 'text' ? mapped.content || '' : mapped.title || ''
}

/** `SnsMessage_tmp3` 行 → 评论/赞。 */
export function parseSnsMessageRow(row: Record<string, unknown>): SnsTimelineComment {
  const type = Number(row.type)
  return {
    type: Number.isFinite(type) ? type : undefined,
    feedId: (row.feed_id ?? row.feedId) as string | number | undefined,
    fromNickname: row.from_nickname ? String(row.from_nickname) : undefined,
    toNickname: row.to_nickname ? String(row.to_nickname) : undefined,
    content: row.content ? String(row.content) : undefined,
    createTime: Number(row.create_time) || undefined,
    delStatus: Number(row.del_status) || 0
  }
}

/** 正文 + 评论摘要，便于导出/搜索。 */
export function snsPostDisplayText(post: SnsTimelinePost): string {
  const comments = (post.comments || [])
    .filter((c) => (c.type ?? 2) === 2 && c.content && !c.delStatus)
    .slice(0, 8)
    .map((c) => `${c.fromNickname || '朋友'}：${c.content}`)
  const like = post.likeCount ? `（${post.likeCount} 赞）` : ''
  const head = post.text || '[朋友圈]'
  return comments.length ? `${head}${like}\n${comments.join('\n')}` : `${head}${like}`
}
