import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TelegramLocalSourceCard } from '../../src/renderer/src/features/telegram/TelegramLocalSourceCard'
import {
  telegramLocalSourceOption,
  telegramSourceOption
} from '../../src/renderer/src/features/data-sources/telegram-source-options'
import type { TelegramLocalInspection } from '../../src/shared/telegram-local'
import type { TelegramMacOSInspection } from '../../src/shared/telegram-macos'

const nativeResult: TelegramMacOSInspection = {
  clientType: 'telegram-macos',
  state: 'detected',
  message: '发现合成原生账号',
  candidates: [{ id: 'synthetic-native-candidate', label: '合成原生账号' }]
}

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
  it('defaults to native macOS and connects only the explicitly selected candidate', async () => {
    const inspect = vi.fn().mockResolvedValue(nativeResult)
    const connect = vi.fn().mockResolvedValue(undefined)
    const desktopInspect = vi.fn()
    const desktopConnect = vi.fn()
    window.api = {
      inspectTelegramMacOSSource: inspect,
      inspectTelegramLocalSource: desktopInspect
    } as unknown as typeof window.api
    render(<TelegramLocalSourceCard onConnect={desktopConnect} onConnectMacOS={connect} />)
    expect(screen.getByRole('button', { name: 'Telegram（macOS 原生版）' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByText(/连接 macOS 原生 Telegram/)).toHaveTextContent(
      '本地记录不代表完整云端历史'
    )
    expect(screen.getByText(/连接 macOS 原生 Telegram/)).toHaveTextContent('媒体播放尚未接通')
    expect(inspect).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '检测本机 Telegram' }))
    await userEvent.click(await screen.findByRole('button', { name: '只读连接此账号' }))
    expect(connect).toHaveBeenCalledExactlyOnceWith('synthetic-native-candidate')
    expect(desktopInspect).not.toHaveBeenCalled()
    expect(desktopConnect).not.toHaveBeenCalled()
  })

  it('shows unavailable runtime capabilities without allowing native connection', async () => {
    window.api = {
      inspectTelegramMacOSSource: vi.fn().mockResolvedValue({
        ...nativeResult,
        state: 'unavailable',
        message: '当前运行时不支持 Telegram macOS 原生版，请更新运行时'
      })
    } as unknown as typeof window.api
    render(<TelegramLocalSourceCard onConnectMacOS={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '检测本机 Telegram' }))
    expect(
      await screen.findByText('当前运行时不支持 Telegram macOS 原生版，请更新运行时')
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: '只读连接此账号' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新检测 Telegram' })).toBeEnabled()
  })

  it('discards pending native results when switching to Desktop and resets when switching back', async () => {
    let finish!: (value: TelegramMacOSInspection) => void
    window.api = {
      inspectTelegramMacOSSource: vi.fn(
        () =>
          new Promise<TelegramMacOSInspection>((resolve) => {
            finish = resolve
          })
      ),
      inspectTelegramLocalSource: vi.fn().mockResolvedValue(result)
    } as unknown as typeof window.api
    render(<TelegramLocalSourceCard onConnect={vi.fn()} onConnectMacOS={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '检测本机 Telegram' }))
    await userEvent.click(screen.getByRole('button', { name: 'Telegram Desktop' }))
    await userEvent.click(screen.getByRole('button', { name: '检测本机 Telegram' }))
    expect(await screen.findByText('合成本地账号')).toBeVisible()
    await act(async () => finish(nativeResult))
    expect(screen.queryByText('合成原生账号')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '读取此账号已加载的消息' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Telegram（macOS 原生版）' }))
    expect(screen.queryByText('合成本地账号')).not.toBeInTheDocument()
    expect(screen.queryByText('合成原生账号')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '检测本机 Telegram' })).toBeEnabled()
  })

  it('keeps native connection errors visible without falling back to Desktop', async () => {
    const connect = vi.fn().mockRejectedValue(new Error('候选账号已失效，请重新检测'))
    const desktopConnect = vi.fn()
    window.api = {
      inspectTelegramMacOSSource: vi.fn().mockResolvedValue(nativeResult)
    } as unknown as typeof window.api
    render(<TelegramLocalSourceCard onConnect={desktopConnect} onConnectMacOS={connect} />)
    await userEvent.click(screen.getByRole('button', { name: '检测本机 Telegram' }))
    await userEvent.click(await screen.findByRole('button', { name: '只读连接此账号' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('候选账号已失效，请重新检测')
    expect(desktopConnect).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '只读连接此账号' })).toBeEnabled()
  })
  it('describes local runtime capabilities and their limits before connecting', async () => {
    render(<TelegramLocalSourceCard />)
    await userEvent.click(screen.getByRole('button', { name: 'Telegram Desktop' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Telegram Desktop' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Telegram Desktop' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Telegram Desktop' }))
    await userEvent.click(screen.getByRole('button', { name: '检测本机 Telegram' }))
    expect(screen.getByRole('button', { name: '正在读取本地账号…' })).toBeDisabled()
    view.unmount()
    await act(async () => finish(result))
    render(<TelegramLocalSourceCard />)
    await userEvent.click(screen.getByRole('button', { name: 'Telegram Desktop' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Telegram Desktop' }))
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
