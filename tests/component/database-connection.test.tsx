import { render, screen, within, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DatabaseConnectionPage } from '../../src/renderer/src/components/DatabaseConnectionPage'
import { TooltipProvider } from '../../src/renderer/src/components/ui'

function renderPage(
  overrides: Partial<ComponentProps<typeof DatabaseConnectionPage>> = {}
): RenderResult & { props: ComponentProps<typeof DatabaseConnectionPage> } {
  const props: ComponentProps<typeof DatabaseConnectionPage> = {
    showWechatSetup: true,
    platform: 'win32',
    mode: 'manual' as const,
    dbKey: '',
    dbRoot: '',
    showDbKey: false,
    isFetching: false,
    isConnecting: false,
    guideStep: 1 as const,
    environment: {
      platform: 'win32',
      osVersion: 'Windows fixture',
      appVersion: 'v2.1.6',
      wechatVersion: '4.1.9.57',
      dataStructureVersion: '微信 4.x（WCDB）',
      dataDirectoryDetected: true,
      diagnosticSummary: 'YUYU: v2.1.6',
      autoDetectSupported: true,
      wechatRunning: true,
      accountIdentified: false,
      dbConnected: false,
      encryptionAvailable: true
    },
    accounts: [
      {
        id: 'account-a',
        accountRoot: 'C:\\fixture\\account-a',
        directoryName: 'account-a',
        nickname: '脱敏账号 A',
        wxid: 'wxid_fixture_a',
        hasSavedDbKey: true,
        loginStatus: 'unknown' as const,
        selectedByInput: true
      }
    ],
    selectedAccountId: 'account-a',
    status: '',
    statusKind: 'normal' as const,
    showMacKeyFaq: false,
    macKeyFaqUrl: 'https://fixture.invalid/mac',
    onModeChange: vi.fn(),
    onDbKeyChange: vi.fn(),
    onDbRootChange: vi.fn(),
    onSelectAccount: vi.fn(),
    onSelectDbRoot: vi.fn(),
    onToggleDbKey: vi.fn(),
    onAutoGetKey: vi.fn(),
    onInstallIntelKeyRuntime: vi.fn(),
    onRefreshEnvironment: vi.fn(),
    onGuideNext: vi.fn(),
    onGuideBack: vi.fn(),
    onGuideCancel: vi.fn(),
    onValidateConnection: vi.fn(),
    onCopyDiagnostics: vi.fn(),
    onManualConnect: vi.fn(),
    onPasteKey: vi.fn(),
    onClearKey: vi.fn(),
    ...overrides
  }
  return {
    props,
    ...render(
      <TooltipProvider>
        <DatabaseConnectionPage {...props} />
      </TooltipProvider>
    )
  }
}

describe('DatabaseConnectionPage', () => {
  it.each([false, true])(
    'opens the usage guide without changing setup (WeChat: %s)',
    async (showWechatSetup) => {
      const { props } = renderPage({ showWechatSetup, dbKey: 'a'.repeat(64) })
      const trigger = screen.getByRole('button', { name: '使用说明' })
      await userEvent.click(trigger)
      const guide = within(screen.getByRole('dialog', { name: 'YUYU 使用说明' }))
      expect(guide.getByRole('heading', { name: '可以先进入主界面' })).toBeVisible()
      await userEvent.click(guide.getByRole('tab', { name: '连接数据源' }))
      expect(guide.getByRole('region', { name: '微信使用说明' })).toBeVisible()
      expect(guide.getByRole('region', { name: '钉钉使用说明' })).toBeVisible()
      expect(guide.getByRole('region', { name: 'Telegram 使用说明' })).toBeVisible()
      await userEvent.click(guide.getByRole('tab', { name: '常见问题' }))
      expect(guide.getByRole('heading', { name: '下载好了，为什么还没有聊天记录？' })).toBeVisible()
      await userEvent.click(guide.getByRole('button', { name: '我知道了' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(trigger).toHaveFocus()
      if (showWechatSetup) expect(screen.getByLabelText('数据库密钥')).toHaveValue('a'.repeat(64))
      else expect(screen.getByRole('heading', { name: '选择你的开始方式' })).toBeVisible()
      expect(props.onAutoGetKey).not.toHaveBeenCalled()
      expect(props.onManualConnect).not.toHaveBeenCalled()
      expect(props.onDbKeyChange).not.toHaveBeenCalled()
      expect(props.onModeChange).not.toHaveBeenCalled()
      await userEvent.click(trigger)
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(trigger).toHaveFocus()
    }
  )

  it('allows inspecting another source before connecting WeChat', async () => {
    const onAddSource = vi.fn()
    renderPage({ onAddSource, showWechatSetup: false })
    await userEvent.click(screen.getByRole('button', { name: '配置钉钉' }))
    expect(onAddSource).toHaveBeenCalledOnce()
  })

  it.each(['4.1.13', '4.1.15'])(
    'guides Apple Silicon users on WeChat %s to log in while key capture is active',
    async (wechatVersion) => {
      const onAutoGetKey = vi.fn()
      const { props, rerender } = renderPage({
        platform: 'darwin',
        mode: 'automatic',
        guideStep: 3,
        onAutoGetKey,
        environment: {
          platform: 'darwin',
          architecture: 'arm64',
          osVersion: 'macOS fixture',
          appVersion: 'v2.3.0',
          wechatVersion,
          dataStructureVersion: '微信 4.x（WCDB）',
          dataDirectoryDetected: true,
          diagnosticSummary: 'fixture',
          autoDetectSupported: true,
          wechatRunning: true,
          accountIdentified: true,
          dbConnected: false,
          encryptionAvailable: true
        }
      })

      await userEvent.click(screen.getByRole('button', { name: '开始获取密钥' }))
      expect(onAutoGetKey).toHaveBeenCalledOnce()

      rerender(
        <TooltipProvider>
          <DatabaseConnectionPage {...props} mode="automatic" guideStep={4} isFetching />
        </TooltipProvider>
      )
      expect(screen.getByText('正在监听 macOS 登录密钥')).toBeVisible()
      expect(screen.getByText(/立即回到微信点击登录/)).toBeVisible()
      expect(screen.getByRole('button', { name: '正在获取密钥…' })).toBeDisabled()
    }
  )

  it('uses the automatic Intel Mac flow without exposing implementation details', () => {
    renderPage({
      platform: 'darwin',
      mode: 'automatic',
      guideStep: 3,
      environment: {
        platform: 'darwin',
        architecture: 'x64',
        osVersion: 'macOS fixture',
        appVersion: 'v2.1.6',
        wechatVersion: '4.1.10',
        dataStructureVersion: '微信 4.x（WCDB）',
        dataDirectoryDetected: true,
        diagnosticSummary: 'fixture',
        autoDetectSupported: true,
        wechatRunning: true,
        accountIdentified: true,
        dbConnected: false,
        encryptionAvailable: true,
        pythonAvailable: true,
        fridaAvailable: true,
        wechatAdhocSigned: true,
        sipDisabled: true
      }
    })

    expect(screen.getByRole('button', { name: '开始获取密钥' })).toBeVisible()
    expect(screen.queryByText(/管理员授权|电脑密码/)).not.toBeInTheDocument()
    // SIP is a user prerequisite, not an implementation detail: seeing it in the
    // UI is expected whenever the key cannot be captured without it.
    expect(screen.queryByText(/Frida|Python|重新签名/)).not.toBeInTheDocument()
  })

  it('renders a discovered nickname and avatar before connection', () => {
    const { container } = renderPage({
      mode: 'automatic',
      accounts: [
        {
          id: 'account-a',
          accountRoot: 'C:\\fixture\\account-a',
          directoryName: 'account-a',
          nickname: '首次识别账号',
          wxid: 'fixture_account',
          avatar: 'https://wx.qlogo.cn/fixture/avatar',
          hasSavedDbKey: false,
          loginStatus: 'unknown',
          selectedByInput: true
        }
      ]
    })

    expect(screen.getByText('首次识别账号')).toBeVisible()
    expect(screen.getByText('fixture_account')).toBeVisible()
    expect(container.querySelector('.database-account-avatar img')).toHaveAttribute(
      'src',
      'https://wx.qlogo.cn/fixture/avatar'
    )
  })

  it('shows a directory-derived wxid without pretending profile data is available', () => {
    renderPage({
      mode: 'automatic',
      accounts: [
        {
          id: 'account-b',
          accountRoot: 'C:\\fixture\\wxid_fixture_b_ab12',
          directoryName: 'wxid_fixture_b_ab12',
          wxid: 'wxid_fixture',
          hasSavedDbKey: false,
          loginStatus: 'other',
          selectedByInput: false
        }
      ],
      selectedAccountId: ''
    })

    expect(screen.getByText('微信账号 wxid_fixture')).toBeVisible()
    expect(screen.getByText('昵称和头像需连接此账号后读取')).toBeVisible()
  })

  it('keeps connect disabled until a valid 64-character key is supplied', () => {
    const { rerender, props } = renderPage()
    expect(screen.getByRole('button', { name: '连接数据库' })).toBeDisabled()
    rerender(
      <TooltipProvider>
        <DatabaseConnectionPage {...props} dbKey={'a'.repeat(64)} />
      </TooltipProvider>
    )
    expect(screen.getByRole('button', { name: '连接数据库' })).toBeEnabled()
  })

  it('shows a recoverable error and keeps form actions available', async () => {
    const onManualConnect = vi.fn()
    renderPage({
      dbKey: 'b'.repeat(64),
      status: '数据库密钥无效，请重新输入',
      statusKind: 'error',
      onManualConnect
    })
    expect(screen.getByText('数据库密钥无效，请重新输入')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '连接数据库' }))
    expect(onManualConnect).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '从剪贴板粘贴并安全保存' })).toBeEnabled()
  })

  it('restores directory editing and selection after a failed connection', async () => {
    const onDbRootChange = vi.fn()
    const onSelectDbRoot = vi.fn()
    renderPage({
      dbKey: 'b'.repeat(64),
      dbRoot: 'Z:\\missing-wechat-data',
      status: '微信数据目录不存在，请重新选择目录',
      statusKind: 'error',
      onDbRootChange,
      onSelectDbRoot
    })

    await userEvent.clear(screen.getByLabelText('微信数据目录'))
    await userEvent.type(screen.getByLabelText('微信数据目录'), 'C:\\fixture-account')
    await userEvent.click(screen.getByRole('button', { name: '选择目录' }))

    expect(onDbRootChange).toHaveBeenCalled()
    expect(onSelectDbRoot).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '连接数据库' })).toBeEnabled()
  })

  it('supports forward, back, cancel and safe diagnostic actions in onboarding', async () => {
    const onGuideNext = vi.fn()
    const onCopyDiagnostics = vi.fn()
    const { rerender, props } = renderPage({
      mode: 'automatic',
      guideStep: 1,
      onGuideNext,
      onCopyDiagnostics
    })

    expect(screen.getByText('4.1.9.57')).toBeVisible()
    expect(screen.getByText('微信 4.x（WCDB）')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '复制脱敏诊断摘要' }))
    await userEvent.click(screen.getByRole('button', { name: '检查完成，继续' }))
    expect(onCopyDiagnostics).toHaveBeenCalledOnce()
    expect(onGuideNext).toHaveBeenCalledOnce()

    rerender(
      <TooltipProvider>
        <DatabaseConnectionPage {...props} mode="automatic" guideStep={2} />
      </TooltipProvider>
    )
    expect(screen.getByRole('button', { name: '我已准备好' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '返回上一步' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '取消并重新检查' })).toBeEnabled()
  })

  it('keeps mode, account and key visibility callbacks unchanged', async () => {
    const onModeChange = vi.fn()
    const onSelectAccount = vi.fn()
    const onToggleDbKey = vi.fn()
    const { props, rerender } = renderPage({
      mode: 'automatic',
      onModeChange,
      onSelectAccount,
      onToggleDbKey
    })

    await userEvent.click(screen.getByRole('tab', { name: /高级用户/ }))
    expect(onModeChange).toHaveBeenCalledWith('manual')
    await userEvent.click(screen.getByRole('button', { name: /脱敏账号 A/ }))
    expect(onSelectAccount).toHaveBeenCalledWith(props.accounts[0])

    rerender(
      <TooltipProvider>
        <DatabaseConnectionPage {...props} mode="manual" />
      </TooltipProvider>
    )
    await userEvent.click(screen.getByRole('button', { name: '显示密钥' }))
    expect(onToggleDbKey).toHaveBeenCalledOnce()
  })

  it('provides the official Visual C++ runtime download on Windows', () => {
    renderPage({
      status: '当前 Windows 缺少 Microsoft Visual C++ 运行库',
      statusKind: 'error'
    })

    expect(screen.getByRole('link', { name: '下载运行库' })).toHaveAttribute(
      'href',
      'https://aka.ms/vc14/vc_redist.x64.exe'
    )
  })
})

it('enters the workspace without requesting a connection and prevents leaving during connection', async () => {
  const onEnterWorkspace = vi.fn()
  const { props, rerender } = renderPage({ onEnterWorkspace })
  await userEvent.click(screen.getByRole('button', { name: '暂不连接，进入主界面' }))
  expect(onEnterWorkspace).toHaveBeenCalledOnce()
  expect(props.onManualConnect).not.toHaveBeenCalled()
  expect(props.onAutoGetKey).not.toHaveBeenCalled()
  rerender(
    <TooltipProvider>
      <DatabaseConnectionPage {...props} isConnecting />
    </TooltipProvider>
  )
  expect(screen.getByRole('button', { name: '暂不连接，进入主界面' })).toBeDisabled()
})

it('starts with optional multi-source routes and opens only the selected WeChat steps', async () => {
  const { props } = renderPage({
    showWechatSetup: undefined,
    onEnterWorkspace: vi.fn(),
    onConfigureSource: vi.fn()
  })
  expect(screen.getByRole('heading', { name: '选择你的开始方式' })).toBeVisible()
  expect(screen.queryByRole('list', { name: '微信连接阶段' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: '配置 Telegram' }))
  expect(props.onConfigureSource).toHaveBeenCalledWith('telegram')
  expect(props.onAutoGetKey).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: '配置微信' }))
  expect(screen.getByRole('heading', { name: '开始连接微信' })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: '← 返回使用方式' }))
  expect(screen.getByRole('heading', { name: '选择你的开始方式' })).toBeVisible()
})

it.each([
  [1, '检查环境'],
  [3, '准备并获取密钥'],
  [5, '验证连接']
] as const)('labels the current WeChat phase at internal step %s', (guideStep, label) => {
  renderPage({ mode: 'automatic', guideStep })
  const phase = screen
    .getByRole('list', { name: '微信连接阶段' })
    .querySelector('[aria-current="step"]')
  expect(phase).toHaveTextContent(label)
})
