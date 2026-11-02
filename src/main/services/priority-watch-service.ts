import type { Message } from '../../shared/types'
import {
  isWatchedMessage,
  type PriorityWatchPage,
  type PriorityWatchRequest
} from '../../shared/priority-watch'

type ReadPage = (conversationId: string, endTime: number, limit: number) => Promise<Message[]>

/** Bounded scan: no full-history read and no skipping messages sharing a timestamp. */
export async function readPriorityWatchPage(
  request: PriorityWatchRequest,
  read: ReadPage
): Promise<PriorityWatchPage> {
  if (
    !request ||
    typeof request.conversationId !== 'string' ||
    !request.conversationId ||
    !Array.isArray(request.senderIds) ||
    !request.senderIds.length ||
    request.senderIds.length > 200 ||
    request.senderIds.some((id) => typeof id !== 'string' || !id || id.length > 256) ||
    (request.endTime !== undefined &&
      (!Number.isSafeInteger(request.endTime) || request.endTime <= 0))
  ) {
    throw new Error('关注查询参数无效')
  }
  const endTime = request.endTime ?? Math.floor(Date.now() / 1000)
  for (const limit of [500, 1000, 2000, 4000]) {
    const rows = await read(request.conversationId, endTime, limit)
    if (
      rows.some(
        (row) =>
          !Number.isSafeInteger(row.createTime) || row.createTime! <= 0 || row.createTime! > endTime
      )
    ) {
      throw new Error('消息时间异常，无法可靠分页')
    }
    const oldest = Math.min(...rows.map((row) => row.createTime!))
    const hasMore = rows.length >= limit
    // Exclude the oldest second as it may be partially read. Next request includes it.
    const complete = hasMore ? rows.filter((row) => row.createTime! > oldest) : rows
    if (hasMore && complete.length === 0) continue
    return {
      messages: complete
        .filter((row) => isWatchedMessage(row, request.senderIds))
        .sort((a, b) => b.createTime! - a.createTime! || b.id.localeCompare(a.id)),
      nextEndTime: hasMore ? oldest : null,
      scanned: complete.length
    }
  }
  throw new Error('同一秒消息过多，暂时无法继续分页；请到原聊天查看')
}
