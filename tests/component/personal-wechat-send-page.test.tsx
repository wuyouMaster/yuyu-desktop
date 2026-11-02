import { SourceScopeContext } from '../../src/renderer/src/features/data-sources/source-context'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PersonalWechatSendPage } from '../../src/renderer/src/features/settings/pages/PersonalWechatSendPage'

vi.mock('../../src/renderer/src/utils/runtime-environment', () => ({
  isMac: true,
  isWindows: false,
  runtimePlatform: 'darwin',
  supportsPersonalWechatSend: true
}))

const getCapability = vi.fn()
const getSenderStatus = vi.fn()
const getRuntimeStatus = vi.fn()
const onRuntimeProgress = vi.fn(() => vi.fn())
const downloadRuntime = vi.fn()
const cancelRuntimeDownload = vi.fn()
const removeRuntime = vi.fn()
const openRuntimeDirectory = vi.fn()
const rebindSender = vi.fn()
const getSettings = vi.fn()
const setSettings = vi.fn()

const senderStatus = {
  state: 'online' as const,
  platform: 'darwin',
  arch: 'arm64',
  sipDisabled: true,
  wechatRunning: true,
  wechatPid: 4668,
  boundWechatPid: 4668,
  oneBotPid: 5401,
  endpoint: '127.0.0.1:58080',
  endpointReady: true,
  wechatVersion: '4.1.11.53',
  runtimeReady: true,
  attachReady: true,
  baseAddress: '0x114ef8000',
  baseAddressReady: true,
  textHookInstalled: true,
  textHookReady: true,
  imageHookInstalled: true,
  imageHookReady: true,
  messageListenerReady: true,
  canSend: true,
  canSendText: true,
  canSendImage: true,
  canSendVoice: true,
  message: '个人微信已绑定'
}

const readyRuntime = {
  version: 'v0.0.18',
  state: 'ready' as const,
  downloadedBytes: 66_599_785,
  totalBytes: 66_599_785,
  progress: 1,
  platform: 'darwin' as NodeJS.Platform,
  architecture: 'arm64',
  supported: true,
  removable: true,
  directory: '/tmp/personal-wechat-runtime'
}

const capability = {
  supported: true,
  ready: true,
  status: 'ready' as const,
  capabilities: { text: true, image: true, voice: true },
  senderStatus,
  message: '个人微信发送能力已就绪'
}

describe('PersonalWechatSendPage on macOS', () => {
  beforeEach(() => {
    getCapability.mockReset().mockResolvedValue(capability)
    getSenderStatus.mockReset().mockResolvedValue(senderStatus)
    getRuntimeStatus.mockReset().mockResolvedValue(readyRuntime)
    onRuntimeProgress.mockReset().mockReturnValue(vi.fn())
    downloadRuntime.mockReset().mockResolvedValue({ success: true, status: readyRuntime })
    cancelRuntimeDownload.mockReset().mockResolvedValue({ success: true })
    removeRuntime.mockReset().mockResolvedValue({
      ...readyRuntime,
      state: 'missing',
      downloadedBytes: 0,
      progress: 0,
      removable: false,
      directory: undefined
    })
    openRuntimeDirectory.mockReset().mockResolvedValue({ success: true })
    rebindSender.mockReset().mockResolvedValue(senderStatus)
    getSettings.mockReset().mockResolvedValue({
      settings: { personalWechatTextBackend: 'onebot' }
    })
    setSettings.mockReset().mockResolvedValue({
      settings: { personalWechatTextBackend: 'onebot' }
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getPersonalWechatSendCapability: getCapability,
        getPersonalWechatSenderStatus: getSenderStatus,
        getPersonalWechatRuntimeStatus: getRuntimeStatus,
        onPersonalWechatRuntimeProgress: onRuntimeProgress,
        downloadPersonalWechatRuntime: downloadRuntime,
        cancelPersonalWechatRuntimeDownload: cancelRuntimeDownload,
        removePersonalWechatRuntime: removeRuntime,
        openPersonalWechatRuntimeDirectory: openRuntimeDirectory,
        rebindPersonalWechatSender: rebindSender,
        getSettings,
        setSettings
      }
    })
  })

  it('renders configuration immediately and only requests one sender probe', async () => {
    let finish!: (value: typeof capability) => void
    getCapability.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    render(<PersonalWechatSendPage onNotice={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /C 原生工具/ })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('正在检测微信连接')
    expect(screen.getByText('配置与检测')).toBeVisible()
    expect(getSenderStatus).not.toHaveBeenCalled()
    await act(async () => {
      finish(capability)
    })
    expect(await screen.findByText(capability.message)).toBeVisible()
    expect(getCapability).toHaveBeenCalledOnce()
  })

  it('shows the previous result on return, then clears it if live detection fails', async () => {
    const first = render(<PersonalWechatSendPage onNotice={vi.fn()} />)
    await screen.findByText(capability.message)
    first.unmount()
    let fail!: (reason: Error) => void
    getCapability.mockReturnValue(
      new Promise((_, reject) => {
        fail = reject
      })
    )
    render(<PersonalWechatSendPage onNotice={vi.fn()} />)
    expect(screen.getByText(capability.message)).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('上次检测结果')
    expect(screen.getByRole('button', { name: '检测中…' })).toBeDisabled()
    await act(async () => {
      fail(new Error('fixture-detection-failed'))
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('fixture-detection-failed')
    expect(screen.queryByText(capability.message)).not.toBeInTheDocument()
  })

  it('shares an in-flight probe across rapid unmount and remount', async () => {
    let finish!: (value: typeof capability) => void
    getCapability.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const first = render(<PersonalWechatSendPage onNotice={vi.fn()} />)
    first.unmount()
    render(<PersonalWechatSendPage onNotice={vi.fn()} />)
    expect(getCapability).toHaveBeenCalledOnce()
    await act(async () => {
      finish(capability)
    })
    expect(await screen.findByText(capability.message)).toBeVisible()
  })

  it('does not block native readiness on optional runtime information', async () => {
    getSettings.mockResolvedValue({ settings: { personalWechatTextBackend: 'native' } })
    getRuntimeStatus.mockReturnValue(new Promise(() => {}))
    render(<PersonalWechatSendPage onNotice={vi.fn()} />)
    expect(await screen.findByText(capability.message)).toBeVisible()
    expect(screen.getByRole('button', { name: '重新检测' })).toBeEnabled()
  })

  it('keeps OneBot runtime management on the WeChat send page', async () => {
    const user = userEvent.setup()
    render(<PersonalWechatSendPage onNotice={vi.fn()} />)

    expect(await screen.findByText('OneBot v0.0.18')).toBeVisible()
    expect(screen.getAllByText('已就绪')).not.toHaveLength(0)
    await user.click(screen.getByRole('button', { name: '打开目录' }))
    expect(openRuntimeDirectory).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: '卸载组件' }))
    await waitFor(() => expect(removeRuntime).toHaveBeenCalledOnce())

    await user.click(screen.getByRole('button', { name: '支持版本' }))
    const versionsDialog = screen.getByRole('dialog', { name: '支持的微信版本' })
    expect(versionsDialog).toBeVisible()
    expect(versionsDialog).toHaveTextContent('4.1.11.53')
  })

  it('downloads a missing macOS runtime from the send page', async () => {
    getRuntimeStatus.mockResolvedValue({
      ...readyRuntime,
      state: 'missing',
      downloadedBytes: 0,
      progress: 0,
      removable: false,
      directory: undefined
    })
    const onNotice = vi.fn()
    render(<PersonalWechatSendPage onNotice={onNotice} />)

    await userEvent.setup().click(await screen.findByRole('button', { name: '下载组件' }))
    await waitFor(() => expect(downloadRuntime).toHaveBeenCalledOnce())
    expect(onNotice).toHaveBeenCalledWith('微信发送组件已准备好')
  })

  it('shows an incompatible runtime as unavailable and disables binding', async () => {
    getSettings.mockResolvedValue({ settings: { personalWechatTextBackend: 'native' } })
    const incompatibleSender = {
      ...senderStatus,
      state: 'runtime_profile_unmatched' as const,
      boundWechatPid: undefined,
      oneBotPid: undefined,
      endpointReady: false,
      attachReady: false,
      baseAddress: undefined,
      baseAddressReady: false,
      textHookInstalled: false,
      textHookReady: false,
      imageHookInstalled: false,
      imageHookReady: false,
      messageListenerReady: false,
      canSend: false,
      canSendText: false,
      canSendImage: false,
      canSendVoice: false,
      message: '微信版本已匹配，但当前核心运行时尚未匹配已验证的 xsend profile',
      error: '当前运行时指纹不在 xsend 支持列表中',
      xsend: {
        supported: true,
        ready: false,
        state: 'runtime_profile_unmatched' as const,
        platform: 'darwin',
        arch: 'arm64',
        installed: true,
        wechatRunning: true,
        wechatPid: 4668,
        wechatBuild: '269631',
        message: '微信版本已匹配，但当前核心运行时尚未匹配已验证的 xsend profile',
        error: '当前运行时指纹不在 xsend 支持列表中'
      }
    }
    getCapability.mockResolvedValue({
      supported: true,
      ready: false,
      status: 'needs_profile',
      capabilities: { text: false, image: false, voice: false },
      senderStatus: incompatibleSender,
      message: incompatibleSender.message,
      error: incompatibleSender.error
    })
    getSenderStatus.mockResolvedValue(incompatibleSender)

    render(<PersonalWechatSendPage onNotice={vi.fn()} />)

    expect(
      await screen.findByText(
        '已找到微信，但当前运行组件尚未匹配。先重新检查，再决定是否需要更新。'
      )
    ).toBeVisible()
    expect(screen.getByText('需要匹配')).toBeVisible()
    expect(screen.getByRole('button', { name: '开始准备' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '绑定微信' })).not.toBeInTheDocument()
    expect(rebindSender).not.toHaveBeenCalled()

    await userEvent.setup().click(screen.getByRole('button', { name: '开始准备' }))
    await waitFor(() => expect(getCapability).toHaveBeenCalledTimes(2))
    expect(
      within(screen.getByRole('region', { name: '微信消息功能配置' })).getByRole('button', {
        name: '重新检查'
      })
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: '启用文字发送' })).not.toBeInTheDocument()
  })

  it('enables 4.1.13 text sending without requiring the OneBot runtime', async () => {
    getSettings.mockResolvedValue({ settings: { personalWechatTextBackend: 'native' } })
    const xsendPendingStatus = {
      ...senderStatus,
      state: 'runtime_missing' as const,
      boundWechatPid: undefined,
      oneBotPid: undefined,
      endpointReady: false,
      runtimeReady: false,
      attachReady: false,
      baseAddress: undefined,
      baseAddressReady: false,
      textHookInstalled: false,
      textHookReady: false,
      imageHookInstalled: false,
      imageHookReady: false,
      messageListenerReady: false,
      canSend: false,
      canSendText: false,
      canSendImage: false,
      canSendVoice: false,
      message: '微信 4.1.13 已匹配，请启用当前登录进程的文字发送能力',
      xsend: {
        supported: true,
        ready: false,
        state: 'failed' as const,
        platform: 'darwin',
        arch: 'arm64',
        installed: true,
        wechatRunning: true,
        wechatPid: 4668,
        wechatBuild: '269631',
        message: 'xsend resident 状态检查失败',
        error: 'Command failed: xsend-v3-resident --status'
      }
    }
    const xsendReadyStatus = {
      ...xsendPendingStatus,
      state: 'online' as const,
      canSend: true,
      canSendText: true,
      message: '微信 4.1.13 文字发送已就绪',
      xsend: {
        ...xsendPendingStatus.xsend,
        ready: true,
        state: 'ready' as const,
        message: 'xsend resident 已就绪，可发送文字'
      }
    }
    const pendingCapability = {
      supported: true,
      ready: false,
      status: 'needs_binding' as const,
      capabilities: { text: false, image: false, voice: false },
      senderStatus: xsendPendingStatus,
      message: xsendPendingStatus.message
    }
    const readyXsendCapability = {
      supported: true,
      ready: true,
      status: 'ready' as const,
      capabilities: { text: true, image: false, voice: false },
      senderStatus: xsendReadyStatus,
      message: xsendReadyStatus.message
    }
    getCapability.mockResolvedValueOnce(pendingCapability).mockResolvedValue(readyXsendCapability)
    getSenderStatus.mockResolvedValue(xsendPendingStatus)
    getRuntimeStatus.mockResolvedValue({
      ...readyRuntime,
      state: 'missing',
      downloadedBytes: 0,
      progress: 0,
      removable: false,
      directory: undefined
    })
    rebindSender.mockResolvedValue(xsendReadyStatus)
    render(<PersonalWechatSendPage onNotice={vi.fn()} />)

    const enable = await screen.findByRole('button', { name: '启用文字发送' })
    expect(screen.getByText('1 / 3 已完成')).toBeVisible()
    expect(screen.getByText('启用文字发送', { selector: 'strong' }).closest('li')).toHaveAttribute(
      'aria-current',
      'step'
    )
    expect(screen.queryByRole('button', { name: '绑定微信' })).not.toBeInTheDocument()

    await userEvent.setup().click(enable)

    await waitFor(() => expect(rebindSender).toHaveBeenCalledOnce())
    expect(
      await screen.findByText('微信 4.1.13 文字发送已就绪', { selector: 'strong' })
    ).toBeVisible()
  })

  it('never displays another source account readiness while a fresh probe is pending', async () => {
    const source = {
      id: 'fixture-a',
      source: 'wechat',
      sourceLabel: '微信',
      label: '合成账号甲',
      status: 'connected' as const
    }
    const first = render(
      <SourceScopeContext.Provider value={{ active: source, openSwitcher: vi.fn() }}>
        <PersonalWechatSendPage onNotice={vi.fn()} />
      </SourceScopeContext.Provider>
    )
    await screen.findByText(capability.message)
    first.unmount()
    let finish!: (value: typeof capability) => void
    getCapability.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    render(
      <SourceScopeContext.Provider
        value={{
          active: { ...source, id: 'fixture-b', label: '合成账号乙' },
          openSwitcher: vi.fn()
        }}
      >
        <PersonalWechatSendPage onNotice={vi.fn()} />
      </SourceScopeContext.Provider>
    )
    expect(screen.queryByText(capability.message)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在检测微信连接')
    expect(screen.getByText('微信 · 合成账号乙 的发送配置')).toBeVisible()
    expect(getCapability).toHaveBeenCalledTimes(2)
    await act(async () => finish(capability))
  })

  it('opens the chat from the completed guide without rebinding or sending', async () => {
    const onOpenChat = vi.fn()
    render(<PersonalWechatSendPage onNotice={vi.fn()} onOpenChat={onOpenChat} />)
    await userEvent.setup().click(await screen.findByRole('button', { name: '前往聊天发送' }))
    expect(onOpenChat).toHaveBeenCalledOnce()
    expect(rebindSender).not.toHaveBeenCalled()
    expect(
      screen.getByRole('list', { name: '发送设置步骤' }).querySelector('[aria-current]')
    ).toBeNull()
  })

  it('guides OneBot from download to connection and verification with only one active step', async () => {
    const disconnected = {
      ...senderStatus,
      state: 'stopped',
      runtimeReady: false,
      canSend: false,
      canSendText: false,
      canSendImage: false,
      canSendVoice: false,
      attachReady: false
    }
    const connected = {
      ...disconnected,
      state: 'hook_not_ready',
      runtimeReady: true,
      attachReady: true
    }
    const notReady = {
      ...capability,
      ready: false,
      status: 'needs_binding',
      senderStatus: disconnected,
      capabilities: { text: false, image: false, voice: false }
    }
    getCapability.mockResolvedValue(notReady)
    getRuntimeStatus.mockResolvedValue({ ...readyRuntime, state: 'missing', removable: false })
    const user = userEvent.setup()
    render(<PersonalWechatSendPage onNotice={vi.fn()} />)
    const guide = within(screen.getByRole('region', { name: '微信消息功能配置' }))
    await user.click(await guide.findByRole('button', { name: '下载并继续' }))
    expect(downloadRuntime).toHaveBeenCalledOnce()
    expect(guide.queryByRole('button', { name: '下载并继续' })).not.toBeInTheDocument()
    expect(guide.queryByRole('button', { name: '检测发送能力' })).not.toBeInTheDocument()
    rebindSender.mockResolvedValue(connected)
    getCapability.mockResolvedValue({ ...notReady, senderStatus: connected })
    await user.click(await guide.findByRole('button', { name: '连接微信' }))
    expect(await guide.findByRole('button', { name: '检测发送能力' })).toBeVisible()
    expect(guide.queryByRole('button', { name: '连接微信' })).not.toBeInTheDocument()
    expect(guide.getByRole('list').querySelectorAll('[aria-current="step"]')).toHaveLength(1)
    getCapability.mockResolvedValue(capability)
    getRuntimeStatus.mockResolvedValue(readyRuntime)
    await user.click(guide.getByRole('button', { name: '检测发送能力' }))
    expect(await guide.findByText('全部完成')).toBeVisible()
  })

  it('offers a login recovery action when WeChat is not running', async () => {
    getSettings.mockResolvedValue({ settings: { personalWechatTextBackend: 'native' } })
    getCapability.mockResolvedValue({
      ...capability,
      ready: false,
      senderStatus: { ...senderStatus, state: 'wechat_not_running', canSendText: false }
    })
    render(<PersonalWechatSendPage onNotice={vi.fn()} />)
    expect(await screen.findByRole('button', { name: '我已登录，重新检查' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '启用文字发送' })).not.toBeInTheDocument()
  })

  it('persists the selected text backend and hides OneBot management in native mode', async () => {
    const user = userEvent.setup()
    getSettings
      .mockReset()
      .mockResolvedValueOnce({ settings: { personalWechatTextBackend: 'native' } })
      .mockResolvedValue({ settings: { personalWechatTextBackend: 'onebot' } })
    render(<PersonalWechatSendPage onNotice={vi.fn()} />)

    const nativeTab = await screen.findByRole('tab', { name: /C 原生工具/ })
    expect(nativeTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText('OneBot v0.0.18')).not.toBeInTheDocument()
    expect(screen.getByText('C 原生工具用于文字消息；图片和语音需要 OneBot。')).toBeVisible()

    await user.click(screen.getByRole('tab', { name: /^OneBot/ }))

    await waitFor(() =>
      expect(setSettings).toHaveBeenCalledWith({ personalWechatTextBackend: 'onebot' })
    )
    expect(await screen.findByText('OneBot v0.0.18')).toBeVisible()
  })
})
