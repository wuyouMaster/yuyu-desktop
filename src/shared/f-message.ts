/**
 * 好友申请（`general.db` / `FMessageTable`）只读解析。
 * 与 `local_type=37` 同域；不发送、不通过/拒绝。
 */

export type FMessageRecord = {
  userName?: string
  type?: number
  timestamp?: number
  content?: string
  isSender?: number
  scene?: number
  remark?: string
  labelIds?: string
}

export type FMessageDisplay = {
  type: 'system'
  content: string
  raw?: string
}

/** 场景文案（只读展示；未知原样）。 */
export function describeFMessageScene(scene?: number): string | undefined {
  const table: Record<string, string> = {
    '6': '附近的人',
    '14': '群聊',
    '15': '搜索/名片',
    '17': '面对面/其他',
    '30': '其他'
  }
  if (scene === undefined || scene === null) return undefined
  return table[String(scene)] || `场景 ${scene}`
}

export function parseFMessageRow(row: Record<string, unknown>): FMessageRecord {
  return {
    userName: row.user_name_ ? String(row.user_name_) : undefined,
    type: Number(row.type_) || undefined,
    timestamp: Number(row.timestamp_) || undefined,
    content: row.content_ ? String(row.content_) : undefined,
    isSender: Number(row.is_sender_) || 0,
    scene: Number(row.scene_) || undefined,
    remark: row.remark_ ? String(row.remark_) : undefined,
    labelIds: row.label_ids_ ? String(row.label_ids_) : undefined
  }
}

/** 好友申请 → system 文案（导出/搜索共用）。 */
export function fMessageToContent(row: Record<string, unknown>): FMessageDisplay {
  const rec = parseFMessageRow(row)
  const direction = rec.isSender ? '你发出的好友申请' : '收到的好友申请'
  const scene = describeFMessageScene(rec.scene)
  const who = rec.remark || rec.userName || '对方'
  const text = rec.content ? `：${rec.content}` : ''
  const parts = [direction, who, scene].filter(Boolean)
  return {
    type: 'system',
    content: `${parts.join(' · ')}${text}`,
    raw: rec.content
  }
}

export function fMessageText(row: Record<string, unknown>): string {
  return fMessageToContent(row).content
}
