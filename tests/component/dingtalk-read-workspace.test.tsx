import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DingtalkReadWorkspace } from '../../src/renderer/src/features/dingtalk/DingtalkReadWorkspace'
import { TooltipProvider } from '../../src/renderer/src/components/ui'
import type { Conversation, Message } from '../../src/shared/domain-entities'
import type { ProviderSnapshot } from '../../src/shared/data-source'
import { serializeEntityId, type EntityId } from '../../src/shared/entity-id'
import type { ReadContext } from '../../src/shared/source-context'

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({
    count,
    estimateSize,
    getItemKey
  }: {
    count: number
    estimateSize: (index: number) => number
    getItemKey?: (index: number) => string | number
  }) => {
    const items = Array.from({ length: count }, (_, index) => ({
      index,
      key: getItemKey?.(index) ?? index,
      start: Array.from({ length: index }, (_, previous) => estimateSize(previous)).reduce(
        (total, size) => total + size,
        0
      ),
      size: estimateSize(index)
    }))
    return {
      getTotalSize: () => items.reduce((total, item) => total + item.size, 0),
      getVirtualItems: () => items,
      measureElement: () => undefined,
      scrollToIndex: () => undefined,
      measure: () => undefined
    }
  }
}))

const accountId = serializeEntityId({
  source: 'dingtalk',
  account: 'fixture-account',
  native: 'account'
})
const firstConversationId = serializeEntityId({
  source: 'dingtalk',
  account: 'fixture-account',
  native: 'conversation-1'
})
const secondConversationId = serializeEntityId({
  source: 'dingtalk',
  account: 'fixture-account',
  native: 'conversation-2'
})
const firstMessageId = serializeEntityId({
  source: 'dingtalk',
  account: 'fixture-account',
  native: 'message-1'
})

const context: NonNullable<ProviderSnapshot['context']> = {
  source: 'dingtalk',
  accountId,
  sessionId: 'fixture-session',
  revision: 'fixture-revision',
  identity: { kind: 'unknown' }
}

const snapshot: ProviderSnapshot = {
  source: 'dingtalk',
  accountId,
  context,
  capabilities: {
    supportsRecall: false,
    supportsPayment: false,
    canSend: false,
    hasGroupNicknames: false,
    supportsRealtime: false,
    supportsLazyAssets: false
  },
  health: { state: 'ready', available: true }
}

function conversation(id: EntityId, title: string): Conversation {
  return {
    id,
    kind: 'conversation',
    accountId,
    nativeRef: { source: 'dingtalk', account: 'fixture-account', native: id },
    conversationKind: 'direct',
    title
  }
}

function message(id: EntityId, conversationId: EntityId, content: Message['content']): Message {
  return {
    id,
    kind: 'message',
    accountId,
    conversationId,
    nativeRef: { source: 'dingtalk', account: 'fixture-account', native: id },
    direction: 'incoming',
    content,
    sentAt: Date.UTC(2026, 0, 1, 12, 34, 56)
  }
}

function installApi(
  options: {
    conversations?: Conversation[]
    messages?: Map<EntityId, Message[]>
    snapshotValue?: ProviderSnapshot | undefined
    listConversations?: ReturnType<typeof vi.fn>
    listMessages?: ReturnType<typeof vi.fn>
  } = {}
) {
  const conversations = options.conversations || [
    conversation(firstConversationId, '合成联系人甲'),
    conversation(secondConversationId, '合成联系人乙')
  ]
  const messages =
    options.messages ||
    new Map<EntityId, Message[]>([
      [
        firstConversationId,
        [message(firstMessageId, firstConversationId, { type: 'text', text: '第一会话文本' })]
      ],
      [
        secondConversationId,
        [message(firstMessageId, secondConversationId, { type: 'text', text: '第二会话文本' })]
      ]
    ])
  const snapshotValue = Object.prototype.hasOwnProperty.call(options, 'snapshotValue')
    ? options.snapshotValue
    : snapshot
  const listConversations =
    options.listConversations || vi.fn().mockResolvedValue({ items: conversations })
  const listMessages =
    options.listMessages ||
    vi
      .fn()
      .mockImplementation(({ conversationId }: { conversationId: EntityId }) =>
        Promise.resolve({ items: messages.get(conversationId) || [] })
      )
  const getUnifiedProviderSnapshot = vi.fn().mockResolvedValue(snapshotValue)
  window.api = {
    getUnifiedProviderSnapshot,
    listUnifiedConversations: listConversations,
    listUnifiedMessages: listMessages
  } as unknown as typeof window.api
  return { getUnifiedProviderSnapshot, listConversations, listMessages }
}

function expectedContext(): ReadContext {
  return { expected: context, scope: { kind: 'all' } }
}

afterEach(() => vi.restoreAllMocks())

beforeEach(() => {
  class TestResizeObserver {
    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
  }
  globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver
})

function renderWorkspace(): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <DingtalkReadWorkspace />
    </TooltipProvider>
  )
}

describe('DingtalkReadWorkspace', () => {
  it('refreshes the provider snapshot before loading the workspace', async () => {
    const { getUnifiedProviderSnapshot } = installApi()

    renderWorkspace()

    expect(await screen.findByText('第一会话文本')).toBeInTheDocument()
    expect(getUnifiedProviderSnapshot).toHaveBeenCalledOnce()
  })

  it('loads conversations, selects the first one, and reloads messages after switching', async () => {
    const { listMessages } = installApi()
    const user = userEvent.setup()
    renderWorkspace()

    expect(await screen.findByText('第一会话文本')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /合成联系人甲/ })).toHaveClass('active')
    await user.click(screen.getByRole('button', { name: /合成联系人乙/ }))
    expect(await screen.findByText('第二会话文本')).toBeInTheDocument()
    expect(screen.queryByText('第一会话文本')).not.toBeInTheDocument()

    expect(listMessages).toHaveBeenCalledWith({
      context: expectedContext(),
      conversationId: firstConversationId,
      limit: 200
    })
    expect(listMessages).toHaveBeenLastCalledWith({
      context: expectedContext(),
      conversationId: secondConversationId,
      limit: 200
    })
  })

  it('renders media placeholders and unknown message types with the unified send action', async () => {
    const mediaMessages = [
      message(firstMessageId, firstConversationId, { type: 'image' }),
      message(
        serializeEntityId({ source: 'dingtalk', account: 'fixture-account', native: 'message-2' }),
        firstConversationId,
        { type: 'audio' }
      ),
      message(
        serializeEntityId({ source: 'dingtalk', account: 'fixture-account', native: 'message-3' }),
        firstConversationId,
        { type: 'unknown', platformType: 'fixture-card', raw: { fixture: true } }
      )
    ]
    installApi({
      conversations: [conversation(firstConversationId, '媒体会话')],
      messages: new Map([[firstConversationId, mediaMessages]])
    })
    renderWorkspace()

    expect(await screen.findByText('图片消息（媒体尚未解析）')).toBeInTheDocument()
    expect(screen.getByText('语音消息（媒体尚未解析）')).toBeInTheDocument()
    expect(screen.getByText('暂不支持的消息类型：fixture-card')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument()
  })

  it('reloads the selected conversation when the chat refresh action is clicked', async () => {
    const { listMessages } = installApi()
    renderWorkspace()

    expect(await screen.findByText('第一会话文本')).toBeInTheDocument()
    expect(listMessages).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '刷新聊天记录' }))

    await waitFor(() => expect(listMessages).toHaveBeenCalledTimes(2))
    expect(listMessages).toHaveBeenLastCalledWith({
      context: expectedContext(),
      conversationId: firstConversationId,
      limit: 200
    })
  })

  it('shows a read error and never fabricates context when the provider snapshot has none', async () => {
    const listMessages = vi.fn().mockRejectedValue(new Error('fixture read failure'))
    const { listConversations } = installApi({ snapshotValue: undefined, listMessages })
    renderWorkspace()

    expect(await screen.findByRole('alert')).toHaveTextContent('fixture read failure')
    await waitFor(() => expect(listConversations).toHaveBeenCalledWith({ limit: 500 }))
    expect(listMessages).toHaveBeenCalledWith({ conversationId: firstConversationId, limit: 200 })
  })

  it('ignores an in-flight request after the workspace is unmounted', async () => {
    let resolveConversations!: (page: { items: Conversation[] }) => void
    const listConversations = vi.fn(
      () => new Promise<{ items: Conversation[] }>((resolve) => (resolveConversations = resolve))
    )
    installApi({ listConversations })
    const view = renderWorkspace()
    await waitFor(() => expect(listConversations).toHaveBeenCalledOnce())
    view.unmount()
    resolveConversations({ items: [conversation(firstConversationId, '旧页面会话')] })
    await Promise.resolve()
    expect(screen.queryByText('旧页面会话')).not.toBeInTheDocument()
  })
})
