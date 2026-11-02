import React from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui'
import { AccountSummaryFooter } from '../account/AccountSummary'
import { PrimaryNavigation } from './PrimaryNavigation'
import { PRIMARY_NAV_ITEMS } from './navigation'
import type { AppPage } from './navigation'
import { isMac } from '../../utils/runtime-environment'
import brandIcon from '../../assets/brand-icon.svg'
import brandIconDark from '../../assets/brand-icon-dark.svg'

interface SelfInfo {
  wxid: string
  nickname: string
  avatar?: string
  accountRoot: string
}

type AppearanceTheme = 'system' | 'light' | 'dark'
type EffectiveTheme = Exclude<AppearanceTheme, 'system'>

const DARK_MODE_QUERY = '(prefers-color-scheme: dark)'

function resolveEffectiveTheme(
  appearanceTheme: AppearanceTheme,
  mediaQuery?: MediaQueryList | null
): EffectiveTheme {
  if (appearanceTheme === 'light' || appearanceTheme === 'dark') return appearanceTheme
  if (mediaQuery) return mediaQuery.matches ? 'dark' : 'light'
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia(DARK_MODE_QUERY).matches ? 'dark' : 'light'
  }
  return 'light'
}

function useEffectiveTheme(appearanceTheme: AppearanceTheme): EffectiveTheme {
  const [effectiveTheme, setEffectiveTheme] = React.useState<EffectiveTheme>(() =>
    resolveEffectiveTheme(appearanceTheme)
  )

  React.useEffect(() => {
    if (appearanceTheme !== 'system') {
      setEffectiveTheme(appearanceTheme)
      return
    }

    const mediaQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(DARK_MODE_QUERY)
        : null
    const update = (): void => {
      setEffectiveTheme(resolveEffectiveTheme('system', mediaQuery))
    }
    update()
    if (!mediaQuery) return

    const listener = (): void => update()
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', listener)
    } else {
      mediaQuery.addListener?.(listener)
    }

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', listener)
      } else {
        mediaQuery.removeListener?.(listener)
      }
    }
  }, [appearanceTheme])

  return effectiveTheme
}

interface AppShellProps {
  activePage: AppPage
  selfInfo: SelfInfo | null
  dbReady: boolean
  dbConnecting?: boolean
  onPageChange: (page: AppPage) => void
  onOpenSettings: () => void
  onOpenGuide: () => void
  appearanceTheme?: AppearanceTheme
  onToggleTheme?: (nextTheme: EffectiveTheme) => void | Promise<void>
  themeTogglePending?: boolean
  compactMode?: boolean
  sourceSwitcher?: React.ReactNode
  children: React.ReactNode
}

function BrandLogo({ effectiveTheme }: { effectiveTheme: EffectiveTheme }): React.ReactElement {
  const isDark = effectiveTheme === 'dark'

  return (
    <div className="app-brand" title="语屿 YUYU" aria-label="语屿 YUYU">
      <img src={isDark ? brandIconDark : brandIcon} alt="" aria-hidden="true" />
    </div>
  )
}

function ThemeIcon({ theme }: { theme: EffectiveTheme }): React.ReactElement {
  if (theme === 'dark') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M20.2 15.2A8.5 8.5 0 0 1 8.8 3.8 8.6 8.6 0 1 0 20.2 15.2Z" />
    </svg>
  )
}

export function AppShell({
  activePage,
  selfInfo,
  dbReady,
  dbConnecting = false,
  onPageChange,
  onOpenSettings,
  onOpenGuide,
  appearanceTheme = 'system',
  onToggleTheme,
  themeTogglePending = false,
  compactMode = false,
  sourceSwitcher,
  children
}: AppShellProps): React.ReactElement {
  const effectiveTheme = useEffectiveTheme(appearanceTheme)

  React.useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme
    return () => {
      if (document.documentElement.dataset.theme === effectiveTheme) {
        delete document.documentElement.dataset.theme
      }
    }
  }, [effectiveTheme])

  const activeItem = PRIMARY_NAV_ITEMS.find((item) => item.id === activePage)

  return (
    <div className={'app-shell theme-' + effectiveTheme + (compactMode ? ' is-compact' : '')}>
      <header className={`app-window-header ${isMac ? 'is-mac' : 'is-windows'}`}>
        <span className="app-window-title">语屿 YUYU</span>
        <div className="app-header-actions">
          {sourceSwitcher}
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="app-theme-tooltip-trigger"
                  title={effectiveTheme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
                  aria-label={effectiveTheme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
                >
                  <button
                    type="button"
                    className="app-theme-header-btn"
                    onClick={() =>
                      void onToggleTheme?.(effectiveTheme === 'dark' ? 'light' : 'dark')
                    }
                    disabled={!onToggleTheme || themeTogglePending}
                    aria-label={effectiveTheme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
                  >
                    <span className="app-theme-header-icon" aria-hidden="true">
                      <ThemeIcon theme={effectiveTheme} />
                    </span>
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {effectiveTheme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <button
            type="button"
            className="app-guide-header-btn"
            onClick={onOpenGuide}
            title="重新打开新手引导"
            aria-label="新手引导"
          >
            <span className="app-guide-header-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M12 3 14.2 9.8 21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3Z" />
              </svg>
            </span>
            <span className="app-guide-header-label">新手引导</span>
          </button>
        </div>
      </header>
      <div className="app-shell-body">
        <aside className="app-primary-rail">
          <BrandLogo effectiveTheme={effectiveTheme} />
          <PrimaryNavigation activePage={activePage} onPageChange={onPageChange} />
          {!sourceSwitcher && (
            <AccountSummaryFooter
              className="app-rail-account"
              selfInfo={selfInfo}
              dbReady={dbReady}
              dbConnecting={dbConnecting}
              compact
              onClick={onOpenSettings}
            />
          )}
        </aside>
        <main className="app-shell-main" aria-label={activeItem?.label || '工作区'}>
          {children}
        </main>
      </div>
    </div>
  )
}
