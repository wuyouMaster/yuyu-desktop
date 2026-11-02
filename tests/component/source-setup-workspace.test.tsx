import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceSetupWorkspace } from '../../src/renderer/src/features/data-sources/SourceSetupWorkspace'
import { RuntimeRestartButton } from '../../src/renderer/src/features/settings/components/RuntimeRestartButton'
import {
  prefersWorkspace,
  pendingSourceSetup
} from '../../src/renderer/src/features/data-sources/workspace-entry'

const statuses = ['wechat', 'dingtalk', 'telegram'].map((application) => ({
  application,
  version: '0.1.0-dev.1',
  target: 'darwin-arm64',
  status: 'not-installed'
}))
beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      listRuntimeInstallations: vi.fn().mockResolvedValue(statuses),
      getRuntimeInstallProgress: vi.fn().mockResolvedValue(null),
      restartForRuntime: vi.fn().mockResolvedValue(undefined)
    }
  })
})
afterEach(() => localStorage.clear())
describe('source setup workspace', () => {
  it('shows missing runtimes without claiming a connection and keeps offline JSON import available', async () => {
    const connect = vi.fn(),
      importJson = vi.fn()
    render(<SourceSetupWorkspace onConnect={connect} onImportTelegram={importJson} />)
    await waitFor(() => expect(screen.getAllByText('尚未安装运行时')).toHaveLength(3))
    expect(screen.getByRole('button', { name: '连接微信' })).toBeDisabled()
    const card = screen.getByRole('region', { name: '微信开始使用' })
    await userEvent.click(within(card).getByRole('button', { name: '安装运行时' }))
    const dialog = screen.getByRole('dialog', { name: '管理应用运行时' })
    expect(within(dialog).getByText('微信')).toBeVisible()
    expect(within(dialog).queryByText('Telegram')).toBeNull()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: '导入 JSON（无需运行时）' }))
    expect(importJson).toHaveBeenCalledOnce()
    expect(connect).not.toHaveBeenCalled()
  })
  it('requires restart for new installs and connects only the selected ready source', async () => {
    vi.mocked(window.api.listRuntimeInstallations).mockResolvedValue(
      statuses.map((s) => ({
        ...s,
        status: 'installed',
        restartRequired: s.application === 'wechat'
      }))
    )
    const connect = vi.fn()
    render(<SourceSetupWorkspace onConnect={connect} onImportTelegram={vi.fn()} />)
    await screen.findByText('安装完成，重启后启用')
    expect(screen.queryByRole('button', { name: '连接微信' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '连接钉钉' }))
    expect(connect).toHaveBeenCalledWith('dingtalk')
  })
  it('persists the selected setup only after restart confirmation and reports restart errors', async () => {
    vi.mocked(window.api.restartForRuntime).mockRejectedValue(new Error('synthetic error'))
    render(<RuntimeRestartButton application="telegram" />)
    await userEvent.click(screen.getByRole('button', { name: '重启并继续配置' }))
    expect(window.api.restartForRuntime).not.toHaveBeenCalled()
    expect(prefersWorkspace()).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: '确认重启' }))
    expect(prefersWorkspace()).toBe(true)
    expect(pendingSourceSetup()).toBe('telegram')
    expect(await screen.findByRole('alert')).toHaveTextContent('未能重启')
    expect(window.api.restartForRuntime).toHaveBeenCalledOnce()
  })
})

it('explains incompatible published versions without suggesting they are ready', async () => {
  vi.mocked(window.api.listRuntimeInstallations).mockResolvedValue([{...statuses[0],status:'unsupported',error:'此运行时版本尚未提供应用所需接口'}])
  render(<SourceSetupWorkspace onConnect={vi.fn()} onImportTelegram={vi.fn()} />)
  expect(await screen.findByText('此运行时版本尚未提供应用所需接口')).toBeVisible()
  expect(screen.getByRole('button',{name:'连接微信'})).toBeDisabled()
  expect(within(screen.getByRole('region',{name:'微信开始使用'})).getByRole('button',{name:'安装运行时'})).toBeDisabled()
})
