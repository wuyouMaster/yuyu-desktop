import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  SourceSwitcher,
  type SourceSwitcherProps
} from '../../src/renderer/src/features/data-sources/SourceSwitcher'
import { SourceScopeContext } from '../../src/renderer/src/features/data-sources/source-context'
import { ChatHeader } from '../../src/renderer/src/components/chat/ChatHeader'
import { TooltipProvider } from '../../src/renderer/src/components/ui'
import { AccountSummaryFooter } from '../../src/renderer/src/components/account/AccountSummary'
import { wechatSourceOption } from '../../src/renderer/src/features/data-sources/wechat-source-options'
import { telegramLocalSourceOption } from '../../src/renderer/src/features/data-sources/telegram-source-options'

const first = {
  id: 'fixture-a',
  source: 'wechat',
  sourceLabel: '微信',
  label: '合成账号甲',
  accountHint: 'fixture-a',
  status: 'connected' as const
}
const second = {
  ...first,
  id: 'fixture-b',
  label: '合成账号乙',
  accountHint: 'fixture-b',
  status: 'needs_setup' as const
}
const otherSource = {
  ...first,
  id: 'other-source-account',
  source: 'dingtalk',
  sourceLabel: '钉钉',
  label: '合成钉钉账号',
  accountHint: '合成企业',
  status: 'available' as const
}
function Harness(props: Partial<SourceSwitcherProps>): React.ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <SourceSwitcher
      active={first}
      accounts={[first, second, otherSource]}
      open={open}
      loading={false}
      switching={false}
      onOpenChange={setOpen}
      onSelect={vi.fn()}
      onRefresh={vi.fn()}
      onAdd={vi.fn()}
      {...props}
    />
  )
}

describe('global data source switcher', () => {
  it('opens runtime management next to the source selector without switching accounts', async () => {
    const onSelect = vi.fn()
    const onAdd = vi.fn()
    const listRuntimeInstallations = vi.fn().mockResolvedValue([])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { listRuntimeInstallations }
    })
    const user = userEvent.setup()
    render(<Harness onSelect={onSelect} onAdd={onAdd} />)
    await user.click(screen.getByRole('button', { name: '管理应用运行时' }))
    const dialog = await screen.findByRole('dialog', { name: '管理应用运行时' })
    expect(within(dialog).getByRole('region', { name: '应用运行时管理' })).toBeVisible()
    expect(listRuntimeInstallations).toHaveBeenCalledOnce()
    expect(onSelect).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: /切换数据源/ })).toBeVisible()
  })
  it('opens local detection without presenting it as a connected account', async () => {
    const onSelect = vi.fn()
    render(<Harness accounts={[first, telegramLocalSourceOption]} onSelect={onSelect} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /切换数据源/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Telegram，待检测' }))
    expect(screen.queryByRole('menuitemradio', { name: '检测本机账号' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '检测本机账号' }))
    expect(onSelect).toHaveBeenCalledWith('telegram:local')
  })
  it('opens accounts through a source submenu and selects the correct connection', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<Harness onSelect={onSelect} />)
    await user.click(screen.getByRole('button', { name: /切换数据源/ }))
    expect(screen.getByRole('menuitem', { name: /微信，2 个账号，当前数据源/ })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: /钉钉，1 个账号/ })).toBeVisible()
    expect(screen.queryByRole('menuitemradio', { name: /合成账号甲/ })).toBeNull()
    await user.click(screen.getByRole('menuitem', { name: /微信，2 个账号，当前数据源/ }))
    expect(screen.getByRole('menuitemradio', { name: /合成账号甲/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('menuitemradio', { name: /合成账号甲/ })).toHaveAttribute(
      'data-disabled'
    )
    fireEvent.click(screen.getByRole('menuitemradio', { name: /合成账号乙/ }))
    expect(onSelect).toHaveBeenCalledWith('fixture-b')
  })

  it('exposes retry and add actions without changing the active account', async () => {
    const onSelect = vi.fn(),
      onRefresh = vi.fn(),
      onAdd = vi.fn()
    const user = userEvent.setup()
    render(
      <Harness error="合成目录不可用" onSelect={onSelect} onRefresh={onRefresh} onAdd={onAdd} />
    )
    await user.click(screen.getByRole('button', { name: /切换数据源/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('合成目录不可用')
    await user.click(screen.getByRole('menuitem', { name: '刷新账号列表' }))
    expect(onRefresh).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('menuitem', { name: '添加数据源…' }))
    expect(onAdd).toHaveBeenCalledOnce()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('prevents repeated switches while connecting and removes duplicate sidebar account controls', () => {
    render(
      <SourceScopeContext.Provider value={{ active: first, openSwitcher: vi.fn() }}>
        <Harness switching />
        <AccountSummaryFooter
          className="settings-sidebar-account"
          selfInfo={null}
          dbReady={false}
          onClick={vi.fn()}
        />
      </SourceScopeContext.Provider>
    )
    expect(screen.getByRole('button', { name: /切换数据源/ })).toBeDisabled()
    expect(document.querySelector('.account-summary')).toBeNull()
    expect(document.querySelector('.settings-sidebar-account')).toBeNull()
  })

  it('renders the source name at the conversation send entry', () => {
    const { rerender } = render(
      <TooltipProvider>
        <SourceScopeContext.Provider value={{ active: first, openSwitcher: vi.fn() }}>
          <ChatHeader
            contact={{
              md5: 'fixture-contact',
              m_nsUsrName: 'fixture-user',
              m_nsNickName: '合成联系人',
              type: 'user'
            }}
            isGroupChat={false}
            loadedCount={0}
            filteredCount={0}
            contentFilter=""
            isAiLoading={false}
            onContentFilterChange={vi.fn()}
            onTestSend={vi.fn()}
            onOpenAiSettings={vi.fn()}
          />
        </SourceScopeContext.Provider>
      </TooltipProvider>
    )
    expect(screen.getByRole('button', { name: '微信发送' })).toBeVisible()
    rerender(
      <TooltipProvider>
        <SourceScopeContext.Provider
          value={{
            active: { ...first, source: 'fixture', sourceLabel: '合成来源' },
            openSwitcher: vi.fn()
          }}
        >
          <ChatHeader
            contact={{
              md5: 'fixture-contact',
              m_nsUsrName: 'fixture-user',
              m_nsNickName: '合成联系人',
              type: 'user'
            }}
            isGroupChat={false}
            loadedCount={0}
            filteredCount={0}
            contentFilter=""
            isAiLoading={false}
            onContentFilterChange={vi.fn()}
            onTestSend={vi.fn()}
            onOpenAiSettings={vi.fn()}
          />
        </SourceScopeContext.Provider>
      </TooltipProvider>
    )
    expect(screen.getByRole('button', { name: '合成来源发送' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '微信发送' })).toBeNull()
  })

  it('keeps a connection id stable when discovery fills in its nickname', () => {
    const account = {
      id: 'fixture-hash',
      accountRoot: '/fixture/account-a',
      directoryName: 'fixture-a',
      hasSavedDbKey: true,
      loginStatus: 'unknown' as const,
      selectedByInput: false
    }
    const initial = wechatSourceOption(account, account.accountRoot, true)
    const named = wechatSourceOption(
      { ...account, id: 'new-metadata-id', nickname: '合成昵称' },
      account.accountRoot,
      true
    )
    expect(named.id).toBe(initial.id)
    expect(named.label).toBe('合成昵称')
  })
})
