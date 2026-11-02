import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TelegramLocalSourceCard } from '../../src/renderer/src/features/telegram/TelegramLocalSourceCard'
import {
  telegramLocalSourceOption,
  telegramSourceOption
} from '../../src/renderer/src/features/data-sources/telegram-source-options'
import type { TelegramLocalInspection } from '../../src/shared/telegram-local'

const result: TelegramLocalInspection = {
  source: 'telegram',
  state: 'detected',
  message: '合成检测结果：消息读取尚未接通。',
  accounts: [
    {
      id: 'fixture-local-account',
      label: '合成本地账号',
      slot: 0,
      isActive: false,
      state: 'metadata_read',
      canReadMessages: false,
      hasMediaCache: true
    }
  ]
}

describe('Telegram local inspection', () => {
  it('describes local runtime capabilities and their limits before connecting', () => {
    render(<TelegramLocalSourceCard />)
    const description = screen.getByText(/需运行本机 Telegram Desktop/)
    expect(description).toHaveTextContent('连接后先读取已加载的会话和消息，不代表完整历史')
    expect(description).toHaveTextContent('补载会操作客户端打开会话并滚动，可随时停止')
    expect(description).toHaveTextContent('只有补载确认完整时才标记为完整历史')
    expect(description).toHaveTextContent('图片、语音、视频、贴纸和文件按需读取本地缓存')
    expect(description).toHaveTextContent('未缓存附件可在加载时请求 Telegram 下载')
    expect(description).toHaveTextContent('支持文字发送和向 Saved Messages 发送 PNG 图片')
    expect(description).toHaveTextContent('语音气泡、静态贴纸与相册')
    expect(description).toHaveTextContent('仅在消息列表确认回显后报告成功')
    expect(screen.queryByText(/图片和文件内容尚不可用/)).not.toBeInTheDocument()
  })

  it('connects the selected detected identity and shows connection errors', async () => {
    const connect = vi.fn().mockRejectedValue(new Error('合成账号已变化'))
    window.api = {
      inspectTelegramLocalSource: vi.fn().mockResolvedValue(result)
    } as unknown as typeof window.api
    render(<TelegramLocalSourceCard onConnect={connect} />)
    await userEvent.click(screen.getByRole('button', { name: '检测本机 Telegram' }))
    await userEvent.click(await screen.findByRole('button', { name: '读取此账号已加载的消息' }))
    expect(connect).toHaveBeenCalledWith(0, 'fixture-local-account')
    expect(await screen.findByRole('alert')).toHaveTextContent('合成账号已变化')
    expect(screen.getByRole('button', { name: '读取此账号已加载的消息' })).toBeEnabled()
  })
  it('reads local metadata only on request without importing or connecting', async () => {
    const inspect = vi.fn().mockResolvedValue(result)
    const selectTelegramExport = vi.fn()
    window.api = {
      inspectTelegramLocalSource: inspect,
      selectTelegramExport
    } as unknown as typeof window.api
    render(<TelegramLocalSourceCard />)
    expect(inspect).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '检测本机 Telegram' }))
    expect(await screen.findByText('合成本地账号')).toBeVisible()
    expect(screen.getByText(/账号资料已读取 · 聊天记录未连接/)).toBeVisible()
    expect(screen.getByText('已发现媒体缓存目录，连接后按需读取缓存。')).toBeVisible()
    expect(screen.queryByRole('button', { name: /连接|切换|发送/ })).toBeNull()
    expect(selectTelegramExport).not.toHaveBeenCalled()
  })

  it('does not retain results after closing and reopening the dialog', async () => {
    let finish!: (r: TelegramLocalInspection) => void
    const inspect = vi.fn(
      () =>
        new Promise<TelegramLocalInspection>((resolve) => {
          finish = resolve
        })
    )
    window.api = { inspectTelegramLocalSource: inspect } as unknown as typeof window.api
    const view = render(<TelegramLocalSourceCard />)
    await userEvent.click(screen.getByRole('button', { name: '检测本机 Telegram' }))
    expect(screen.getByRole('button', { name: '正在读取本地账号…' })).toBeDisabled()
    view.unmount()
    await act(async () => finish(result))
    render(<TelegramLocalSourceCard />)
    expect(screen.queryByText('合成本地账号')).toBeNull()
    expect(screen.getByRole('button', { name: '检测本机 Telegram' })).toBeEnabled()
  })

  it('offers retry when the IPC call fails', async () => {
    window.api = {
      inspectTelegramLocalSource: vi
        .fn()
        .mockRejectedValueOnce(new Error('fixture'))
        .mockResolvedValue(result)
    } as unknown as typeof window.api
    render(<TelegramLocalSourceCard />)
    await userEvent.click(screen.getByRole('button', { name: '检测本机 Telegram' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Telegram 本地检测未完成')
    await userEvent.click(screen.getByRole('button', { name: '检测本机 Telegram' }))
    expect(await screen.findByText('合成本地账号')).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps local detection separate from the saved export entry', () => {
    expect(telegramLocalSourceOption.status).toBe('needs_setup')
    expect(telegramLocalSourceOption.id).not.toBe(telegramSourceOption(undefined).id)
    expect(telegramSourceOption(undefined, '', false, true).accountHint).toBe(
      '本地快照 · 可补载历史、按需读取缓存；文字发送以能力状态为准'
    )
    expect(telegramSourceOption(undefined).accountHint).toBe(
      '已保存的 Telegram JSON 导出 · 文字发送'
    )
  })
})
