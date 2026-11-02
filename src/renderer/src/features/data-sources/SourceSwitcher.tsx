import { RuntimeManagerButton } from '../settings/components/RuntimeManagerButton'
import type { ReactElement } from 'react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuPortal,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '../../components/ui'
import type { SourceAccountOption } from './source-context'

const STATUS_LABELS: Record<SourceAccountOption['status'], string> = {
  connected: '已连接',
  connecting: '连接中',
  available: '可连接',
  needs_setup: '待配置'
}

export interface SourceSwitcherProps {
  active: SourceAccountOption
  accounts: SourceAccountOption[]
  open: boolean
  loading: boolean
  switching: boolean
  error?: string
  onOpenChange: (open: boolean) => void
  onSelect: (id: string) => void
  onRefresh: () => void
  onAdd: () => void
}

export function SourceSwitcher({
  active,
  accounts,
  open,
  loading,
  switching,
  error,
  onOpenChange,
  onSelect,
  onRefresh,
  onAdd
}: SourceSwitcherProps): ReactElement {
  const groups = new Map<string, { label: string; accounts: SourceAccountOption[] }>()
  for (const account of accounts) {
    const group = groups.get(account.source) || { label: account.sourceLabel, accounts: [] }
    group.accounts.push(account)
    groups.set(account.source, group)
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="source-switcher-trigger"
            disabled={switching}
            aria-label={`切换数据源，当前：${active.sourceLabel} · ${active.label}`}
          >
            <span className={`source-switcher-dot is-${active.status}`} aria-hidden="true" />
            <span className="source-switcher-current">
              {active.sourceLabel} · {active.label}
            </span>
            <span className="source-switcher-state">
              {switching ? '切换中…' : STATUS_LABELS[active.status]}
            </span>
            <span aria-hidden="true">⌄</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="source-switcher-menu" align="end" aria-label="数据源与账号">
          <DropdownMenuLabel>数据源与账号</DropdownMenuLabel>
          <p className="source-switcher-hint">切换后，会话与相关功能跟随所选账号。</p>
          {loading && (
            <p className="source-switcher-hint" role="status">
              正在查找账号…
            </p>
          )}
          {error && (
            <p className="source-switcher-error" role="alert">
              {error}
            </p>
          )}
          {[...groups].map(([source, group]) => {
            const accountCount = group.accounts.filter((account) => !account.discovery).length
            const countLabel = accountCount ? `${accountCount} 个账号` : '待检测'
            return (
              <DropdownMenuSub key={source}>
                <DropdownMenuSubTrigger
                  className="source-switcher-source"
                  aria-label={`${group.label}，${countLabel}${
                    group.accounts.some((account) => account.id === active.id) ? '，当前数据源' : ''
                  }`}
                >
                  <span className="source-switcher-source-dot" aria-hidden="true" />
                  <span className="source-switcher-source-identity">
                    <strong>{group.label}</strong>
                    <small>{countLabel}</small>
                  </span>
                  {group.accounts.some((account) => account.id === active.id) && (
                    <span className="source-switcher-option-state">当前</span>
                  )}
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent
                    className="source-switcher-submenu"
                    aria-label={`${group.label}账号`}
                  >
                    <DropdownMenuLabel className="source-switcher-group">
                      {group.label}账号
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={active.id}>
                      {group.accounts.map((account) =>
                        account.discovery ? (
                          <DropdownMenuItem
                            key={account.id}
                            disabled={switching}
                            onSelect={() => onSelect(account.id)}
                          >
                            {account.label}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuRadioItem
                            key={account.id}
                            value={account.id}
                            disabled={
                              switching ||
                              (account.id === active.id && account.status === 'connected')
                            }
                            className="source-switcher-option"
                            onSelect={() => onSelect(account.id)}
                          >
                            <span className="source-switcher-avatar" aria-hidden="true">
                              {account.avatar ? (
                                <img src={account.avatar} alt="" referrerPolicy="no-referrer" />
                              ) : (
                                account.label.slice(0, 1)
                              )}
                            </span>
                            <span className="source-switcher-identity">
                              <strong>{account.label}</strong>
                              <small>{account.accountHint}</small>
                            </span>
                            <span className="source-switcher-option-state">
                              {STATUS_LABELS[account.status]}
                            </span>
                          </DropdownMenuRadioItem>
                        )
                      )}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            )
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={loading || switching}
            onSelect={(event) => {
              event.preventDefault()
              onRefresh()
            }}
          >
            刷新账号列表
          </DropdownMenuItem>
          <DropdownMenuItem disabled={switching} onSelect={onAdd}>
            添加数据源…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RuntimeManagerButton />
    </div>
  )
}
