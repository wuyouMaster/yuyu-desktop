import type { ReactElement } from 'react'
import { render, screen, waitFor, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ChatHeader } from '../../src/renderer/src/components/chat/ChatHeader'
import { ChatStatusBar } from '../../src/renderer/src/components/chat/ChatStatusBar'
import { ExportMenu } from '../../src/renderer/src/components/chat/ExportMenu'
import { TooltipProvider } from '../../src/renderer/src/components/ui'
import type { Contact } from '../../src/shared/types'

const contact: Contact = {
  md5: 'group-md5',
  m_nsUsrName: 'group@chatroom',
  m_nsNickName: '测试群',
  type: 'group'
}

function renderWithTooltip(element: ReactElement): RenderResult {
  return render(<TooltipProvider>{element}</TooltipProvider>)
}

describe('chat menus', () => {
  it('runs the selected export range and closes the menu', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn()
    renderWithTooltip(<ExportMenu disabled={false} onExport={onExport} />)

    const trigger = screen.getByRole('button', { name: '导出' })
    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: '导出近 7 天' }))

    expect(onExport).toHaveBeenCalledWith(7)
    expect(screen.queryByRole('menuitem', { name: '导出近 7 天' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('keeps header search and actions wired to their existing callbacks', async () => {
    const user = userEvent.setup()
    const onContentFilterChange = vi.fn()
    const onRefresh = vi.fn()
    const onOpenAiSettings = vi.fn()
    renderWithTooltip(
      <ChatHeader
        contact={contact}
        isGroupChat
        loadedCount={8}
        filteredCount={2}
        contentFilter=""
        isAiLoading={false}
        onContentFilterChange={onContentFilterChange}
        onRefresh={onRefresh}
        onTestSend={vi.fn()}
        onOpenAiSettings={onOpenAiSettings}
      />
    )

    for (const [label, tooltip] of [
      ['仅支持 macOS 和 Windows', '发送消息：仅支持 macOS 和 Windows'],
      ['问这个聊天', '打开或收起 AI 助手（Esc 收起）'],
      ['生成 AI 日报', '生成 AI 日报：配置并总结当前群聊']
    ]) {
      const trigger = screen.getByLabelText(label)
      await user.hover(trigger)
      await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent(tooltip))
      await user.keyboard('{Escape}')
      await user.unhover(trigger)
      await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
    }

    expect(screen.queryByRole('button', { name: '更多' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '搜索当前聊天' }))
    const searchInput = screen.getByRole('textbox', { name: '搜索当前聊天内容' })
    expect(searchInput).toHaveFocus()
    await user.type(searchInput, '测试')
    expect(onContentFilterChange).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '关闭搜索' }))
    expect(onContentFilterChange).toHaveBeenLastCalledWith('')
    expect(screen.queryByRole('textbox', { name: '搜索当前聊天内容' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '刷新聊天记录' }))
    await user.click(screen.getByRole('button', { name: '生成 AI 日报' }))
    expect(onRefresh).toHaveBeenCalledOnce()
    expect(onOpenAiSettings).toHaveBeenCalledOnce()
  })

  it('keeps only the jump action in the status bar', async () => {
    const user = userEvent.setup()
    const onJumpToLatest = vi.fn()
    renderWithTooltip(
      <ChatStatusBar
        count={5}
        isAtLatest={false}
        onJumpToLatest={onJumpToLatest}
      />
    )

    await user.click(screen.getByRole('button', { name: '跳转到最新消息' }))

    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重新加载头像' })).not.toBeInTheDocument()
    expect(onJumpToLatest).toHaveBeenCalledOnce()
  })

  it('keeps the latest status action disabled', () => {
    renderWithTooltip(
      <ChatStatusBar
        count={5}
        isAtLatest
        onJumpToLatest={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: '已是最新消息' })).toBeDisabled()
  })
})
