import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { StrictMode, useState } from 'react'
import { ConversationAIDrawer } from '../../src/renderer/src/components/chat/ConversationAIDrawer'
import { TooltipProvider } from '../../src/renderer/src/components/ui'
import type { AskWechatQueryResult } from '../../src/shared/query-agent'
import type { Contact } from '../../src/shared/types'

const contact: Contact = {
  md5: 'fixture-conversation',
  m_nsUsrName: 'wxid_fixture_conversation',
  m_nsNickName: '合成测试会话',
  type: 'user'
}

const aiModelConfig = {
  configured: true,
  providerName: 'Fixture Provider',
  model: 'fixture-model',
  modelName: 'Fixture Model',
  status: 'connected' as const
}

const diagnostics = {
  entry: 'desktop' as const,
  provider: 'Fixture Provider',
  model: 'Fixture Model',
  modelCallCount: 1,
  toolCallCount: 1,
  tools: ['query_messages'],
  totalMs: 80,
  outcome: 'answered' as const
}

type AnsweredResult = Extract<AskWechatQueryResult, { status: 'answered' }>

const answeredResult = (answer = '当前聊天的结论见 [E1]'): AnsweredResult => ({
  engine: 'query-agent',
  status: 'answered',
  answer,
  evidence: [
    {
      citationId: 'E1',
      messageRef: 'fixture-message-ref',
      conversationName: '合成测试会话',
      conversationType: 'user',
      sender: '合成成员',
      timestamp: 1_700_000_000_000,
      messageType: 'text',
      text: '这是用于测试的历史消息',
      source: 'query_messages'
    }
  ],
  stats: {
    tools: ['query_messages'],
    reads: { messageCount: 1, matchedCount: 0, overviewSourceCount: 0, evidenceCount: 1 },
    scope: { kind: 'current', label: '当前会话：合成测试会话' },
    modelCallCount: 1,
    toolCallCount: 1,
    totalMs: 80
  },
  diagnostics
})

const api = {
  getAskWechatConfig: vi.fn(),
  runAskWechatQuery: vi.fn(),
  forgetAskWechatConversation: vi.fn(),
  onAskWechatProgress: vi.fn()
}

const renderDrawer = (
  overrides: Partial<ComponentProps<typeof ConversationAIDrawer>> = {},
  mode: 'chat' | 'analysis' = 'analysis'
) => {
  const onOpenEvidence = vi.fn()
  const onOpenAISettings = vi.fn()
  const onNotice = vi.fn()
  render(
    <TooltipProvider>
      <ConversationAIDrawer
        contact={contact}
        dbReady
        aiModelConfig={aiModelConfig}
        open
        onClose={vi.fn()}
        onOpenAISettings={onOpenAISettings}
        onOpenEvidence={onOpenEvidence}
        onNotice={onNotice}
        {...overrides}
      />
    </TooltipProvider>
  )
  if (mode === 'analysis') fireEvent.click(screen.getByRole('tab', { name: '分析' }))
  return { onOpenEvidence, onOpenAISettings, onNotice }
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'api', { configurable: true, value: api })
  api.getAskWechatConfig.mockResolvedValue({ queryAgentEnabled: true })
  api.runAskWechatQuery.mockResolvedValue(answeredResult())
  api.forgetAskWechatConversation.mockResolvedValue(undefined)
  api.onAskWechatProgress.mockImplementation(() => vi.fn())
})

describe('ConversationAIDrawer', () => {
  it('shows a tooltip and native fallback for both AI modes', async () => {
    const user = userEvent.setup()
    renderDrawer({}, 'chat')

    const chatTab = screen.getByRole('tab', { name: '对话' })
    const analysisTab = screen.getByRole('tab', { name: '分析' })

    expect(chatTab.parentElement).toHaveAttribute(
      'title',
      '对话：快速问答，按需查询聊天记录'
    )
    expect(analysisTab.parentElement).toHaveAttribute(
      'title',
      '分析：规划任务，结合工具与子 Agent 深入分析'
    )

    await user.hover(chatTab.parentElement as HTMLElement)
    await waitFor(() =>
      expect(screen.getByRole('tooltip')).toHaveTextContent('快速问答，按需查询聊天记录')
    )
  })

  it('opens with quoted text, preserves the draft and does not send automatically', async () => {
    function Harness(): React.ReactElement {
      const [open, setOpen] = useState(false)
      const [quoteCount, setQuoteCount] = useState(0)
      const [pendingQuote, setQuote] = useState<{
        conversationId: string
        quotes: { sender: string; text: string }[]
      } | null>(null)
      return (
        <>
          <button
            onClick={() => {
              setQuote({
                conversationId: contact.md5,
                quotes: [
                  {
                    sender: `合成成员${quoteCount + 1}`,
                    text:
                      quoteCount === 0
                        ? '合成引用第一行\n合成引用第二行'
                        : `合成引用第${quoteCount + 1}段`
                  }
                ]
              })
              setQuoteCount((count) => count + 1)
              setOpen(true)
            }}
          >
            选文引用
          </button>
          <ConversationAIDrawer
            contact={contact}
            dbReady
            aiModelConfig={aiModelConfig}
            open={open}
            onClose={() => setOpen(false)}
            onOpenAISettings={vi.fn()}
            onOpenEvidence={vi.fn()}
            onNotice={vi.fn()}
            pendingQuote={pendingQuote}
            onQuoteConsumed={() => setQuote(null)}
          />
        </>
      )
    }
    const user = userEvent.setup()
    render(
      <StrictMode>
        <TooltipProvider>
          <Harness />
        </TooltipProvider>
      </StrictMode>
    )
    await user.click(screen.getByText('选文引用'))
    const input = screen.getByRole('textbox', { name: '询问当前聊天' }) as HTMLTextAreaElement
    expect(input).toHaveValue('')
    expect(screen.getByText('已引用 1 段聊天')).toBeInTheDocument()
    expect(screen.getByText('合成成员1：')).toBeInTheDocument()
    expect(screen.getByText('合成成员1：').parentElement).toHaveAttribute(
      'title',
      '合成成员1：合成引用第一行\n合成引用第二行'
    )
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(0)
    await user.type(input, '请解释')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('complementary', { name: '当前聊天 AI 助手' })).not.toBeInTheDocument()
    await user.click(screen.getByText('选文引用'))
    expect(screen.getByRole('textbox')).toHaveValue('请解释')
    expect(screen.getByText('已引用 2 段聊天')).toBeInTheDocument()
    expect(api.runAskWechatQuery).not.toHaveBeenCalled()
    await user.click(screen.getByText('选文引用'))
    expect(screen.getByText('已引用 3 段聊天')).toBeInTheDocument()
    await user.click(screen.getByLabelText('移除引用 2'))
    expect(screen.getByText('已引用 2 段聊天')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '分析' }))
    await user.click(screen.getByRole('button', { name: /^发送$/ }))
    await waitFor(() =>
      expect(api.runAskWechatQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '引用 1（合成成员1）：\n> 合成引用第一行\n> 合成引用第二行\n\n引用 2（合成成员3）：\n> 合成引用第3段\n\n请解释'
        })
      )
    )
    expect(screen.queryByLabelText('待发送的引用')).not.toBeInTheDocument()
  })

  it('discards a quote from a different conversation', () => {
    const onQuoteConsumed = vi.fn()
    renderDrawer({
      pendingQuote: {
        conversationId: 'fixture-other',
        quotes: [{ sender: '合成成员', text: '不能串入的引用' }]
      },
      onQuoteConsumed
    })
    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(onQuoteConsumed).toHaveBeenCalledOnce()
  })

  it('limits the request to the selected conversation and opens evidence from Markdown or a card', async () => {
    const user = userEvent.setup()
    const { onOpenEvidence } = renderDrawer()
    const input = screen.getByRole('textbox', { name: '询问当前聊天' })

    await user.type(input, '这份聊天的结论是什么')
    await user.keyboard('{Enter}')

    expect(await screen.findByText('当前聊天的结论见')).toBeInTheDocument()
    expect(api.runAskWechatQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '这份聊天的结论是什么',
        scope: {
          scope: { kind: 'current', conversationId: contact.md5 },
          label: '当前会话：合成测试会话'
        }
      })
    )

    await user.click(screen.getByRole('button', { name: '[E1]' }))
    expect(onOpenEvidence).toHaveBeenCalledWith(expect.objectContaining({ evidenceId: 'E1' }))

    onOpenEvidence.mockClear()
    await user.click(screen.getByRole('button', { name: /E1.*合成成员/ }))
    expect(onOpenEvidence).toHaveBeenCalledWith(expect.objectContaining({ evidenceId: 'E1' }))
  })

  it('shows provider errors and offers the AI settings entry', async () => {
    api.runAskWechatQuery.mockResolvedValue({
      engine: 'query-agent',
      status: 'provider_unavailable',
      message: '合成测试 Provider 暂时不可用',
      diagnostics: { ...diagnostics, outcome: 'provider_unavailable' }
    })
    const user = userEvent.setup()
    const { onOpenAISettings } = renderDrawer()

    await user.type(screen.getByRole('textbox', { name: '询问当前聊天' }), '请回答')
    await user.keyboard('{Enter}')

    expect(await screen.findByText('合成测试 Provider 暂时不可用')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '检查 AI 配置' }))
    expect(onOpenAISettings).toHaveBeenCalledOnce()
  })

  it('does not submit without a selected conversation', async () => {
    renderDrawer({ contact: null })

    expect(screen.getByRole('textbox', { name: '询问当前聊天' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    expect(api.runAskWechatQuery).not.toHaveBeenCalled()
  })

  it('cancels a request and ignores its late answer', async () => {
    let resolveRequest: (result: AnsweredResult) => void = () => undefined
    const request = new Promise<AnsweredResult>((resolve) => {
      resolveRequest = resolve
    })
    api.runAskWechatQuery.mockReturnValue(request)
    const user = userEvent.setup()
    renderDrawer()

    await user.type(screen.getByRole('textbox', { name: '询问当前聊天' }), '稍等')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.runAskWechatQuery).toHaveBeenCalledOnce())

    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByText('已取消本次问题')).toBeInTheDocument()

    await act(async () => {
      resolveRequest(answeredResult('迟到的回答'))
      await request
    })
    expect(screen.queryByText('迟到的回答')).not.toBeInTheDocument()
  })

  it('uses Enter to send and Shift plus Enter to keep editing', async () => {
    const user = userEvent.setup()
    renderDrawer()
    const input = screen.getByRole('textbox', { name: '询问当前聊天' })

    await user.type(input, '第一行')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(api.runAskWechatQuery).not.toHaveBeenCalled()
    expect(input).toHaveValue('第一行\n')

    await user.type(input, '第二行')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.runAskWechatQuery).toHaveBeenCalledOnce())
    expect(api.runAskWechatQuery).toHaveBeenCalledWith(
      expect.objectContaining({ text: '第一行\n第二行' })
    )
  })
})

describe('agent runtime drawer', () => {
  const execution = {
    runId: 'fixture-plan',
    state: 'planned' as const,
    planVersion: 1,
    steps: [
      {
        id: 'find',
        objective: '查找合成证据',
        role: 'retriever' as const,
        dependencies: [],
        doneWhen: '找到证据',
        state: 'queued' as const
      }
    ],
    skills: ['build-timeline'],
    modelCalls: 2,
    toolCalls: 1,
    tokens: 20,
    tokensEstimated: false,
    resumable: true
  }
  it('sends structured quotes, shows plan, and resumes original question', async () => {
    const runAgentTask = vi.fn().mockResolvedValue({ ...answeredResult('计划已生成'), execution })
    Object.defineProperty(window, 'api', { configurable: true, value: { ...api, runAgentTask } })
    renderDrawer({
      pendingQuote: {
        conversationId: contact.md5,
        quotes: [{ sender: '合成成员', text: '合成引用' }]
      }
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '先做计划' }))
    await user.type(screen.getByRole('textbox'), '整理引用')
    await user.click(screen.getByRole('tab', { name: '分析' }))
    await user.click(screen.getByRole('button', { name: /^发送$/ }))
    expect(await screen.findByText('查找合成证据')).toBeInTheDocument()
    expect(screen.getByText('使用方法：整理时间线')).toBeInTheDocument()
    expect(runAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'plan',
        text: '整理引用',
        quotes: [
          {
            sender: '合成成员',
            text: '合成引用',
            conversationId: contact.md5,
            provenance: 'user-provided'
          }
        ]
      })
    )
    await user.click(screen.getByRole('button', { name: '按计划执行' }))
    await waitFor(() => expect(runAgentTask).toHaveBeenCalledTimes(2))
    expect(runAgentTask).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'auto', text: '整理引用', resumeRunId: 'fixture-plan' })
    )
    expect(api.runAskWechatQuery).not.toHaveBeenCalled()
  })
  it('calls host cancellation with the active request identity', async () => {
    const runAgentTask = vi.fn().mockReturnValue(new Promise(() => undefined))
    const cancelAgentTask = vi.fn().mockResolvedValue(true)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { ...api, runAgentTask, cancelAgentTask }
    })
    renderDrawer()
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox'), '合成问题')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(runAgentTask).toHaveBeenCalledOnce())
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(cancelAgentTask).toHaveBeenCalledWith(runAgentTask.mock.calls[0][0].requestId)
  })
})

describe('direct conversation and analysis tabs', () => {
  it('defaults to chat, streams without Agent calls, and shares history when switching', async () => {
    let delta: (id: string, text: string) => void = () => {}
    let finish!: (result: { success: true; answer: string }) => void
    const runConversationChat = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const runAgentTask = vi.fn().mockResolvedValue(answeredResult())
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ...api,
        runConversationChat,
        runAgentTask,
        onConversationChatDelta: vi.fn((callback) => {
          delta = callback
          return vi.fn()
        })
      }
    })
    renderDrawer({}, 'chat')
    const user = userEvent.setup()
    expect(screen.getByRole('tab', { name: '对话' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('button', { name: '先做计划' })).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox'), '合成普通问题')
    await user.click(screen.getByRole('button', { name: '发送' }))
    expect(runConversationChat).toHaveBeenCalledOnce()
    expect(runAgentTask).not.toHaveBeenCalled()
    expect(api.getAskWechatConfig).not.toHaveBeenCalled()
    const id = runConversationChat.mock.calls[0][0].requestId
    act(() => {
      delta('other-request', '错误流')
      delta(id, '正在流式回答')
    })
    expect(await screen.findByText('正在流式回答')).toBeInTheDocument()
    expect(screen.queryByText('错误流')).not.toBeInTheDocument()
    await act(async () => finish({ success: true, answer: '普通回答' }))
    await user.click(screen.getByRole('tab', { name: '分析' }))
    await user.type(screen.getByRole('textbox'), '查询群聊相关讨论')
    await user.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(runAgentTask).toHaveBeenCalledOnce())
    expect(runAgentTask.mock.calls[0][0].history).toEqual([
      { question: '合成普通问题', answer: '普通回答', mode: 'chat' }
    ])
    expect(screen.getByText('普通回答')).toBeInTheDocument()
  })

  it('promotes question and quotes while preserving a draft, without sending automatically', async () => {
    const runConversationChat = vi
      .fn()
      .mockResolvedValue({ success: true, answer: '请转为分析查找历史记录' })
    const runAgentTask = vi.fn()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { ...api, runConversationChat, runAgentTask }
    })
    renderDrawer(
      {
        pendingQuote: {
          conversationId: contact.md5,
          quotes: [{ sender: '合成人', text: '合成引用' }]
        }
      },
      'chat'
    )
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox'), '找相关讨论')
    await user.click(screen.getByRole('button', { name: '发送' }))
    await screen.findByText('请转为分析查找历史记录')
    await user.type(screen.getByRole('textbox'), '保留草稿')
    await user.click(screen.getByRole('button', { name: '转为分析' }))
    expect(screen.getByRole('textbox')).toHaveValue('找相关讨论\n\n保留草稿')
    expect(screen.getByLabelText('待发送的引用')).toHaveTextContent('合成引用')
    expect(screen.getByRole('tab', { name: '分析' })).toHaveAttribute('aria-selected', 'true')
    expect(runAgentTask).not.toHaveBeenCalled()
    await user.click(screen.getByRole('tab', { name: '对话' }))
    expect(screen.getByRole('textbox')).toHaveValue('找相关讨论\n\n保留草稿')
  })

  it('allows chat without a database and cancels the original mode after switching tabs', async () => {
    let finish!: (result: { success: true; answer: string }) => void
    const runConversationChat = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const cancelConversationChat = vi.fn().mockResolvedValue(true)
    const cancelAgentTask = vi.fn()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ...api,
        runConversationChat,
        cancelConversationChat,
        cancelAgentTask
      }
    })
    renderDrawer({ dbReady: false }, 'chat')
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox'), '普通问题')
    await user.click(screen.getByRole('button', { name: '发送' }))
    await user.click(screen.getByRole('tab', { name: '分析' }))
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(cancelConversationChat).toHaveBeenCalledWith(
      runConversationChat.mock.calls[0][0].requestId
    )
    expect(cancelAgentTask).not.toHaveBeenCalled()
    await act(async () => finish({ success: true, answer: '迟到回答' }))
    expect(screen.queryByText('迟到回答')).not.toBeInTheDocument()
  })
})

it('preserves drafts and quotes when an old preload lacks the direct chat API', async () => {
  const { onNotice } = renderDrawer(
    {
      pendingQuote: {
        conversationId: contact.md5,
        quotes: [{ sender: '合成成员', text: '合成引用' }]
      }
    },
    'chat'
  )
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox'), '解释这段引用')
  await user.click(screen.getByRole('button', { name: '发送' }))
  expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('请重启应用'))
  expect(screen.getByRole('textbox')).toHaveValue('解释这段引用')
  expect(screen.getByLabelText('待发送的引用')).toHaveTextContent('合成引用')
  expect(screen.queryByRole('button', { name: '检查 AI 配置' })).not.toBeInTheDocument()
  expect(api.runAskWechatQuery).not.toHaveBeenCalled()
})

it('shows clickable evidence returned by lightweight chat without running the analysis framework', async () => {
  const fixture = answeredResult()
  const runConversationChat = vi.fn().mockResolvedValue({
    success: true,
    answer: fixture.answer,
    evidence: fixture.evidence,
    invalidCitationIds: []
  })
  const runAgentTask = vi.fn()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { ...api, runConversationChat, runAgentTask }
  })
  const { onOpenEvidence } = renderDrawer({}, 'chat')
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox'), '他今天说了什么')
  await user.click(screen.getByRole('button', { name: '发送' }))
  await screen.findByLabelText('相关历史消息')
  await user.click(screen.getByRole('button', { name: /这是用于测试的历史消息/ }))
  expect(onOpenEvidence).toHaveBeenCalled()
  expect(runAgentTask).not.toHaveBeenCalled()
})

it('offers re-entry rather than configuration for a model timeout and preserves the question', async () => {
  const runConversationChat = vi
    .fn()
    .mockResolvedValue({ success: false, code: 'model_timeout', error: '单次模型请求超时' })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { ...api, runConversationChat }
  })
  renderDrawer({}, 'chat')
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox'), '合成查询')
  await user.click(screen.getByRole('button', { name: '发送' }))
  await screen.findByText('单次模型请求超时')
  expect(screen.queryByRole('button', { name: '检查 AI 配置' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '重新提问' }))
  expect(screen.getByRole('textbox')).toHaveValue('合成查询')
  expect(runConversationChat).toHaveBeenCalledOnce()
})
