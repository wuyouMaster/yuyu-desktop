import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PriorityWatchWorkspace } from '../../src/renderer/src/features/priority-watch/PriorityWatchWorkspace'
import type { Contact, Message } from '../../src/shared/types'
import type { PriorityWatchPage } from '../../src/shared/priority-watch'
const contacts: Contact[] = ['a', 'b'].map((id) => ({
  md5: `fixture-group-${id}`,
  m_nsUsrName: `fixture-${id}@chatroom`,
  m_nsNickName: `测试群 ${id}`,
  type: 'group'
}))
const message: Message = {
  id: 'fixture-message',
  senderId: 'fixture-member',
  name: '测试客户',
  content: '测试报价请求',
  type: '普通文本',
  from: 'user',
  datetime: '2026-09-28 10:00',
  createTime: 100,
  isSender: false
}
const rules = contacts.map((c) => ({
  conversationId: c.md5,
  groupName: c.m_nsNickName,
  members: [{ id: 'fixture-member', name: '测试客户' }]
}))
const props = {
  accountRoot: 'fixture-account',
  contacts,
  dbReady: true,
  onOpenSettings: vi.fn(),
  onOpenMessage: vi.fn()
}
const page = (messages: Message[] = [message]): PriorityWatchPage => ({
  messages,
  nextEndTime: null,
  scanned: 2
})
function seed(): void {
  localStorage.setItem('priority-watch:v1:fixture-account', JSON.stringify(rules))
}

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'api', { configurable: true, value: {} })
  window.api.getPriorityWatchPage = vi.fn().mockResolvedValue(page())
  window.api.getGroupSnapshot = vi.fn().mockResolvedValue({
    roomId: contacts[0].md5,
    memberCount: 1,
    members: [{ wxid: 'fixture-member', nickname: '测试客户' }]
  })
  window.api.getMessagesAround = vi.fn().mockResolvedValue({
    messages: [
      {
        ...message,
        id: 'other',
        senderId: 'fixture-other',
        name: '测试同事',
        content: '测试上下文'
      },
      message
    ],
    found: true,
    truncated: false,
    radiusSeconds: 120
  })
})

describe('priority watch workspace', () => {
  it('selects group members, persists them and reopens the configured group', async () => {
    const view = render(<PriorityWatchWorkspace {...props} />)
    await userEvent.click(
      within(screen.getByRole('banner')).getByRole('button', { name: '管理关注' })
    )
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: '选择群聊' }),
      contacts[0].md5
    )
    await userEvent.click(await screen.findByRole('checkbox', { name: /测试客户/ }))
    await userEvent.click(screen.getByRole('button', { name: '保存关注' }))
    expect(await screen.findByText('测试报价请求')).toBeVisible()
    expect(
      JSON.parse(localStorage.getItem('priority-watch:v1:fixture-account')!)[0].members[0].id
    ).toBe('fixture-member')
    view.unmount()
    render(<PriorityWatchWorkspace {...props} />)
    expect(await screen.findByText('测试报价请求')).toBeVisible()
  })
  it('expands context and jumps with the exact contact/message', async () => {
    seed()
    render(<PriorityWatchWorkspace {...props} />)
    await userEvent.click(await screen.findByRole('button', { name: '查看上下文' }))
    expect(await screen.findByText('测试上下文')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '跳转原聊天' }))
    expect(props.onOpenMessage).toHaveBeenCalledWith(contacts[0], message)
  })
  it('groups adjacent messages from the same member within one minute', async () => {
    seed()
    const messages: Message[] = [
      { ...message, id: 'newest', content: '一分钟内的第三条', createTime: 410 },
      { ...message, id: 'middle', content: '一分钟内的第二条', createTime: 350 },
      { ...message, id: 'oldest', content: '一分钟内的第一条', createTime: 300 },
      { ...message, id: 'too-old', content: '超过一分钟', createTime: 239 },
      {
        ...message,
        id: 'other-sender',
        senderId: 'fixture-other',
        content: '不同成员',
        createTime: 230
      }
    ]
    vi.mocked(window.api.getPriorityWatchPage).mockResolvedValueOnce(page(messages))

    render(<PriorityWatchWorkspace {...props} />)

    const cards = await waitFor(() => {
      const result = Array.from(document.querySelectorAll('.priority-watch-message'))
      expect(result).toHaveLength(3)
      return result
    })
    expect(within(cards[0] as HTMLElement).getByText('一分钟内的第三条')).toBeVisible()
    expect(within(cards[0] as HTMLElement).getByText('一分钟内的第一条')).toBeVisible()
    expect(cards[0]?.querySelectorAll('header strong')).toHaveLength(1)
    expect(within(cards[1] as HTMLElement).getByText('超过一分钟')).toBeVisible()
    expect(within(cards[2] as HTMLElement).getByText('不同成员')).toBeVisible()
    expect(screen.getAllByRole('button', { name: '查看上下文' })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: '跳转原聊天' })).toHaveLength(3)
    expect(cards[0]?.querySelectorAll('footer')).toHaveLength(1)
  })
  it('ignores late results from the previous group', async () => {
    seed()
    let resolve!: (page: PriorityWatchPage) => void
    vi.mocked(window.api.getPriorityWatchPage)
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r
          })
      )
      .mockResolvedValueOnce(page([{ ...message, content: '测试群 b 消息' }]))
    render(<PriorityWatchWorkspace {...props} />)
    await userEvent.click(
      within(screen.getByRole('complementary')).getByRole('button', { name: /测试群 b/ })
    )
    expect(await screen.findByText('测试群 b 消息')).toBeVisible()
    await act(async () => resolve(page()))
    expect(screen.queryByText('测试报价请求')).not.toBeInTheDocument()
  })
  it('continues through empty matching pages and preserves the cursor on failure', async () => {
    seed()
    vi.mocked(window.api.getPriorityWatchPage)
      .mockResolvedValueOnce({ messages: [], nextEndTime: 80, scanned: 499 })
      .mockRejectedValueOnce(new Error('fixture query failed'))
      .mockResolvedValueOnce(page())
    render(<PriorityWatchWorkspace {...props} />)
    await userEvent.click(await screen.findByRole('button', { name: '继续查找更早消息' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('fixture query failed')
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('测试报价请求')).toBeVisible()
    expect(vi.mocked(window.api.getPriorityWatchPage).mock.calls[2][0].endTime).toBe(80)
  })
  it('isolates account configuration and does not query while disconnected', () => {
    seed()
    render(
      <PriorityWatchWorkspace {...props} accountRoot="fixture-other-account" dbReady={false} />
    )
    expect(screen.getByText('连接微信数据后开始关注')).toBeVisible()
    expect(window.api.getPriorityWatchPage).not.toHaveBeenCalled()
  })
  it('removes a group by unchecking its members', async () => {
    seed()
    render(<PriorityWatchWorkspace {...props} />)
    await userEvent.click(
      within(screen.getByRole('banner')).getByRole('button', { name: '管理关注' })
    )
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: '选择群聊' }),
      contacts[0].md5
    )
    const checkbox = await screen.findByRole('checkbox', { name: /测试客户/ })
    await waitFor(() => expect(screen.queryByText('正在加载群成员…')).not.toBeInTheDocument())
    fireEvent.click(checkbox)
    await userEvent.click(screen.getByRole('button', { name: '保存关注' }))
    expect(JSON.parse(localStorage.getItem('priority-watch:v1:fixture-account')!)).toHaveLength(1)
  })
  it('manages saved groups in a dedicated tab', async () => {
    seed()
    render(<PriorityWatchWorkspace {...props} />)
    await userEvent.click(
      within(screen.getByRole('banner')).getByRole('button', { name: '管理关注' })
    )
    await userEvent.click(screen.getByRole('tab', { name: /已关注 \(2\)/ }))
    const savedGroupA = screen
      .getAllByText('测试群 a')
      .find((node) => node.closest('article')?.classList.contains('priority-watch-saved-item'))
    expect(savedGroupA).toBeVisible()
    expect(within(savedGroupA!.closest('article')!).getByText('测试客户')).toBeVisible()
    await userEvent.click(
      within(savedGroupA!.closest('article')!).getByRole('button', { name: '移除' })
    )
    const savedList = document.querySelector<HTMLElement>('.priority-watch-saved-list')!
    expect(within(savedList).getByText('测试群 b')).toBeVisible()
    expect(within(savedList).queryByText('测试群 a')).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('priority-watch:v1:fixture-account')!)).toHaveLength(1)
  })
})
