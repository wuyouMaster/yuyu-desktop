import React from 'react'
import { createPortal } from 'react-dom'
import type { Contact, Message } from '../../../../shared/types'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar
} from 'recharts'
import {
  buildGroupAnalytics,
  buildGroupAnalyticsPeriod,
  GROUP_ANALYTICS_MESSAGE_TYPE_OPTIONS,
  GROUP_ANALYTICS_RANGE_OPTIONS,
  type GroupAnalyticsPeriod,
  type GroupAnalyticsMessageType,
  type GroupAnalyticsRange,
  type GroupAnalyticsSnapshot,
  type GroupAnalyticsDailyStat,
  type GroupAnalyticsMessageTypeStat
} from '../../../../shared/group-analytics'
import { AccountSummaryFooter } from '../../components/account/AccountSummary'
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from '../../components/ui'
import { listMessagesForContact } from '../../utils/unified-entity-adapter'

interface GroupSnapshotMember {
  wxid?: string
  nickname?: string
  groupNickname?: string
  wechatNickname?: string
  remark?: string
  avatar?: string
}

interface GroupSnapshot {
  memberCount?: number
  members?: GroupSnapshotMember[]
}

interface SelfInfo {
  wxid: string
  nickname: string
  avatar?: string
  accountRoot: string
}

interface GroupAnalyticsWorkspaceProps {
  contacts: Contact[]
  initialContact: Contact | null
  selfInfo: SelfInfo | null
  dbReady: boolean
  dbConnecting?: boolean
  onOpenSettings: () => void
  onContactSelected?: (contact: Contact) => void
}

type LoadState = 'idle' | 'loading' | 'success' | 'error'

interface GroupAnalyticsSource {
  contactMd5: string
  messages: Message[]
  options: {
    period: GroupAnalyticsPeriod
    selectedTypes: GroupAnalyticsMessageType[]
    memberNames: Map<string, string>
    currentMemberCount: number
  }
}

const ALL_TYPES = GROUP_ANALYTICS_MESSAGE_TYPE_OPTIONS.map((item) => item.value)
const numberFormatter = new Intl.NumberFormat('zh-CN')
const MEMBER_PAGE_SIZE_OPTIONS = [10, 20, 50]
const MESSAGE_TYPE_CHART_COLORS: Record<GroupAnalyticsMessageType, string> = {
  text: 'var(--yuyu-ui-chart-text)',
  image: 'var(--yuyu-ui-chart-image)',
  voice: 'var(--yuyu-ui-chart-voice)',
  video: 'var(--yuyu-ui-chart-video)',
  file: 'var(--yuyu-ui-chart-file)',
  link: 'var(--yuyu-ui-chart-link)',
  sticker: 'var(--yuyu-ui-chart-sticker)',
  other: 'var(--yuyu-ui-chart-other)'
}

type MemberSortKey = 'count' | 'share' | 'activeDays' | 'firstSeen' | 'lastSeen'
type SortDirection = 'asc' | 'desc'

function MemberFilter({
  options,
  value,
  disabled,
  onChange
}: {
  options: Array<{ id: string; name: string }>
  value: string
  disabled: boolean
  onChange: (value: string) => void
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [triggerWidth, setTriggerWidth] = React.useState<number | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const selectedName = options.find((member) => member.id === value)?.name || '全部成员'
  const normalizedQuery = query.trim().toLowerCase()
  const filteredOptions = normalizedQuery
    ? options.filter((member) => member.name.toLowerCase().includes(normalizedQuery))
    : options

  React.useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  React.useEffect(() => {
    const trigger = triggerRef.current
    if (!trigger) return

    const updateWidth = (): void => {
      setTriggerWidth(Math.round(trigger.getBoundingClientRect().width))
    }

    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(trigger)
    return () => observer.disconnect()
  }, [])

  const selectMember = (memberId: string): void => {
    onChange(memberId)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          className="group-analytics-member-trigger"
          aria-label="指定成员"
          aria-expanded={open}
          disabled={disabled}
        >
          <span className="group-analytics-member-trigger-label">{selectedName}</span>
          <span
            aria-hidden
            className={`group-analytics-member-trigger-icon${open ? ' is-open' : ''}`}
          >
            <svg viewBox="0 0 20 20" focusable="false">
              <path d="m5.5 7.5 4.5 4.5 4.5-4.5" />
            </svg>
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="group-analytics-member-menu"
        align="end"
        collisionPadding={12}
        style={triggerWidth ? { width: triggerWidth + 'px' } : undefined}
        aria-label="指定成员列表"
      >
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索成员"
          aria-label="搜索成员"
          className="group-analytics-member-search"
        />
        <div className="group-analytics-member-options" role="listbox" aria-label="成员选项">
          <Button
            type="button"
            variant="ghost"
            role="option"
            aria-selected={!value}
            className="group-analytics-member-option"
            onClick={() => selectMember('')}
          >
            <span>全部成员</span>
            {!value ? <span aria-hidden>✓</span> : null}
          </Button>
          {filteredOptions.length ? (
            filteredOptions.map((member) => (
              <Button
                key={member.id}
                type="button"
                variant="ghost"
                role="option"
                aria-selected={member.id === value}
                className="group-analytics-member-option"
                onClick={() => selectMember(member.id)}
                title={member.name}
              >
                <span>{member.name}</span>
                {member.id === value ? <span aria-hidden>✓</span> : null}
              </Button>
            ))
          ) : (
            <span className="group-analytics-member-no-results">没有匹配的成员</span>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const displayContactName = (contact: Contact): string =>
  contact.m_nsNickName?.trim() || contact.remark?.trim() || contact.m_nsUsrName || '未命名群聊'

const memberDisplayName = (member: GroupSnapshotMember): string =>
  member.groupNickname?.trim() ||
  member.nickname?.trim() ||
  member.remark?.trim() ||
  member.wechatNickname?.trim() ||
  member.wxid?.trim() ||
  '未命名成员'

const normalizeSnapshot = (value: unknown): GroupSnapshot | null => {
  if (!value || typeof value !== 'object') return null
  const candidate = value as GroupSnapshot
  return {
    memberCount: Number(candidate.memberCount || 0),
    members: Array.isArray(candidate.members) ? candidate.members : []
  }
}

const formatNumber = (value: number): string => numberFormatter.format(Math.round(value))

const formatPercent = (value: number | null, digits = 0): string =>
  value === null || !Number.isFinite(value) ? '—' : (value * 100).toFixed(digits) + '%'

const formatChange = (value: number | null): string => {
  if (value === null) return '暂无上周期数据'
  if (value === 0) return '与上周期持平'
  return (value > 0 ? '较上周期 +' : '较上周期 ') + value.toFixed(0) + '%'
}

const formatHour = (hour: number | null): string =>
  hour === null ? '—' : String(hour).padStart(2, '0') + ':00'

function EmptyChart({ label }: { label: string }): React.ReactElement {
  return <div className="group-analytics-chart-empty">{label}</div>
}

function TrendActiveDot(props: { cx?: number; cy?: number }): React.ReactElement | null {
  const { cx, cy } = props
  if (typeof cx !== 'number' || typeof cy !== 'number') return null
  return (
    <g className="group-analytics-active-dot">
      <circle
        cx={cx}
        cy={cy}
        r={5}
        fill="var(--yuyu-ui-glass-elevated)"
        stroke="var(--yuyu-ui-chart-trend)"
        strokeWidth={2}
      />
    </g>
  )
}

function TrendTooltip({
  active,
  payload,
  label
}: {
  active?: boolean
  payload?: Array<{ value?: number | string; payload?: GroupAnalyticsDailyStat }>
  label?: string
}): React.ReactElement | null {
  if (!active || !payload?.length || payload[0].value === undefined) return null
  const item = payload[0].payload
  const count = Number(payload[0].value)
  const dateText = item?.date || label
  const dayText = item?.label || ''

  return (
    <div className="group-analytics-trend-tooltip">
      <div className="group-analytics-trend-tooltip-top">
        <span className="group-analytics-trend-tooltip-date">{dateText}</span>
        {dayText && <span className="group-analytics-trend-tooltip-day">{dayText}</span>}
      </div>
      <div className="group-analytics-trend-tooltip-main">
        <span className="group-analytics-trend-tooltip-beacon" />
        <span className="group-analytics-trend-tooltip-count">{formatNumber(count)}</span>
        <span className="group-analytics-trend-tooltip-unit">条消息</span>
      </div>
    </div>
  )
}

function TrendChart({ analytics }: { analytics: GroupAnalyticsSnapshot }): React.ReactElement {
  const hasData = analytics.daily.some((item) => item.count > 0)

  if (!hasData) {
    return <EmptyChart label="当前筛选条件下没有消息" />
  }

  return (
    <div className="group-analytics-trend-chart">
      <ResponsiveContainer width="100%" height={230}>
        <AreaChart data={analytics.daily} margin={{ top: 16, right: 12, left: -22, bottom: 4 }}>
          <defs>
            <linearGradient id="group-analytics-trend-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--yuyu-ui-chart-trend)" stopOpacity={0.12} />
              <stop offset="100%" stopColor="var(--yuyu-ui-chart-trend)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="2 4"
            vertical={false}
            stroke="color-mix(in srgb, var(--yuyu-ui-border) 55%, transparent)"
          />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{
              fill: 'var(--yuyu-ui-text-muted)',
              fontSize: 10,
              fontFamily: 'var(--yuyu-ui-font)'
            }}
            dy={7}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{
              fill: 'var(--yuyu-ui-text-muted)',
              fontSize: 10,
              fontFamily: 'var(--yuyu-ui-font)'
            }}
            allowDecimals={false}
            tickCount={4}
            dx={-2}
          />
          <RechartsTooltip
            content={<TrendTooltip />}
            cursor={{
              stroke: 'color-mix(in srgb, var(--yuyu-ui-chart-trend) 35%, transparent)',
              strokeWidth: 1,
              strokeDasharray: '3 3'
            }}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke="var(--yuyu-ui-chart-trend)"
            strokeWidth={2}
            fill="url(#group-analytics-trend-gradient)"
            isAnimationActive={false}
            activeDot={<TrendActiveDot />}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function MessageTypeTooltip({
  active,
  payload
}: {
  active?: boolean
  payload?: Array<{ payload: GroupAnalyticsMessageTypeStat }>
}): React.ReactElement | null {
  if (!active || !payload?.length) return null
  const item = payload[0].payload
  const color = MESSAGE_TYPE_CHART_COLORS[item.type] || 'var(--yuyu-ui-chart-other)'
  return (
    <div className="group-analytics-chart-tooltip">
      <div className="group-analytics-chart-tooltip-header">{item.label}消息</div>
      <div className="group-analytics-chart-tooltip-body">
        <span className="group-analytics-chart-tooltip-indicator" style={{ background: color }} />
        <strong className="group-analytics-chart-tooltip-value">{formatNumber(item.count)}</strong>
        <span className="group-analytics-chart-tooltip-unit">
          条 ({formatPercent(item.percentage, 1)})
        </span>
      </div>
    </div>
  )
}

function MessageTypeChart({
  analytics
}: {
  analytics: GroupAnalyticsSnapshot
}): React.ReactElement {
  const total = analytics.messageTypes.reduce((sum, item) => sum + item.count, 0)
  const sortedTypes = React.useMemo(() => {
    return [...analytics.messageTypes]
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count || b.percentage - a.percentage)
  }, [analytics.messageTypes])

  if (!total || sortedTypes.length === 0) {
    return <EmptyChart label="没有可展示的消息类型" />
  }

  return (
    <div className="group-analytics-type-chart">
      <div className="group-analytics-donut-container">
        <ResponsiveContainer width={140} height={140}>
          <PieChart>
            <Pie
              data={sortedTypes}
              dataKey="count"
              nameKey="label"
              cx="50%"
              cy="50%"
              startAngle={90}
              endAngle={-270}
              innerRadius={38}
              outerRadius={60}
              paddingAngle={sortedTypes.length > 1 ? 2.5 : 0}
              cornerRadius={3}
              stroke="var(--yuyu-ui-glass-elevated)"
              strokeWidth={1.5}
              isAnimationActive={false}
            >
              {sortedTypes.map((item) => (
                <Cell
                  key={item.type}
                  fill={MESSAGE_TYPE_CHART_COLORS[item.type] || 'var(--yuyu-ui-chart-other)'}
                />
              ))}
            </Pie>
            <RechartsTooltip content={<MessageTypeTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="group-analytics-donut-center" aria-hidden="true">
          <strong>{formatNumber(total)}</strong>
          <span>条消息</span>
        </div>
      </div>
      <div className="group-analytics-legend">
        {sortedTypes.map((item) => (
          <div key={item.type} className="group-analytics-legend-row">
            <span
              className="group-analytics-legend-dot"
              style={{ background: MESSAGE_TYPE_CHART_COLORS[item.type] }}
            />
            <span>{item.label}</span>
            <b>{formatPercent(item.percentage, 1)}</b>
            <em>{formatNumber(item.count)}</em>
          </div>
        ))}
      </div>
    </div>
  )
}

interface HeatmapHoverInfo {
  weekdayLabel: string
  hour: number
  count: number
  x: number
  y: number
}

function Heatmap({ analytics }: { analytics: GroupAnalyticsSnapshot }): React.ReactElement {
  const max = Math.max(1, ...analytics.weekdayHours.flatMap((item) => item.hours))
  const [hovered, setHovered] = React.useState<HeatmapHoverInfo | null>(null)

  React.useEffect(() => {
    if (!hovered) return
    const handleScroll = (): void => setHovered(null)
    window.addEventListener('scroll', handleScroll, true)
    return () => window.removeEventListener('scroll', handleScroll, true)
  }, [hovered])

  return (
    <div className="group-analytics-heatmap-wrap" onScroll={() => setHovered(null)}>
      <div className="group-analytics-heatmap-hours" aria-hidden="true">
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour}>{hour % 3 === 0 ? hour : ''}</span>
        ))}
      </div>
      <div className="group-analytics-heatmap" onMouseLeave={() => setHovered(null)}>
        {analytics.weekdayHours.map((row) => (
          <React.Fragment key={row.weekday}>
            <span className="group-analytics-heatmap-label">{row.label}</span>
            {row.hours.map((count, hour) => {
              const timeRangeText = `${String(hour).padStart(2, '0')}:00 - ${String((hour + 1) % 24).padStart(2, '0')}:00`
              return (
                <span
                  key={row.weekday + '-' + hour}
                  className="group-analytics-heat-cell"
                  style={
                    { '--heat': count ? 0.12 + (count / max) * 0.88 : 0.035 } as React.CSSProperties
                  }
                  title={`${row.label} ${timeRangeText}：${formatNumber(count)} 条`}
                  aria-label={`${row.label} ${timeRangeText}：${formatNumber(count)} 条`}
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    setHovered({
                      weekdayLabel: row.label,
                      hour,
                      count,
                      x: rect.left + rect.width / 2,
                      y: rect.top
                    })
                  }}
                />
              )
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="group-analytics-heatmap-scale">
        <span>少</span>
        <i />
        <i />
        <i />
        <i />
        <span>多</span>
      </div>

      {hovered &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="group-analytics-chart-tooltip"
            style={{
              position: 'fixed',
              left: Math.max(70, Math.min(window.innerWidth - 70, hovered.x)),
              top: hovered.y < 70 ? hovered.y + 34 : hovered.y - 8,
              transform: hovered.y < 70 ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
              pointerEvents: 'none',
              zIndex: 9999
            }}
          >
            <div className="group-analytics-chart-tooltip-header">
              {hovered.weekdayLabel} {String(hovered.hour).padStart(2, '0')}:00 -{' '}
              {String((hovered.hour + 1) % 24).padStart(2, '0')}:00
            </div>
            <div className="group-analytics-chart-tooltip-body">
              <span
                className="group-analytics-chart-tooltip-indicator"
                style={{
                  background: hovered.count ? 'var(--yuyu-ui-brand)' : 'var(--yuyu-ui-text-muted)'
                }}
              />
              <strong className="group-analytics-chart-tooltip-value">
                {formatNumber(hovered.count)}
              </strong>
              <span className="group-analytics-chart-tooltip-unit">条消息</span>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}

function RankingChart({ analytics }: { analytics: GroupAnalyticsSnapshot }): React.ReactElement {
  const members = analytics.members.slice(0, 8)
  const max = Math.max(1, ...members.map((member) => member.count))
  return (
    <div className="group-analytics-ranking">
      {members.length ? (
        members.map((member, index) => (
          <div key={member.id} className="group-analytics-ranking-row">
            <span className="group-analytics-ranking-index">{index + 1}</span>
            <span className="group-analytics-ranking-name" title={member.name}>
              {member.name}
            </span>
            <span className="group-analytics-ranking-track">
              <i style={{ width: (member.count / max) * 100 + '%' }} />
            </span>
            <b>{formatNumber(member.count)}</b>
          </div>
        ))
      ) : (
        <EmptyChart label="当前筛选条件下没有活跃成员" />
      )}
    </div>
  )
}

function DistributionTooltip({
  active,
  payload,
  label
}: {
  active?: boolean
  payload?: Array<{ value?: number | string }>
  label?: string
}): React.ReactElement | null {
  if (!active || !payload?.length || payload[0].value === undefined) return null
  const count = Number(payload[0].value)
  return (
    <div className="group-analytics-chart-tooltip">
      <div className="group-analytics-chart-tooltip-header">发言 {label}</div>
      <div className="group-analytics-chart-tooltip-body">
        <span
          className="group-analytics-chart-tooltip-indicator"
          style={{ background: 'var(--yuyu-ui-brand)' }}
        />
        <span className="group-analytics-chart-tooltip-label">成员数</span>
        <strong className="group-analytics-chart-tooltip-value">{formatNumber(count)}</strong>
        <span className="group-analytics-chart-tooltip-unit">位</span>
      </div>
    </div>
  )
}

function DistributionChart({
  analytics
}: {
  analytics: GroupAnalyticsSnapshot
}): React.ReactElement {
  const hasData = analytics.memberBuckets.some((bucket) => bucket.members > 0)

  if (!hasData) {
    return <EmptyChart label="当前筛选条件下没有成员分布数据" />
  }

  return (
    <div className="group-analytics-distribution-chart">
      <ResponsiveContainer width="100%" height={190}>
        <BarChart
          data={analytics.memberBuckets}
          margin={{ top: 20, right: 14, left: -22, bottom: 4 }}
        >
          <CartesianGrid
            strokeDasharray="3 4"
            vertical={false}
            stroke="color-mix(in srgb, var(--yuyu-ui-text-muted) 16%, transparent)"
          />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{
              fill: 'var(--yuyu-ui-text-muted)',
              fontSize: 10,
              fontFamily: 'var(--yuyu-ui-font)'
            }}
            dy={6}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{
              fill: 'var(--yuyu-ui-text-muted)',
              fontSize: 10,
              fontFamily: 'var(--yuyu-ui-font)'
            }}
            allowDecimals={false}
            dx={-2}
          />
          <RechartsTooltip
            cursor={{ fill: 'rgba(102, 123, 165, 0.07)' }}
            content={<DistributionTooltip />}
          />
          <Bar
            dataKey="members"
            fill="var(--yuyu-ui-brand)"
            radius={[4, 4, 0, 0]}
            maxBarSize={44}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function MemberDetailsTable({
  analytics
}: {
  analytics: GroupAnalyticsSnapshot
}): React.ReactElement {
  const [sortKey, setSortKey] = React.useState<MemberSortKey>('count')
  const [sortDirection, setSortDirection] = React.useState<SortDirection>('desc')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(MEMBER_PAGE_SIZE_OPTIONS[0])
  const safePageSize = MEMBER_PAGE_SIZE_OPTIONS.includes(pageSize)
    ? pageSize
    : MEMBER_PAGE_SIZE_OPTIONS[0]

  const sortedMembers = React.useMemo(() => {
    const compare = (
      left: GroupAnalyticsSnapshot['members'][number],
      right: GroupAnalyticsSnapshot['members'][number]
    ): number => {
      const leftValue = left[sortKey]
      const rightValue = right[sortKey]
      const result =
        typeof leftValue === 'number' && typeof rightValue === 'number'
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue), 'zh-CN')
      return result || left.name.localeCompare(right.name, 'zh-CN')
    }
    const direction = sortDirection === 'asc' ? 1 : -1
    return [...analytics.members].sort((left, right) => direction * compare(left, right))
  }, [analytics.members, sortDirection, sortKey])

  const pageCount = Math.max(1, Math.ceil(sortedMembers.length / safePageSize))
  const safePage = Math.min(page, pageCount)
  const visibleMembers = sortedMembers.slice((safePage - 1) * safePageSize, safePage * safePageSize)

  React.useEffect(() => {
    setPage(1)
  }, [analytics.generatedAt, safePageSize, sortDirection, sortKey])

  React.useEffect(() => {
    if (pageSize !== safePageSize) setPageSize(safePageSize)
  }, [pageSize, safePageSize])

  React.useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const changeSort = (key: MemberSortKey): void => {
    setPage(1)
    if (key === sortKey) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDirection('desc')
  }

  const sortIndicator = (key: MemberSortKey): 'asc' | 'desc' | 'none' => {
    if (key !== sortKey) return 'none'
    return sortDirection
  }

  const sortAria = (key: MemberSortKey): 'ascending' | 'descending' | 'none' =>
    key === sortKey ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'

  const sortableHeader = (key: MemberSortKey, label: string): React.ReactElement => (
    <th scope="col" aria-sort={sortAria(key)}>
      <button
        type="button"
        className="group-analytics-sort-button"
        onClick={() => changeSort(key)}
        aria-label={'按' + label + '排序'}
      >
        <span>{label}</span>
        <i aria-hidden="true" className="group-analytics-sort-icon">
          <svg viewBox="0 0 16 16" focusable="false">
            <path
              d={
                sortIndicator(key) === 'asc'
                  ? 'm4 10 4-4 4 4'
                  : sortIndicator(key) === 'desc'
                    ? 'm4 6 4 4 4-4'
                    : 'm4 6 4-4 4 4M4 10l4 4 4-4'
              }
            />
          </svg>
        </i>
      </button>
    </th>
  )

  const firstVisible = sortedMembers.length ? (safePage - 1) * safePageSize + 1 : 0
  const lastVisible = Math.min(safePage * safePageSize, sortedMembers.length)

  return (
    <>
      <div className="group-analytics-table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">成员</th>
              {sortableHeader('count', '消息数')}
              {sortableHeader('share', '消息占比')}
              {sortableHeader('activeDays', '活跃天数')}
              {sortableHeader('firstSeen', '首次发言')}
              {sortableHeader('lastSeen', '最近发言')}
            </tr>
          </thead>
          <tbody>
            {visibleMembers.map((member) => (
              <tr key={member.id}>
                <td>
                  <span className="group-analytics-member-name">
                    <i>{member.name.slice(0, 1)}</i>
                    {member.name}
                  </span>
                </td>
                <td>{formatNumber(member.count)}</td>
                <td>{formatPercent(member.share, 1)}</td>
                <td>{formatNumber(member.activeDays)}</td>
                <td>{member.firstSeen || '—'}</td>
                <td>{member.lastSeen || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="group-analytics-table-pagination">
        <span>
          显示 {firstVisible}–{lastVisible} / {formatNumber(sortedMembers.length)} 位成员
        </span>
        <div className="group-analytics-table-pagination-controls">
          <button
            type="button"
            className="group-analytics-table-page-button"
            disabled={safePage <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            上一页
          </button>
          <span>
            第 {safePage} / {pageCount} 页
          </span>
          <button
            type="button"
            className="group-analytics-table-page-button"
            disabled={safePage >= pageCount}
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
          >
            下一页
          </button>
          <select
            className="group-analytics-page-size"
            aria-label="每页显示条数"
            value={safePageSize}
            onChange={(event) => {
              const nextPageSize = Number.parseInt(event.target.value, 10)
              if (MEMBER_PAGE_SIZE_OPTIONS.includes(nextPageSize)) {
                setPageSize(nextPageSize)
              }
            }}
          >
            {MEMBER_PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size} 条/页
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  )
}

function MetricCard({
  label,
  value,
  hint,
  tone = 'brand'
}: {
  label: string
  value: string
  hint: string
  tone?: 'brand' | 'green' | 'orange' | 'purple' | 'blue'
}): React.ReactElement {
  return (
    <article className={'group-analytics-metric-card tone-' + tone}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  )
}

export function GroupAnalyticsWorkspace({
  contacts,
  initialContact,
  selfInfo,
  dbReady,
  dbConnecting = false,
  onOpenSettings,
  onContactSelected
}: GroupAnalyticsWorkspaceProps): React.ReactElement {
  const groups = React.useMemo(
    () =>
      contacts.filter(
        (contact) => contact.type === 'group' || contact.m_nsUsrName.endsWith('@chatroom')
      ),
    [contacts]
  )
  const [keyword, setKeyword] = React.useState('')
  const [selectedContact, setSelectedContact] = React.useState<Contact | null>(() =>
    initialContact &&
    (initialContact.type === 'group' || initialContact.m_nsUsrName.endsWith('@chatroom'))
      ? initialContact
      : groups[0] || null
  )
  const [range, setRange] = React.useState<GroupAnalyticsRange>('7days')
  const [selectedTypes, setSelectedTypes] = React.useState<GroupAnalyticsMessageType[]>(ALL_TYPES)
  const [selectedMemberId, setSelectedMemberId] = React.useState('')
  const [memberOptions, setMemberOptions] = React.useState<Array<{ id: string; name: string }>>([])
  const [analytics, setAnalytics] = React.useState<GroupAnalyticsSnapshot | null>(null)
  const [loadState, setLoadState] = React.useState<LoadState>('idle')
  const [error, setError] = React.useState('')
  const [lastLoadedAt, setLastLoadedAt] = React.useState<number | null>(null)
  const requestRef = React.useRef(0)
  const analyticsSourceRef = React.useRef<GroupAnalyticsSource | null>(null)

  const invalidateAnalytics = (): void => {
    analyticsSourceRef.current = null
    setAnalytics(null)
    setMemberOptions([])
    setError('')
    setLoadState('idle')
  }

  const buildAnalyticsForMember = (
    source: GroupAnalyticsSource,
    memberId: string
  ): GroupAnalyticsSnapshot =>
    buildGroupAnalytics(source.messages, {
      ...source.options,
      selectedMemberIds: memberId ? [memberId] : undefined,
      currentMemberCount: memberId ? 1 : source.options.currentMemberCount,
      generatedAt: Date.now()
    })

  React.useEffect(() => {
    if (!selectedContact || groups.some((contact) => contact.md5 === selectedContact.md5)) return
    setSelectedContact(groups[0] || null)
    setAnalytics(null)
  }, [groups, selectedContact])

  const filteredGroups = React.useMemo(() => {
    const lower = keyword.trim().toLowerCase()
    if (!lower) return groups
    return groups.filter((contact) =>
      (contact.m_nsNickName + ' ' + contact.m_nsUsrName + ' ' + (contact.remark || ''))
        .toLowerCase()
        .includes(lower)
    )
  }, [groups, keyword])

  const selectContact = (contact: Contact): void => {
    requestRef.current += 1
    analyticsSourceRef.current = null
    setSelectedContact(contact)
    setSelectedMemberId('')
    setMemberOptions([])
    setAnalytics(null)
    setError('')
    setLoadState('idle')
    onContactSelected?.(contact)
  }

  const toggleType = (type: GroupAnalyticsMessageType): void => {
    invalidateAnalytics()
    setSelectedTypes((current) => {
      if (current.includes(type)) {
        if (current.length === 1) return current
        return current.filter((item) => item !== type)
      }
      return [...current, type]
    })
  }

  const loadAnalytics = async (): Promise<void> => {
    if (!selectedContact) return
    if (!dbReady) {
      setError('数据库尚未连接，请先完成连接')
      setLoadState('error')
      return
    }
    const requestId = ++requestRef.current
    const period = buildGroupAnalyticsPeriod(range)
    setLoadState('loading')
    setError('')
    try {
      const startSeconds = Math.floor(period.previousStartMs / 1000)
      const endSeconds = Math.floor(period.endMs / 1000) - 1
      const [messages, rawSnapshot] = await Promise.all([
        listMessagesForContact(selectedContact, startSeconds, endSeconds),
        window.api.getGroupSnapshot(selectedContact.md5)
      ])
      if (requestId !== requestRef.current) return
      const snapshot = normalizeSnapshot(rawSnapshot)
      const memberNames = new Map<string, string>()
      for (const member of snapshot?.members || []) {
        if (member.wxid) memberNames.set(member.wxid, memberDisplayName(member))
        if (member.nickname) memberNames.set(member.nickname, memberDisplayName(member))
        if (member.groupNickname) memberNames.set(member.groupNickname, memberDisplayName(member))
      }
      const baseOptions = {
        period,
        selectedTypes: [...selectedTypes],
        memberNames,
        currentMemberCount: snapshot?.memberCount || snapshot?.members?.length || 0
      }
      const source: GroupAnalyticsSource = {
        contactMd5: selectedContact.md5,
        messages: messages as Message[],
        options: baseOptions
      }
      analyticsSourceRef.current = source
      const result = buildGroupAnalytics(source.messages, source.options)
      const nextMemberOptions = result.members.map((member) => ({
        id: member.id,
        name: member.name
      }))
      setMemberOptions(nextMemberOptions)
      const validMemberId =
        selectedMemberId && nextMemberOptions.some((member) => member.id === selectedMemberId)
          ? selectedMemberId
          : ''
      if (validMemberId !== selectedMemberId) setSelectedMemberId(validMemberId)
      const filteredResult = validMemberId ? buildAnalyticsForMember(source, validMemberId) : result
      setAnalytics(filteredResult)
      setLastLoadedAt(Date.now())
      setLoadState('success')
    } catch (loadError) {
      if (requestId !== requestRef.current) return
      setError(loadError instanceof Error ? loadError.message : '统计读取失败，请稍后重试')
      setLoadState('error')
      setAnalytics(null)
      setMemberOptions([])
      analyticsSourceRef.current = null
    }
  }

  const updateMemberFilter = (memberId: string): void => {
    setSelectedMemberId(memberId)
    setError('')
    const source = analyticsSourceRef.current
    if (!source || !selectedContact || source.contactMd5 !== selectedContact.md5) {
      setAnalytics(null)
      setLoadState('idle')
      return
    }
    setAnalytics(buildAnalyticsForMember(source, memberId))
    setLastLoadedAt(Date.now())
    setLoadState('success')
  }

  const allSelected = selectedTypes.length === ALL_TYPES.length
  const selectedName = selectedContact ? displayContactName(selectedContact) : '请选择群聊'
  const selectedMemberName =
    memberOptions.find((member) => member.id === selectedMemberId)?.name || '指定成员'

  return (
    <div className="group-analytics-page">
      <aside className="group-analytics-sidebar">
        <div className="group-analytics-sidebar-header">
          <div>
            <h2>群聊洞察</h2>
            <p>选择一个群聊生成统计</p>
          </div>
          <span>{groups.length} 个群聊</span>
        </div>
        <label className="group-analytics-search">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="10.5" cy="10.5" r="5.5" />
            <path d="m15 15 4 4" />
          </svg>
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索群聊"
          />
        </label>
        <div className="group-analytics-group-list">
          {filteredGroups.length ? (
            filteredGroups.map((contact) => {
              const name = displayContactName(contact)
              return (
                <Button
                  key={contact.md5}
                  variant="ghost"
                  className={
                    'group-analytics-group-item ' +
                    (selectedContact?.md5 === contact.md5 ? 'active' : '')
                  }
                  onClick={() => selectContact(contact)}
                  title={contact.m_nsUsrName}
                >
                  <span className="group-analytics-avatar">
                    {contact.avatar ? <img src={contact.avatar} alt="" /> : name.slice(0, 1)}
                  </span>
                  <span className="group-analytics-group-name">{name}</span>
                </Button>
              )
            })
          ) : (
            <div className="group-analytics-empty-list">没有匹配的群聊</div>
          )}
        </div>
        <AccountSummaryFooter
          className="group-analytics-sidebar-account"
          selfInfo={selfInfo}
          dbReady={dbReady}
          dbConnecting={dbConnecting}
          onClick={onOpenSettings}
        />
      </aside>

      <main className="group-analytics-main">
        <header className="group-analytics-header">
          <div>
            <p className="group-analytics-eyebrow">指定群聊 · 本地确定性统计</p>
            <h1>{selectedName}</h1>
            <p>从消息量、成员参与、活跃时段和消息结构观察群聊状态。</p>
          </div>
          <Button
            className="group-analytics-refresh-button"
            onClick={() => void loadAnalytics()}
            disabled={!selectedContact || loadState === 'loading' || !dbReady}
          >
            <span className="group-analytics-refresh-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20" focusable="false">
                <path d="M16.1 6.2A7 7 0 1 0 17 12h-2a5 5 0 1 1-.7-3.4L12 11h6V5l-1.9 1.2Z" />
              </svg>
            </span>
            <span>
              {loadState === 'loading' ? '正在生成…' : analytics ? '刷新统计' : '生成统计'}
            </span>
          </Button>
        </header>
        <section className="group-analytics-filter-panel" aria-label="统计筛选">
          <div className="group-analytics-filter-row">
            <span className="group-analytics-filter-label">时间范围</span>
            <div className="group-analytics-segmented">
              {GROUP_ANALYTICS_RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={range === option.value ? 'active' : ''}
                  onClick={() => {
                    setRange(option.value)
                    invalidateAnalytics()
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="group-analytics-filter-row">
            <span className="group-analytics-filter-label">消息类型</span>
            <div className="group-analytics-type-filters">
              <button
                type="button"
                className={allSelected ? 'active' : ''}
                aria-pressed={allSelected}
                onClick={() => {
                  setSelectedTypes(ALL_TYPES)
                  invalidateAnalytics()
                }}
              >
                全部
              </button>
              {GROUP_ANALYTICS_MESSAGE_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={selectedTypes.includes(option.value) ? 'active' : ''}
                  aria-pressed={selectedTypes.includes(option.value)}
                  onClick={() => toggleType(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="group-analytics-filter-row">
            <span className="group-analytics-filter-label">成员</span>
            <div className="group-analytics-member-filter">
              <MemberFilter
                options={memberOptions}
                value={selectedMemberId}
                disabled={!memberOptions.length || loadState === 'loading'}
                onChange={updateMemberFilter}
              />
              <small>
                {memberOptions.length
                  ? '选择后自动更新，所有图表都会联动'
                  : '先生成群聊统计后可指定成员'}
              </small>
            </div>
          </div>
        </section>

        {loadState === 'idle' && !analytics ? (
          <div className="group-analytics-placeholder">
            <div className="group-analytics-placeholder-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20" focusable="false">
                <path d="M6 14 14 6M8 6h6v6" />
              </svg>
            </div>
            <h2>生成一份群聊经营分析</h2>
            <p>选择时间范围和消息类型后，点击“生成统计”。结果只基于本机已读取的聊天记录。</p>
            {!dbReady && <small>数据库正在连接或尚未连接。</small>}
          </div>
        ) : loadState === 'loading' ? (
          <div className="group-analytics-placeholder is-loading">
            <div className="group-analytics-spinner" />
            <h2>正在读取并计算统计</h2>
            <p>长时间范围可能需要几秒钟，请保持页面打开。</p>
          </div>
        ) : loadState === 'error' ? (
          <div className="group-analytics-placeholder is-error">
            <div className="group-analytics-placeholder-icon">!</div>
            <h2>统计生成失败</h2>
            <p>{error}</p>
            <Button variant="outline" onClick={() => void loadAnalytics()}>
              重试
            </Button>
          </div>
        ) : analytics ? (
          <div className="group-analytics-content">
            <div className="group-analytics-result-meta">
              统计区间：{new Date(analytics.period.startMs).toLocaleDateString('zh-CN')} –{' '}
              {new Date(analytics.period.endMs - 1).toLocaleDateString('zh-CN')} · 生成于{' '}
              {lastLoadedAt
                ? new Date(lastLoadedAt).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                : '刚刚'}
              {selectedMemberId ? ' · 成员：' + selectedMemberName : ''}
            </div>
            <section className="group-analytics-metrics">
              <MetricCard
                label="消息总量"
                value={formatNumber(analytics.metrics.totalMessages)}
                hint={formatChange(analytics.comparison.totalMessages.changePercent)}
                tone="brand"
              />
              <MetricCard
                label="活跃成员"
                value={formatNumber(analytics.metrics.activeMembers)}
                hint={
                  analytics.currentMemberCount
                    ? formatPercent(analytics.activeRate) +
                      ' · ' +
                      formatChange(analytics.comparison.activeMembers.changePercent)
                    : formatChange(analytics.comparison.activeMembers.changePercent)
                }
                tone="green"
              />
              <MetricCard
                label="日均消息"
                value={formatNumber(analytics.metrics.averagePerDay)}
                hint={analytics.period.days + ' 天统计窗口'}
                tone="orange"
              />
              <MetricCard
                label="高峰时段"
                value={formatHour(analytics.peakHour)}
                hint="按消息发送小时统计"
                tone="purple"
              />
              <MetricCard
                label="活跃天数"
                value={analytics.metrics.activeDays + '/' + analytics.period.days}
                hint={formatChange(analytics.comparison.activeDays.changePercent)}
                tone="blue"
              />
            </section>
            <section className="group-analytics-chart-grid">
              <article className="group-analytics-card group-analytics-trend-card">
                <div className="group-analytics-card-header">
                  <div>
                    <h2>{selectedMemberId ? '成员消息量趋势' : '消息量趋势'}</h2>
                    <p>
                      {selectedMemberId
                        ? selectedMemberName + ' 在每天的消息密度和活跃波动'
                        : '观察每天的消息密度和活跃波动'}
                    </p>
                  </div>
                  <div className="group-analytics-trend-header-badges">
                    <span className="group-analytics-trend-badge">
                      <i className="group-analytics-trend-badge-dot" />
                      日峰值{' '}
                      <strong>
                        {formatNumber(Math.max(0, ...analytics.daily.map((d) => d.count)))}
                      </strong>{' '}
                      条
                    </span>
                    <span className="group-analytics-trend-badge secondary">
                      {formatNumber(analytics.metrics.textCharacters)} 字符
                    </span>
                  </div>
                </div>
                <TrendChart analytics={analytics} />
              </article>
              <article className="group-analytics-card">
                <div className="group-analytics-card-header">
                  <div>
                    <h2>消息类型</h2>
                    <p>了解群聊的内容结构</p>
                  </div>
                </div>
                <MessageTypeChart analytics={analytics} />
              </article>
            </section>
            <section className="group-analytics-card">
              <div className="group-analytics-card-header">
                <div>
                  <h2>活跃时间热力图</h2>
                  <p>横轴为小时，纵轴为星期；颜色越深表示消息越集中</p>
                </div>
                <span>高峰 {formatHour(analytics.peakHour)}</span>
              </div>
              <Heatmap analytics={analytics} />
            </section>
            <section className="group-analytics-chart-grid">
              <article className="group-analytics-card">
                <div className="group-analytics-card-header">
                  <div>
                    <h2>成员发言排行</h2>
                    <p>按筛选范围内的消息数排序</p>
                  </div>
                </div>
                <RankingChart analytics={analytics} />
              </article>
              <article className="group-analytics-card">
                <div className="group-analytics-card-header">
                  <div>
                    <h2>成员参与度分布</h2>
                    <p>每个成员在当前区间发送的消息量</p>
                  </div>
                </div>
                <DistributionChart analytics={analytics} />
              </article>
            </section>
            <section className="group-analytics-card group-analytics-member-card">
              <div className="group-analytics-card-header">
                <div>
                  <h2>成员明细</h2>
                  <p>活跃天数和消息占比用于识别稳定参与者与偶发参与者。</p>
                </div>
                <span>{analytics.members.length} 位活跃成员</span>
              </div>
              {analytics.members.length ? (
                <MemberDetailsTable analytics={analytics} />
              ) : (
                <EmptyChart label="当前筛选条件下没有成员消息" />
              )}
            </section>
            <p className="group-analytics-footnote">
              口径说明：活跃成员指当前统计区间内发送过至少一条非系统消息的成员；活跃率分母来自当前群成员快照，“首次发言”仅表示当前数据范围内首次发现。
            </p>
          </div>
        ) : null}
      </main>
    </div>
  )
}
