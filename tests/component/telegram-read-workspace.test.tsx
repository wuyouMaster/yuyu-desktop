import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelegramReadWorkspace } from '../../src/renderer/src/features/telegram/TelegramReadWorkspace'
import { TooltipProvider } from '../../src/renderer/src/components/ui'
import type { Conversation, Message } from '../../src/shared/domain-entities'
import type { ProviderSnapshot } from '../../src/shared/data-source'
import { serializeEntityId } from '../../src/shared/entity-id'
import type { TelegramHistoryResult } from '../../src/shared/telegram-history'

const virtualWindow = vi.hoisted(() => ({ size: Infinity }))

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
    let offset = 0
    const items = Array.from({ length: count }, (_, index) => {
      const item = {
        index,
        key: getItemKey?.(index) ?? index,
        start: offset,
        size: estimateSize(index)
      }
      offset += item.size
      return item
    })
    return {
      getTotalSize: () => items.reduce((total, item) => total + item.size, 0),
      getVirtualItems: () => items.slice(-virtualWindow.size),
      measureElement: () => undefined,
      scrollToIndex: () => undefined,
      measure: () => undefined
    }
  }
}))

const accountId = serializeEntityId({
  source: 'telegram',
  account: 'fixture-account',
  native: 'account'
})
const conversationId = serializeEntityId({
  source: 'telegram',
  account: 'fixture-account',
  native: 'chat/group-1'
})
const context: NonNullable<ProviderSnapshot['context']> = {
  source: 'telegram',
  accountId,
  sessionId: 'fixture-session',
  revision: 'fixture-revision',
  identity: { kind: 'account' }
}
const snapshot: ProviderSnapshot = {
  source: 'telegram',
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
  health: { state: 'ready', available: true, message: 'fixture Telegram export' }
}

function conversation(): Conversation {
  return {
    id: conversationId,
    kind: 'conversation',
    accountId,
    nativeRef: { source: 'telegram', account: 'fixture-account', native: 'chat/group-1' },
    conversationKind: 'group',
    title: '合成 Telegram 群组'
  }
}

function message(
  id: string,
  content: Message['content'],
  extensions?: Message['extensions']
): Message {
  return {
    id: serializeEntityId({ source: 'telegram', account: 'fixture-account', native: id }),
    kind: 'message',
    accountId,
    conversationId,
    nativeRef: { source: 'telegram', account: 'fixture-account', native: id },
    direction: 'incoming',
    content,
    extensions,
    sentAt: Date.UTC(2026, 0, 1, 12, 0)
  }
}

beforeEach(() => {
  virtualWindow.size = Infinity
  class TestResizeObserver {
    observe(): void {
      void 0
    }

    disconnect(): void {
      void 0
    }

    unobserve(): void {
      void 0
    }
  }
  globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver
})

afterEach(() => vi.restoreAllMocks())

describe('TelegramReadWorkspace', () => {
  it('pages native macOS snapshots on request and never exposes Desktop actions', async () => {
    const secondConversation = {
      ...conversation(),
      id: serializeEntityId({
        source: 'telegram',
        account: 'fixture-account',
        native: 'chat/native-second'
      }),
      title: '合成原生会话二'
    }
    const nativeSnapshot: ProviderSnapshot = {
      ...snapshot,
      health: { state: 'ready', available: true, message: '合成原生本地快照，不代表完整云端历史' },
      send: {
        capabilities: { ...snapshot.capabilities, canSend: true },
        health: { state: 'ready', available: true }
      }
    }
    const listConversations = vi.fn(async ({ cursor }: { cursor?: string }) =>
      cursor
        ? { items: [secondConversation] }
        : { items: [conversation()], nextCursor: 'native-conversation-next' }
    )
    const listMessages = vi.fn(async ({ cursor }: { cursor?: string }) =>
      cursor
        ? {
            items: [
              message(
                'native-earlier',
                {
                  type: 'unknown',
                  platformType: 'telegram-macos-media',
                  raw: {}
                },
                {
                  telegramMacOS: {
                    mediaCount: 1,
                    media: [
                      {
                        kind: 'voice',
                        mimeType: 'audio/ogg',
                        byteLength: 2048,
                        durationSeconds: 12.5,
                        metadataState: 'decoded'
                      }
                    ]
                  }
                }
              )
            ]
          }
        : {
            items: [
              {
                ...message(
                  'native-first',
                  { type: 'text', text: '合成原生消息' },
                  {
                    telegramMacOS: {
                      mediaCount: 1,
                      media: [
                        {
                          kind: 'file',
                          filename: 'synthetic-report.pdf',
                          mimeType: 'application/pdf',
                          byteLength: 4096,
                          width: 640,
                          height: 480,
                          metadataState: 'decoded'
                        }
                      ]
                    }
                  }
                ),
                senderId: serializeEntityId({
                  source: 'telegram',
                  account: 'fixture-account',
                  native: 'author/1001'
                })
              }
            ],
            nextCursor: 'native-message-next'
          }
    )
    const desktopHistory = vi.fn()
    const desktopSend = vi.fn()
    const desktopMedia = vi.fn()
    window.api = {
      getUnifiedProviderSnapshot: vi.fn().mockResolvedValue(nativeSnapshot),
      listUnifiedConversations: listConversations,
      listUnifiedMessages: listMessages,
      loadTelegramHistory: desktopHistory,
      sendUnifiedMessage: desktopSend,
      loadTelegramMedia: desktopMedia
    } as unknown as typeof window.api
    render(
      <TooltipProvider>
        <TelegramReadWorkspace
          snapshot={nativeSnapshot}
          localClientType="telegram-macos"
          onRefreshLocal={vi.fn()}
        />
      </TooltipProvider>
    )
    expect(await screen.findByText(/合成原生消息/)).toHaveTextContent(
      '含 1 个附件（仅有本地元数据，内容尚未读取）'
    )
    expect(screen.getByText(/合成原生消息/)).toHaveTextContent(
      '文件 · synthetic-report.pdf · application/pdf · 4 KiB · 640 × 480'
    )
    expect(screen.getByText('用户 1001')).toBeVisible()
    expect(screen.queryByText('telegram:fixture-account:author%2F1001')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^会话/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /^群聊|^联系人/ })).not.toBeInTheDocument()
    expect(listConversations).toHaveBeenCalledTimes(1)
    expect(listMessages).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '发送' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /补载|在 Telegram 中加载|下载/ })
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '加载更多本地会话' }))
    expect(await screen.findByRole('button', { name: /合成原生会话二/ })).toBeVisible()
    expect(listConversations).toHaveBeenLastCalledWith({
      context: { expected: context, scope: { kind: 'all' } },
      cursor: 'native-conversation-next',
      limit: 100
    })
    await userEvent.click(screen.getByRole('button', { name: '加载更早的本地消息' }))
    expect(await screen.findByText(/附件消息（仅有本地元数据，内容尚未读取）/)).toHaveTextContent(
      '语音 · audio/ogg · 2 KiB · 12.5 秒'
    )
    expect(screen.getByText('未知发送者')).toBeVisible()
    expect(listMessages).toHaveBeenLastCalledWith({
      context: { expected: context, scope: { kind: 'all' } },
      conversationId,
      cursor: 'native-message-next',
      limit: 50
    })
    expect(screen.queryByRole('button', { name: '加载更早的本地消息' })).not.toBeInTheDocument()
    expect(desktopHistory).not.toHaveBeenCalled()
    expect(desktopSend).not.toHaveBeenCalled()
    expect(desktopMedia).not.toHaveBeenCalled()
  })

  it('discards a native page that resolves after switching conversations', async () => {
    const secondId = serializeEntityId({
      source: 'telegram',
      account: 'fixture-account',
      native: 'chat/native-second'
    })
    let finish!: (value: { items: Message[]; nextCursor?: string }) => void
    const listMessages = vi.fn(
      ({ conversationId: selected, cursor }: { conversationId: string; cursor?: string }) => {
        if (selected === secondId)
          return Promise.resolve({
            items: [
              {
                ...message('native-second', { type: 'text', text: '合成新会话消息' }),
                senderId: serializeEntityId({
                  source: 'telegram',
                  account: 'fixture-account',
                  native: 'author/1002'
                })
              }
            ]
          })
        if (cursor)
          return new Promise<{ items: Message[]; nextCursor?: string }>((resolve) => {
            finish = resolve
          })
        return Promise.resolve({
          items: [message('native-first', { type: 'text', text: '合成原会话消息' })],
          nextCursor: 'native-pending'
        })
      }
    )
    window.api = {
      listUnifiedConversations: vi.fn().mockResolvedValue({
        items: [conversation(), { ...conversation(), id: secondId, title: '合成新会话' }]
      }),
      listUnifiedMessages: listMessages
    } as unknown as typeof window.api
    render(
      <TooltipProvider>
        <TelegramReadWorkspace snapshot={snapshot} localClientType="telegram-macos" />
      </TooltipProvider>
    )
    expect(await screen.findByText('合成原会话消息')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '加载更早的本地消息' }))
    await userEvent.click(screen.getByRole('button', { name: /合成新会话/ }))
    expect(await screen.findByText('合成新会话消息')).toBeVisible()
    expect(screen.getByText('用户 1002')).toBeVisible()
    expect(screen.queryByText('telegram:fixture-account:author%2F1002')).not.toBeInTheDocument()
    await act(async () =>
      finish({
        items: [message('native-stale', { type: 'text', text: '不应显示的旧分页' })],
        nextCursor: 'native-stale-next'
      })
    )
    expect(screen.queryByText('不应显示的旧分页')).not.toBeInTheDocument()
    expect(screen.queryByText('合成原会话消息')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '加载更早的本地消息' })).not.toBeInTheDocument()
  })

  it('does not read native conversations when capabilities are unavailable or source context mismatches', async () => {
    const listConversations = vi.fn()
    window.api = { listUnifiedConversations: listConversations } as unknown as typeof window.api
    const unavailable = {
      ...snapshot,
      health: { state: 'offline' as const, available: false, message: '原生运行时版本不兼容' }
    }
    const view = render(
      <TooltipProvider>
        <TelegramReadWorkspace snapshot={unavailable} localClientType="telegram-macos" />
      </TooltipProvider>
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('原生运行时版本不兼容')
    expect(listConversations).not.toHaveBeenCalled()
    view.rerender(
      <TooltipProvider>
        <TelegramReadWorkspace
          snapshot={{ ...snapshot, context: { ...context, source: 'wechat' } }}
          localClientType="telegram-macos"
        />
      </TooltipProvider>
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Telegram 数据源上下文尚未就绪')
    expect(listConversations).not.toHaveBeenCalled()
  })

  it('renders exported group names and sender names with a disabled send action', async () => {
    const listMessages = vi.fn().mockResolvedValue({
      items: [
        message(
          'message-1',
          { type: 'text', text: '合成消息内容' },
          { telegram: { senderName: '合成成员' } }
        ),
        message('message-2', {
          type: 'image',
          assetId: serializeEntityId({
            source: 'telegram',
            account: 'fixture-account',
            native: 'asset/message/group-1/2'
          })
        })
      ]
    })
    window.api = {
      getUnifiedProviderSnapshot: vi.fn().mockResolvedValue(snapshot),
      listUnifiedConversations: vi.fn().mockResolvedValue({ items: [conversation()] }),
      listUnifiedMessages: listMessages
    } as unknown as typeof window.api

    render(
      <TooltipProvider>
        <TelegramReadWorkspace />
      </TooltipProvider>
    )

    expect(await screen.findByRole('button', { name: /合成 Telegram 群组/ })).toBeInTheDocument()
    expect(await screen.findByText('合成消息内容')).toBeInTheDocument()
    expect(await screen.findByText('合成成员')).toBeInTheDocument()
    expect(await screen.findByText('图片消息（附件内容尚未读取）')).toBeInTheDocument()
    expect(screen.getByTestId('telegram-read-workspace')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '补载更早历史' })).not.toBeInTheDocument()
    expect(listMessages).toHaveBeenCalledWith({
      context: { expected: context, scope: { kind: 'all' } },
      conversationId,
      cursor: undefined,
      limit: 200
    })
  })

  it('loads all runtime pages and refreshes through the native callback without losing the conversation', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const listMessages = vi.fn(async (query: { cursor?: string }) =>
      query.cursor
        ? { items: [message('fixture-page-2', { type: 'text', text: '合成第二页' })] }
        : {
            items: [message('fixture-page-1', { type: 'text', text: '合成第一页' })],
            nextCursor: 'fixture-next'
          }
    )
    window.api = {
      getUnifiedProviderSnapshot: vi.fn().mockResolvedValue(snapshot),
      listUnifiedConversations: vi.fn().mockResolvedValue({ items: [conversation()] }),
      listUnifiedMessages: listMessages
    } as unknown as typeof window.api
    render(
      <TooltipProvider>
        <TelegramReadWorkspace snapshot={snapshot} onRefreshLocal={refresh} />
      </TooltipProvider>
    )
    expect(await screen.findByText('合成第二页')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '刷新会话列表' }))
    expect(refresh).toHaveBeenCalledOnce()
    expect(await screen.findByText('合成第二页')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /合成 Telegram 群组/ })).toBeInTheDocument()
    expect(listMessages).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'fixture-next', limit: 500 })
    )
  })

  it('keeps media captions visible and searchable without resolving offscreen media', async () => {
    const resolve = vi.fn()
    window.api = {
      getUnifiedProviderSnapshot: vi.fn().mockResolvedValue(snapshot),
      listUnifiedConversations: vi.fn().mockResolvedValue({ items: [conversation()] }),
      listUnifiedMessages: vi.fn().mockResolvedValue({
        items: [
          message(
            'fixture-caption',
            { type: 'image', assetId: conversationId },
            { telegram: { caption: '合成图片说明' } }
          )
        ]
      }),
      resolveUnifiedAsset: resolve
    } as unknown as typeof window.api
    render(
      <TooltipProvider>
        <TelegramReadWorkspace />
      </TooltipProvider>
    )
    expect(await screen.findByText('合成图片说明')).toBeInTheDocument()
    expect(resolve).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '搜索当前聊天' }))
    await userEvent.type(screen.getByRole('textbox', { name: '搜索当前聊天内容' }), '合成图片说明')
    expect(screen.getByText('合成图片说明')).toBeInTheDocument()
  })

  it('keeps tens of thousands of consecutive media messages virtualized and unresolved', async () => {
    virtualWindow.size = 3
    const resolve = vi.fn()
    const items = Array.from({ length: 20000 }, (_, index) =>
      message(`fixture-media-${index}`, { type: 'image', assetId: conversationId })
    )
    window.api = {
      getUnifiedProviderSnapshot: vi.fn().mockResolvedValue(snapshot),
      listUnifiedConversations: vi.fn().mockResolvedValue({ items: [conversation()] }),
      listUnifiedMessages: vi.fn(async ({ cursor }: { cursor?: string }) => {
        const start = Number(cursor || 0)
        return {
          items: items.slice(start, start + 500),
          nextCursor: start + 500 < items.length ? String(start + 500) : undefined
        }
      }),
      resolveUnifiedAsset: resolve
    } as unknown as typeof window.api
    render(
      <TooltipProvider>
        <TelegramReadWorkspace snapshot={snapshot} onRefreshLocal={vi.fn()} />
      </TooltipProvider>
    )
    await screen.findByText('20000 条消息', {}, { timeout: 10000 })
    expect(screen.getAllByTestId('telegram-media')).toHaveLength(24)
    expect(resolve).not.toHaveBeenCalled()
  }, 15000)

  it('rereads the merged history snapshot without reconnecting', async () => {
    const refresh = vi.fn()
    let loaded = false
    const history = vi.fn(async () => {
      loaded = true
      return {
        addedCount: 1,
        messageCount: 2,
        reachedStart: true,
        reachedEnd: false,
        complete: false
      }
    })
    const listConversations = vi.fn().mockResolvedValue({ items: [conversation()] })
    window.api = {
      getUnifiedProviderSnapshot: vi.fn().mockResolvedValue(snapshot),
      listUnifiedConversations: listConversations,
      listUnifiedMessages: vi.fn(async () => ({
        items: [
          message('fixture-original', { type: 'text', text: '合成原消息' }),
          ...(loaded ? [message('fixture-older', { type: 'text', text: '合成补载消息' })] : [])
        ]
      })),
      loadTelegramHistory: history
    } as unknown as typeof window.api
    render(
      <TooltipProvider>
        <TelegramReadWorkspace snapshot={snapshot} onRefreshLocal={refresh} />
      </TooltipProvider>
    )
    await screen.findByText('合成原消息')
    fireEvent.click(screen.getByRole('button', { name: '补载更早历史' }))
    expect(await screen.findByText('合成补载消息')).toBeInTheDocument()
    expect(history).toHaveBeenCalledOnce()
    expect(refresh).not.toHaveBeenCalled()
    expect(listConversations).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/历史已完整加载/)).not.toBeInTheDocument()
  })

  it('cancels further history pages when switching conversations and discards stale messages', async () => {
    const second = {
      ...conversation(),
      id: serializeEntityId({
        source: 'telegram',
        account: 'fixture-account',
        native: 'chat/fixture-second'
      }),
      title: '合成第二会话'
    }
    let finishHistory!: (result: TelegramHistoryResult) => void
    let finishMessages!: (value: { items: Message[]; nextCursor?: string }) => void
    const history = vi.fn(
      () =>
        new Promise<TelegramHistoryResult>((resolve) => {
          finishHistory = resolve
        })
    )
    const listMessages = vi.fn(({ conversationId: id }: { conversationId: string }) =>
      id === second.id
        ? Promise.resolve({
            items: [message('fixture-second-message', { type: 'text', text: '合成第二会话消息' })]
          })
        : new Promise<{ items: Message[]; nextCursor?: string }>((resolve) => {
            finishMessages = resolve
          })
    )
    window.api = {
      getUnifiedProviderSnapshot: vi.fn().mockResolvedValue(snapshot),
      listUnifiedConversations: vi.fn().mockResolvedValue({ items: [conversation(), second] }),
      listUnifiedMessages: listMessages,
      loadTelegramHistory: history
    } as unknown as typeof window.api
    render(
      <TooltipProvider>
        <TelegramReadWorkspace snapshot={snapshot} onRefreshLocal={vi.fn()} />
      </TooltipProvider>
    )
    await screen.findByRole('button', { name: '补载更早历史' })
    fireEvent.click(screen.getByRole('button', { name: '补载更早历史' }))
    await userEvent.click(screen.getByRole('button', { name: /合成第二会话/ }))
    await screen.findByText('合成第二会话消息')
    await act(async () => {
      finishHistory({
        addedCount: 1,
        messageCount: 2,
        reachedStart: false,
        reachedEnd: false,
        complete: false
      })
      finishMessages({
        items: [message('fixture-stale', { type: 'text', text: '不应显示的旧会话消息' })],
        nextCursor: 'fixture-stale-cursor'
      })
    })
    expect(history).toHaveBeenCalledOnce()
    expect(screen.queryByText('不应显示的旧会话消息')).not.toBeInTheDocument()
    expect(listMessages).not.toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'fixture-stale-cursor' })
    )
  })

  it('cancels history when the source session changes', async () => {
    let finish!: (result: TelegramHistoryResult) => void
    const history = vi.fn(
      () =>
        new Promise<TelegramHistoryResult>((resolve) => {
          finish = resolve
        })
    )
    const nextSnapshot = { ...snapshot, context: { ...context, sessionId: 'fixture-new-session' } }
    window.api = {
      getUnifiedProviderSnapshot: vi.fn().mockResolvedValue(nextSnapshot),
      listUnifiedConversations: vi.fn().mockResolvedValue({ items: [conversation()] }),
      listUnifiedMessages: vi.fn().mockResolvedValue({ items: [] }),
      loadTelegramHistory: history
    } as unknown as typeof window.api
    const refresh = vi.fn()
    const view = render(
      <TooltipProvider>
        <TelegramReadWorkspace snapshot={snapshot} onRefreshLocal={refresh} />
      </TooltipProvider>
    )
    fireEvent.click(await screen.findByRole('button', { name: '补载更早历史' }))
    view.rerender(
      <TooltipProvider>
        <TelegramReadWorkspace snapshot={nextSnapshot} onRefreshLocal={refresh} />
      </TooltipProvider>
    )
    await act(async () =>
      finish({
        addedCount: 1,
        messageCount: 2,
        reachedStart: false,
        reachedEnd: false,
        complete: false
      })
    )
    expect(history).toHaveBeenCalledOnce()
    expect(window.api.getUnifiedProviderSnapshot).not.toHaveBeenCalled()
  })

  it('refreshes the local snapshot after a mocked send so its echo becomes visible', async () => {
    let refreshed = false
    const sendSnapshot = {
      ...snapshot,
      send: {
        capabilities: { ...snapshot.capabilities, canSend: true },
        health: { state: 'ready' as const, available: true }
      }
    }
    const refresh = vi.fn(async () => {
      refreshed = true
    })
    window.api = {
      getUnifiedProviderSnapshot: vi.fn().mockResolvedValue(sendSnapshot),
      listUnifiedConversations: vi.fn().mockResolvedValue({ items: [conversation()] }),
      listUnifiedMessages: vi.fn(async () => ({
        items: refreshed ? [message('fixture-echo', { type: 'text', text: '合成发送回显' })] : []
      })),
      sendUnifiedMessage: vi.fn().mockResolvedValue({ accepted: true })
    } as unknown as typeof window.api
    render(
      <TooltipProvider>
        <TelegramReadWorkspace snapshot={sendSnapshot} onRefreshLocal={refresh} />
      </TooltipProvider>
    )
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Telegram 文字消息' }),
      '合成发送回显'
    )
    await userEvent.click(screen.getByRole('button', { name: '发送文字' }))
    expect(await screen.findByText('合成发送回显')).toBeInTheDocument()
    expect(refresh).toHaveBeenCalledOnce()
  })
})
