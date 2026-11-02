import type { Message } from './types'

export type GroupAnalyticsRange = 'today' | '7days' | '30days' | '90days'

export const GROUP_ANALYTICS_RANGE_OPTIONS: Array<{
  value: GroupAnalyticsRange
  label: string
  days: number
}> = [
  { value: 'today', label: '今天', days: 1 },
  { value: '7days', label: '近 7 天', days: 7 },
  { value: '30days', label: '近 30 天', days: 30 },
  { value: '90days', label: '近 90 天', days: 90 }
]

export type GroupAnalyticsMessageType =
  | 'text'
  | 'image'
  | 'voice'
  | 'video'
  | 'file'
  | 'link'
  | 'sticker'
  | 'other'

export const GROUP_ANALYTICS_MESSAGE_TYPE_OPTIONS: Array<{
  value: GroupAnalyticsMessageType
  label: string
}> = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'voice', label: '语音' },
  { value: 'video', label: '视频' },
  { value: 'file', label: '文件' },
  { value: 'link', label: '链接' },
  { value: 'sticker', label: '表情' },
  { value: 'other', label: '其他' }
]

export interface GroupAnalyticsPeriod {
  range: GroupAnalyticsRange
  label: string
  days: number
  startMs: number
  endMs: number
  previousStartMs: number
  previousEndMs: number
}

export interface GroupAnalyticsMessageTypeStat {
  type: GroupAnalyticsMessageType
  label: string
  count: number
  percentage: number
}

export interface GroupAnalyticsDailyStat {
  date: string
  label: string
  count: number
  activeMembers: number
}

export interface GroupAnalyticsHourlyStat {
  hour: number
  count: number
}

export interface GroupAnalyticsWeekdayStat {
  weekday: number
  label: string
  hours: number[]
}

export interface GroupAnalyticsMemberStat {
  id: string
  name: string
  count: number
  share: number
  activeDays: number
  firstSeen: string
  lastSeen: string
}

export interface GroupAnalyticsMemberBucket {
  label: string
  min: number
  max: number | null
  members: number
  messages: number
}

export interface GroupAnalyticsPeriodMetrics {
  totalMessages: number
  activeMembers: number
  activeDays: number
  textCharacters: number
  averagePerDay: number
  topSender: string
}

export interface GroupAnalyticsComparison {
  totalMessages: { current: number; previous: number; changePercent: number | null }
  activeMembers: { current: number; previous: number; changePercent: number | null }
  activeDays: { current: number; previous: number; changePercent: number | null }
}

export interface GroupAnalyticsSnapshot {
  period: GroupAnalyticsPeriod
  generatedAt: number
  currentMemberCount: number
  activeRate: number | null
  peakHour: number | null
  metrics: GroupAnalyticsPeriodMetrics
  comparison: GroupAnalyticsComparison
  daily: GroupAnalyticsDailyStat[]
  hourly: GroupAnalyticsHourlyStat[]
  weekdayHours: GroupAnalyticsWeekdayStat[]
  messageTypes: GroupAnalyticsMessageTypeStat[]
  members: GroupAnalyticsMemberStat[]
  memberBuckets: GroupAnalyticsMemberBucket[]
}

export interface BuildGroupAnalyticsOptions {
  period: GroupAnalyticsPeriod
  selectedTypes?: GroupAnalyticsMessageType[]
  selectedMemberIds?: string[]
  memberNames?: Map<string, string> | Record<string, string>
  currentMemberCount?: number
  generatedAt?: number
}

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const TYPE_LABELS = Object.fromEntries(
  GROUP_ANALYTICS_MESSAGE_TYPE_OPTIONS.map((item) => [item.value, item.label])
) as Record<GroupAnalyticsMessageType, string>

const asNameMap = (
  names: Map<string, string> | Record<string, string> | undefined
): Map<string, string> => {
  if (names instanceof Map) return names
  return new Map(Object.entries(names || {}))
}

const addLocalDays = (date: Date, days: number): Date => {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

const startOfLocalDay = (value: number): Date => {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

export const buildGroupAnalyticsPeriod = (
  range: GroupAnalyticsRange,
  now = Date.now()
): GroupAnalyticsPeriod => {
  const option =
    GROUP_ANALYTICS_RANGE_OPTIONS.find((item) => item.value === range) ||
    GROUP_ANALYTICS_RANGE_OPTIONS[0]
  const end = addLocalDays(startOfLocalDay(now), 1)
  const start = addLocalDays(end, -option.days)
  const previousStart = addLocalDays(start, -option.days)
  return {
    range,
    label: option.label,
    days: option.days,
    startMs: start.getTime(),
    endMs: end.getTime(),
    previousStartMs: previousStart.getTime(),
    previousEndMs: start.getTime()
  }
}

export const messageTimestampMs = (message: Message): number => {
  const createTime = Number(message.createTime || 0)
  if (Number.isFinite(createTime) && createTime > 0) {
    return createTime > 10_000_000_000 ? createTime : createTime * 1000
  }
  const parsed = new Date(message.datetime).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

export const isAnalyticsSystemMessage = (message: Message): boolean =>
  message.from === 'system' || message.type === '系统消息' || message.contentData?.type === 'system'

export const resolveAnalyticsMessageType = (message: Message): GroupAnalyticsMessageType => {
  const contentType = message.contentData?.type
  if (contentType === 'image' || /图片/.test(message.type)) return 'image'
  if (contentType === 'voice' || /语音/.test(message.type)) return 'voice'
  if (contentType === 'video' || /视频/.test(message.type)) return 'video'
  if (contentType === 'sticker' || /表情|动画/.test(message.type)) return 'sticker'
  if (contentType === 'share' || /链接|分享|网页/.test(message.type)) return 'link'
  if (/文件|附件/.test(message.type)) return 'file'
  if (contentType === 'text' || /文本|文字/.test(message.type)) return 'text'
  if (message.type === '普通文本' || !message.type) return 'text'
  return 'other'
}

const formatDateKey = (value: number): string => {
  const date = new Date(value)
  return (
    String(date.getFullYear()) +
    '-' +
    String(date.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getDate()).padStart(2, '0')
  )
}

const formatDateLabel = (value: number): string => {
  const date = new Date(value)
  return String(date.getMonth() + 1) + '/' + String(date.getDate())
}

const dayIndexMondayFirst = (date: Date): number => (date.getDay() + 6) % 7

const memberKey = (message: Message): string => {
  const senderId = String(message.senderId || '').trim()
  if (senderId) return senderId
  if (message.isSender) return '__self__'
  const name = String(message.name || '').trim()
  if (name) return name
  const from = String(message.from || '').trim()
  return from || '__unknown__'
}

const memberName = (message: Message, id: string, names: Map<string, string>): string => {
  if (id === '__self__' || message.isSender) return '我'
  const candidates = [id, String(message.senderId || '').trim(), String(message.name || '').trim()]
  for (const candidate of candidates) {
    const mapped = candidate ? names.get(candidate)?.trim() : ''
    if (mapped) return mapped
  }
  return String(message.name || '').trim() || (id === '__unknown__' ? '未命名成员' : id)
}

const percentChange = (current: number, previous: number): number | null => {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

const buildMetrics = (
  messages: Array<{
    message: Message
    timestamp: number
    type: GroupAnalyticsMessageType
    id: string
    name: string
  }>,
  period: GroupAnalyticsPeriod
): GroupAnalyticsPeriodMetrics => {
  const activeDays = new Set(messages.map((item) => formatDateKey(item.timestamp))).size
  const members = new Map<string, number>()
  let textCharacters = 0
  for (const item of messages) {
    members.set(item.id, (members.get(item.id) || 0) + 1)
    if (item.type === 'text') textCharacters += String(item.message.content || '').trim().length
  }
  const top = [...members.entries()].sort((a, b) => b[1] - a[1])[0]
  const topItem = top ? messages.find((item) => item.id === top[0]) : undefined
  return {
    totalMessages: messages.length,
    activeMembers: members.size,
    activeDays,
    textCharacters,
    averagePerDay: period.days ? messages.length / period.days : 0,
    topSender: topItem?.name || ''
  }
}

const toIncludedMessages = (
  messages: Message[],
  startMs: number,
  endMs: number,
  selectedTypes: Set<GroupAnalyticsMessageType>,
  selectedMemberIds: Set<string>,
  names: Map<string, string>
): Array<{
  message: Message
  timestamp: number
  type: GroupAnalyticsMessageType
  id: string
  name: string
}> =>
  messages.flatMap((message) => {
    if (isAnalyticsSystemMessage(message)) return []
    const timestamp = messageTimestampMs(message)
    if (timestamp < startMs || timestamp >= endMs) return []
    const type = resolveAnalyticsMessageType(message)
    if (!selectedTypes.has(type)) return []
    const id = memberKey(message)
    if (selectedMemberIds.size && !selectedMemberIds.has(id)) return []
    return [{ message, timestamp, type, id, name: memberName(message, id, names) }]
  })

export const buildGroupAnalytics = (
  messages: Message[],
  options: BuildGroupAnalyticsOptions
): GroupAnalyticsSnapshot => {
  const names = asNameMap(options.memberNames)
  const selectedTypes = new Set(
    options.selectedTypes?.length
      ? options.selectedTypes
      : GROUP_ANALYTICS_MESSAGE_TYPE_OPTIONS.map((item) => item.value)
  )
  const selectedMemberIds = new Set(options.selectedMemberIds || [])
  const current = toIncludedMessages(
    messages,
    options.period.startMs,
    options.period.endMs,
    selectedTypes,
    selectedMemberIds,
    names
  )
  const previous = toIncludedMessages(
    messages,
    options.period.previousStartMs,
    options.period.previousEndMs,
    selectedTypes,
    selectedMemberIds,
    names
  )
  const metrics = buildMetrics(current, options.period)
  const previousMetrics = buildMetrics(previous, options.period)
  const daily = Array.from({ length: options.period.days }, (_, index) => {
    const timestamp = addLocalDays(new Date(options.period.startMs), index).getTime()
    const date = formatDateKey(timestamp)
    const items = current.filter((item) => formatDateKey(item.timestamp) === date)
    return {
      date,
      label: formatDateLabel(timestamp),
      count: items.length,
      activeMembers: new Set(items.map((item) => item.id)).size
    }
  })
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: current.filter((item) => new Date(item.timestamp).getHours() === hour).length
  }))
  const weekdayHours = WEEKDAY_LABELS.map((label, weekday) => ({
    weekday,
    label,
    hours: Array.from(
      { length: 24 },
      (_, hour) =>
        current.filter((item) => {
          const date = new Date(item.timestamp)
          return dayIndexMondayFirst(date) === weekday && date.getHours() === hour
        }).length
    )
  }))
  const typeCounts = new Map<GroupAnalyticsMessageType, number>()
  for (const item of current) typeCounts.set(item.type, (typeCounts.get(item.type) || 0) + 1)
  const messageTypes = GROUP_ANALYTICS_MESSAGE_TYPE_OPTIONS.map(({ value, label }) => {
    const count = typeCounts.get(value) || 0
    return {
      type: value,
      label,
      count,
      percentage: current.length ? count / current.length : 0
    }
  }).filter((item) => item.count > 0)

  const memberMap = new Map<string, { name: string; items: typeof current }>()
  for (const item of current) {
    const existing = memberMap.get(item.id)
    if (existing) existing.items.push(item)
    else memberMap.set(item.id, { name: item.name, items: [item] })
  }
  const members = [...memberMap.entries()]
    .map(([id, value]) => {
      const timestamps = value.items.map((item) => item.timestamp).sort((a, b) => a - b)
      return {
        id,
        name: value.name,
        count: value.items.length,
        share: current.length ? value.items.length / current.length : 0,
        activeDays: new Set(timestamps.map(formatDateKey)).size,
        firstSeen: timestamps.length ? formatDateKey(timestamps[0]) : '',
        lastSeen: timestamps.length ? formatDateKey(timestamps[timestamps.length - 1]) : ''
      }
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
  const bucketDefinitions: Array<{ label: string; min: number; max: number | null }> = [
    { label: '1 条', min: 1, max: 1 },
    { label: '2–5 条', min: 2, max: 5 },
    { label: '6–20 条', min: 6, max: 20 },
    { label: '21–50 条', min: 21, max: 50 },
    { label: '51–100 条', min: 51, max: 100 },
    { label: '101+ 条', min: 101, max: null }
  ]
  const memberBuckets = bucketDefinitions.map((bucket) => {
    const inBucket = members.filter(
      (member) => member.count >= bucket.min && (bucket.max === null || member.count <= bucket.max)
    )
    return {
      ...bucket,
      members: inBucket.length,
      messages: inBucket.reduce((sum, member) => sum + member.count, 0)
    }
  })
  const peak = hourly.reduce((best, item) => (item.count > best.count ? item : best), hourly[0])
  const activeMemberCount = options.currentMemberCount || 0
  return {
    period: options.period,
    generatedAt: options.generatedAt || Date.now(),
    currentMemberCount: activeMemberCount,
    activeRate: activeMemberCount ? metrics.activeMembers / activeMemberCount : null,
    peakHour: peak?.count ? peak.hour : null,
    metrics,
    comparison: {
      totalMessages: {
        current: metrics.totalMessages,
        previous: previousMetrics.totalMessages,
        changePercent: percentChange(metrics.totalMessages, previousMetrics.totalMessages)
      },
      activeMembers: {
        current: metrics.activeMembers,
        previous: previousMetrics.activeMembers,
        changePercent: percentChange(metrics.activeMembers, previousMetrics.activeMembers)
      },
      activeDays: {
        current: metrics.activeDays,
        previous: previousMetrics.activeDays,
        changePercent: percentChange(metrics.activeDays, previousMetrics.activeDays)
      }
    },
    daily,
    hourly,
    weekdayHours,
    messageTypes,
    members,
    memberBuckets
  }
}

export const groupAnalyticsTypeLabel = (type: GroupAnalyticsMessageType): string =>
  TYPE_LABELS[type]
