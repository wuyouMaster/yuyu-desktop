import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddDataSourceDialog } from '../../src/renderer/src/features/data-sources/AddDataSourceDialog'
import type { DingtalkLocalInspection } from '../../src/shared/dingtalk-local'

const detected: DingtalkLocalInspection = {
  source: 'dingtalk',
  state: 'detected',
  checkedAt: '2026-01-01T00:00:00Z',
  truncated: false,
  client: { version: 'fixture-version', build: 'fixture-build' },
  message: '已发现本地数据。聊天读取尚未接通。',
  accounts: [
    {
      id: 'fixture-account',
      label: '本地账号 1',
      state: 'needs_decoder',
      canRead: false,
      canSend: false,
      databases: [{ name: 'dingtalk.db', format: 'encoded_or_unknown', walPresent: true }]
    }
  ]
}

const readable = {
  ...detected,
  message: '已发现并可连接本机钉钉只读数据。',
  accounts: [
    {
      ...detected.accounts[0],
      state: 'ready' as const,
      canRead: true
    }
  ]
}

afterEach(() => vi.unstubAllGlobals())

describe('AddDataSourceDialog', () => {
  it('keeps WeChat setup available and does not probe until requested', async () => {
    const inspect = vi.fn().mockResolvedValue(detected)
    window.api = { inspectDingtalkLocalSource: inspect } as unknown as typeof window.api
    const onAddWechat = vi.fn()
    render(
      <AddDataSourceDialog
        open
        onOpenChange={vi.fn()}
        onAddWechat={onAddWechat}
        onConnectDingtalk={vi.fn()}
        onImportTelegram={vi.fn()}
      />
    )
    expect(inspect).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '选择微信数据目录' }))
    expect(onAddWechat).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: '检测本机钉钉' }))
    expect(await screen.findByText('本地账号 1 · 尚未连接')).toBeInTheDocument()
    expect(screen.getByText(/非明文 SQLite · 待验证解码方式/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /连接钉钉|切换到钉钉/ })).not.toBeInTheDocument()
  })

  it('offers Telegram Desktop JSON import as a local read-only source', async () => {
    window.api = { inspectDingtalkLocalSource: vi.fn() } as unknown as typeof window.api
    const onImportTelegram = vi.fn()
    render(
      <AddDataSourceDialog
        open
        onOpenChange={vi.fn()}
        onAddWechat={vi.fn()}
        onConnectDingtalk={vi.fn()}
        onImportTelegram={onImportTelegram}
      />
    )
    expect(screen.getByText('本地客户端 · JSON 导入')).toBeVisible()
    expect(screen.getByText(/需运行本机 Telegram Desktop/)).toHaveTextContent(
      '补载会操作客户端打开会话并滚动'
    )
    const importDescription = screen.getByText(/导入 Telegram Desktop JSON 导出文件/)
    expect(importDescription).toHaveTextContent('浏览私聊、群组、频道和消息')
    expect(importDescription).toHaveTextContent('目前只支持文字，并需要 macOS Accessibility 权限')
    expect(importDescription).toHaveTextContent('媒体仍只保留元数据')
    expect(importDescription).not.toHaveTextContent(/补载|按需读取.*缓存/)
    await userEvent.click(screen.getByRole('button', { name: '选择 Telegram JSON 导出' }))
    expect(onImportTelegram).toHaveBeenCalledOnce()
  })

  it('offers retry after probe failure', async () => {
    const inspect = vi
      .fn()
      .mockRejectedValueOnce(new Error('fixture failure'))
      .mockResolvedValue(detected)
    window.api = { inspectDingtalkLocalSource: inspect } as unknown as typeof window.api
    render(
      <AddDataSourceDialog
        open
        onOpenChange={vi.fn()}
        onAddWechat={vi.fn()}
        onConnectDingtalk={vi.fn()}
        onImportTelegram={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: '检测本机钉钉' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('本地检测未完成')
    await userEvent.click(screen.getByRole('button', { name: '检测本机钉钉' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(await screen.findByText('本地账号 1 · 尚未连接')).toBeInTheDocument()
  })

  it('discards a probe that finishes after the dialog closes', async () => {
    let finish!: (result: DingtalkLocalInspection) => void
    window.api = {
      inspectDingtalkLocalSource: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
    } as unknown as typeof window.api
    const props = {
      onOpenChange: vi.fn(),
      onAddWechat: vi.fn(),
      onConnectDingtalk: vi.fn(),
      onImportTelegram: vi.fn()
    }
    const view = render(<AddDataSourceDialog open {...props} />)
    await userEvent.click(screen.getByRole('button', { name: '检测本机钉钉' }))
    view.rerender(<AddDataSourceDialog open={false} {...props} />)
    await act(async () => finish(detected))
    view.rerender(<AddDataSourceDialog open {...props} />)
    expect(screen.queryByText('本地账号 1 · 尚未连接')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '检测本机钉钉' })).toBeEnabled()
  })

  it('offers a read-only connection after a readable account is detected', async () => {
    const inspect = vi.fn().mockResolvedValue(readable)
    const onConnectDingtalk = vi.fn()
    window.api = { inspectDingtalkLocalSource: inspect } as unknown as typeof window.api
    render(
      <AddDataSourceDialog
        open
        onOpenChange={vi.fn()}
        onAddWechat={vi.fn()}
        onConnectDingtalk={onConnectDingtalk}
        onImportTelegram={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: '检测本机钉钉' }))
    await userEvent.click(await screen.findByRole('button', { name: '连接钉钉只读数据' }))
    expect(onConnectDingtalk).toHaveBeenCalledOnce()
  })
})
