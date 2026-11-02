import { useMemo, useState } from 'react'
import { AccountSummaryFooter } from '../../../components/account/AccountSummary'
import { Input } from '../../../components/ui'
import { cn } from '../../../lib/cn'
import { SETTINGS_NAVIGATION } from '../model/settingsNavigation'
import type { SettingsCategoryId, SettingsSelfInfo } from '../model/types'

function SettingsCategoryIcon({ id }: { id: SettingsCategoryId }): React.ReactElement {
  switch (id) {
    case 'wechat-bot':
      return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="5" y="7" width="14" height="11" rx="3" />
          <path d="M12 4v3M8 12h2m4 0h2m-7 3h6" />
        </svg>
      )
    case 'account-database':
      return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
          <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
        </svg>
      )
    case 'database-key':
      return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="7.5" cy="15.5" r="5.5" />
          <path d="m21 2-9.6 9.6" />
          <path d="m15.5 7.5 3 3" />
        </svg>
      )
    case 'image-key':
      return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
        </svg>
      )
    case 'wechat-send':
    case 'personal-wechat-send':
      return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m22 2-7 20-4-9-9-4Z" />
          <path d="M22 2 11 13" />
        </svg>
      )
    case 'voice-recognition':
      return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
      )
    case 'text-to-speech':
      return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      )
    case 'ai-model':
      return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 2v4" />
          <path d="m4.93 4.93 2.83 2.83" />
          <path d="M2 12h4" />
          <path d="m4.93 19.07 2.83-2.83" />
          <path d="M12 22v-4" />
          <path d="m19.07 19.07-2.83-2.83" />
          <path d="M22 12h-4" />
          <path d="m19.07 4.93-2.83 2.83" />
        </svg>
      )
    case 'storage-export':
      return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" x2="12" y1="15" y2="3" />
        </svg>
      )
    case 'cache-cleanup':
      return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h18" />
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
        </svg>
      )
    case 'recall-protection':
      return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      )
    case 'appearance':
      return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 10 10 0 0 0 0-20" />
        </svg>
      )
    case 'local-api':
      return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect width="20" height="14" x="2" y="3" rx="2" />
          <line x1="8" x2="16" y1="21" y2="21" />
          <line x1="12" x2="12" y1="17" y2="21" />
        </svg>
      )
    case 'advanced':
      return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="4" x2="20" y1="21" y2="21" />
          <line x1="4" x2="20" y1="14" y2="14" />
          <line x1="4" x2="20" y1="7" y2="7" />
          <circle cx="8" cy="7" r="2" />
          <circle cx="16" cy="14" r="2" />
          <circle cx="8" cy="21" r="2" />
        </svg>
      )
    case 'about':
      return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
        </svg>
      )
  }
}

export function SettingsSidebar({
  selectedId,
  onSelect,
  selfInfo,
  dbReady,
  dbConnecting = false,
  onOpenSettings
}: {
  selectedId: SettingsCategoryId
  onSelect: (id: SettingsCategoryId) => void
  selfInfo: SettingsSelfInfo | null
  dbReady: boolean
  dbConnecting?: boolean
  onOpenSettings: () => void
}): React.ReactElement {
  const [keyword, setKeyword] = useState('')
  const groups = useMemo(
    () =>
      SETTINGS_NAVIGATION.map((group) => ({
        ...group,
        items: group.items.filter((item) => item.label.includes(keyword.trim()))
      })).filter((group) => group.items.length),
    [keyword]
  )
  return (
    <aside className="settings-sidebar">
      <header>
        <h1>设置</h1>
        <p>管理账号、数据连接和本地能力</p>
        <label className="settings-search">
          <span>⌕</span>
          <Input
            className="settings-search-input"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索设置"
          />
        </label>
      </header>
      <div className="settings-sidebar-list">
        {groups.map((group) => (
          <section key={group.label}>
            <h2>{group.label}</h2>
            {group.items.map((item) => (
              <button
                type="button"
                key={item.id}
                className={cn('settings-nav-item', selectedId === item.id && 'active')}
                onClick={() => onSelect(item.id)}
              >
                <span className="settings-nav-icon" aria-hidden="true">
                  <SettingsCategoryIcon id={item.id} />
                </span>
                <span className="settings-nav-label">{item.label}</span>
              </button>
            ))}
          </section>
        ))}
      </div>
      <AccountSummaryFooter
        className="settings-sidebar-account"
        selfInfo={selfInfo}
        dbReady={dbReady}
        dbConnecting={dbConnecting}
        onClick={onOpenSettings}
      />
    </aside>
  )
}
