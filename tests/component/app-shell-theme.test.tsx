import { act, render, screen, waitFor } from '@testing-library/react'
import { TooltipProvider } from '../../src/renderer/src/components/ui'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../../src/renderer/src/components/layout/AppShell'

const DARK_MODE_QUERY = '(prefers-color-scheme: dark)'
const originalMatchMedia = window.matchMedia

interface MockMediaQueryList extends MediaQueryList {
  setMatches: (matches: boolean) => void
}

function createMediaQueryList(initialMatches: boolean): MockMediaQueryList {
  let matches = initialMatches
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const mediaQuery = {
    get matches() {
      return matches
    },
    media: DARK_MODE_QUERY,
    onchange: null,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
      if (typeof listener === 'function') {
        listeners.add(listener as (event: MediaQueryListEvent) => void)
      }
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
      if (typeof listener === 'function') {
        listeners.delete(listener as (event: MediaQueryListEvent) => void)
      }
    },
    addListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener)
    },
    removeListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener)
    },
    dispatchEvent: () => true,
    setMatches: (nextMatches: boolean) => {
      matches = nextMatches
      const event = { matches, media: DARK_MODE_QUERY } as MediaQueryListEvent
      listeners.forEach((listener) => listener(event))
    }
  }

  return mediaQuery as unknown as MockMediaQueryList
}

function renderShell({
  appearanceTheme = 'system',
  onToggleTheme = vi.fn(),
  onOpenGuide = vi.fn()
}: {
  appearanceTheme?: 'system' | 'light' | 'dark'
  onToggleTheme?: (nextTheme: 'light' | 'dark') => void
  onOpenGuide?: () => void
} = {}): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <AppShell
        activePage="archive"
        selfInfo={null}
        dbReady={false}
        onPageChange={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenGuide={onOpenGuide}
        appearanceTheme={appearanceTheme}
        onToggleTheme={onToggleTheme}
      >
        <div>测试工作区</div>
      </AppShell>
    </TooltipProvider>
  )
}

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia
  })
  delete document.documentElement.dataset.theme
})

describe('AppShell theme behavior', () => {
  it('resolves system appearance and updates when the operating system theme changes', async () => {
    const mediaQuery = createMediaQueryList(false)
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => mediaQuery)
    })

    renderShell()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(screen.getByRole('button', { name: '切换到深色模式' })).toBeInTheDocument()

    await act(async () => {
      mediaQuery.setMatches(true)
    })
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(screen.getByRole('button', { name: '切换到浅色模式' })).toBeInTheDocument()
  })

  it('toggles to the opposite explicit theme and renders the active logo', async () => {
    const user = userEvent.setup()
    const onToggleTheme = vi.fn()

    renderShell({ appearanceTheme: 'dark', onToggleTheme })

    expect(document.documentElement.dataset.theme).toBe('dark')
    const logo = document.querySelector<HTMLImageElement>('.app-brand img')
    expect(logo).toBeInTheDocument()
    expect(logo?.src).toContain('brand-dark-bg')
    expect(logo?.src).toContain('brand-dark-ribbon')

    await user.click(screen.getByRole('button', { name: '切换到浅色模式' }))
    expect(onToggleTheme).toHaveBeenCalledWith('light')
  })

  it('renders the novice guide button and theme switcher in header actions and keeps rail clean', async () => {
    const user = userEvent.setup()
    const onOpenGuide = vi.fn()

    renderShell({ onOpenGuide })

    const guideBtn = screen.getByRole('button', { name: '新手引导' })
    expect(guideBtn).toBeInTheDocument()
    expect(guideBtn.closest('.app-header-actions')).toBeInTheDocument()

    const themeBtn = screen.getByRole('button', { name: '切换到深色模式' })
    expect(themeBtn).toBeInTheDocument()
    expect(themeBtn.closest('.app-header-actions')).toBeInTheDocument()
    expect(document.querySelector('.app-primary-rail .app-rail-utilities')).not.toBeInTheDocument()
    expect(document.querySelector('.app-primary-rail .app-rail-account')).toBeInTheDocument()

    await user.click(guideBtn)
    expect(onOpenGuide).toHaveBeenCalledTimes(1)
  })

  it('shows the theme tooltip through the non-drag trigger layer', async () => {
    const user = userEvent.setup()

    renderShell()

    const themeBtn = screen.getByRole('button', { name: '切换到深色模式' })
    expect(themeBtn.parentElement).toHaveClass('app-theme-tooltip-trigger')
    expect(themeBtn.parentElement).toHaveAttribute('title', '切换到深色模式')

    await user.hover(themeBtn.parentElement as HTMLElement)
    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toHaveTextContent('切换到深色模式')
    })
  })
})
