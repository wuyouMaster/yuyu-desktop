import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeManagerSection } from '../../src/renderer/src/features/settings/components/RuntimeManagerSection'
const api = { listRuntimeInstallations: vi.fn(), installRuntime: vi.fn() }
const item = {
  application: 'wechat',
  version: '0.1.0-dev.1',
  target: 'darwin-arm64',
  status: 'not-installed'
}
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'api', { configurable: true, value: api })
  api.listRuntimeInstallations.mockResolvedValue([item])
})
describe('runtime manager', () => {
  it('installs the explicit selected version and displays verified status', async () => {
    const user = userEvent.setup()
    api.installRuntime.mockImplementation(async () => {
      api.listRuntimeInstallations.mockResolvedValue([{ ...item, status: 'installed' }])
    })
    render(<RuntimeManagerSection />)
    expect(screen.getByText(/运行时均为实验性版本，兼容性取决于客户端版本/)).toBeVisible()
    await user.click(await screen.findByRole('button', { name: '安装 微信' }))
    expect(api.installRuntime).toHaveBeenCalledWith({
      application: 'wechat',
      version: '0.1.0-dev.1'
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('重启'))
    expect(screen.getByRole('button', { name: '安装 微信' })).toBeDisabled()
  })
  it('requires a custom link and sends it only when selected', async () => {
    const user = userEvent.setup()
    api.installRuntime.mockResolvedValue(undefined)
    render(<RuntimeManagerSection />)
    await user.click(await screen.findByRole('checkbox', { name: '使用自定义链接下载 微信' }))
    expect(screen.getByRole('button', { name: '安装 微信' })).toBeDisabled()
    await user.type(
      screen.getByRole('textbox', { name: '微信下载链接' }),
      'https://cdn.example.invalid/runtime.zip'
    )
    await user.click(screen.getByRole('button', { name: '安装 微信' }))
    expect(api.installRuntime).toHaveBeenLastCalledWith({
      ...{ application: item.application, version: item.version },
      downloadUrl: 'https://cdn.example.invalid/runtime.zip'
    })
    await waitFor(() => expect(screen.getByRole('button', { name: '安装 微信' })).toBeEnabled())
    await user.click(screen.getByRole('checkbox', { name: '使用自定义链接下载 微信' }))
    await user.click(screen.getByRole('button', { name: '安装 微信' }))
    expect(api.installRuntime).toHaveBeenLastCalledWith({
      application: item.application,
      version: item.version
    })
  })
  it('shows failed downloads without reporting installed', async () => {
    api.installRuntime.mockRejectedValue(new Error('指定 Release 产物尚未发布'))
    render(<RuntimeManagerSection />)
    await userEvent.click(await screen.findByRole('button', { name: '安装 微信' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('尚未发布'))
    expect(screen.getByRole('button', { name: '重试安装 微信' })).toBeEnabled()
  })
})

it('restores live download progress and exposes cancel after reopening', async () => {
  const cancel = vi.fn().mockResolvedValue(undefined)
  Object.assign(api, {
    getRuntimeInstallProgress: vi.fn().mockResolvedValue({
      application: 'wechat',
      phase: 'downloading',
      downloaded: 1048576,
      total: 2097152
    }),
    cancelRuntimeInstall: cancel
  })
  render(<RuntimeManagerSection />)
  await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('value', '50'))
  expect(screen.getByText('1.0 MB / 2.0 MB · 50%')).toBeVisible()
  expect(screen.getByRole('button', { name: '安装进行中…' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: '取消安装' }))
  expect(cancel).toHaveBeenCalledOnce()
})

it('does not invent a percentage when the download size is unknown', async () => {
  Object.assign(api, {
    getRuntimeInstallProgress: vi
      .fn()
      .mockResolvedValue({ application: 'wechat', phase: 'downloading', downloaded: 1048576 })
  })
  render(<RuntimeManagerSection />)
  await waitFor(() => expect(screen.getByRole('progressbar')).not.toHaveAttribute('value'))
  expect(screen.getByText('1.0 MB · 下载源未提供总大小')).toBeVisible()
})
