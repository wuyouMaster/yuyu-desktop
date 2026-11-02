export type AppPage =
  | 'archive'
  | 'priority-watch'
  | 'analytics'
  | 'report'
  | 'exit-monitor'
  | 'logs'
  | 'export'
  | 'api'
  | 'settings'

export interface NavigationItem {
  id: AppPage
  label: string
}

export const PRIMARY_NAV_ITEMS: NavigationItem[] = [
  { id: 'archive', label: '聊天助手' },
  { id: 'priority-watch', label: '重点关注' },
  { id: 'analytics', label: '群聊洞察' },
  { id: 'report', label: '日报' },
  { id: 'exit-monitor', label: '退群监控' },
  // { id: 'logs', label: '日志' },
  { id: 'export', label: '导出' },
  { id: 'api', label: 'API' },
  { id: 'settings', label: '设置' }
]
