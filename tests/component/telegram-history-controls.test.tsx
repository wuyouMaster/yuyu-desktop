import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TelegramHistoryControls } from '../../src/renderer/src/features/telegram/TelegramHistoryControls'
import type { ProviderSnapshot } from '../../src/shared/data-source'
import type { TelegramHistoryResult } from '../../src/shared/telegram-history'
import { serializeEntityId } from '../../src/shared/entity-id'

const accountId = serializeEntityId({
  source: 'telegram',
  account: 'fixture-account',
  native: 'account'
})
const conversationId = serializeEntityId({
  source: 'telegram',
  account: 'fixture-account',
  native: 'chat/fixture-group'
})
const snapshot: ProviderSnapshot = {
  source: 'telegram',
  accountId,
  context: {
    source: 'telegram',
    accountId,
    sessionId: 'fixture-session',
    revision: 'fixture-revision',
    identity: { kind: 'account' }
  },
  capabilities: {
    canSend: false,
    supportsLazyAssets: true,
    supportsRecall: false,
    supportsPayment: false,
    supportsRealtime: false,
    hasGroupNicknames: false
  },
  health: { state: 'ready', available: true }
}
const page: TelegramHistoryResult = {
  addedCount: 1,
  messageCount: 20,
  reachedStart: false,
  reachedEnd: false,
  complete: false
}

function setup(load = vi.fn().mockResolvedValue({ ...page, complete: true })): ReturnType<
  typeof render
> & {
  load: typeof load
  onSettled: ReturnType<typeof vi.fn>
  onBusyChange: ReturnType<typeof vi.fn>
} {
  window.api = { loadTelegramHistory: load } as unknown as typeof window.api
  const onSettled = vi.fn().mockResolvedValue(undefined)
  const onBusyChange = vi.fn()
  const view = render(
    <TelegramHistoryControls
      conversationId={conversationId}
      snapshot={snapshot}
      busy={false}
      onSettled={onSettled}
      onBusyChange={onBusyChange}
    />
  )
  return { ...view, load, onSettled, onBusyChange }
}

afterEach(() => vi.useRealTimers())

describe('Telegram history paging controls', () => {
  it('does not mistake incoming messages for progress toward older history', async () => {
    const { load } = setup(vi.fn().mockResolvedValue({ ...page, addedCount: 5, advanced: false }))
    fireEvent.click(screen.getByRole('button', { name: '补载更早历史' }))
    expect(await screen.findByText(/连续 3 页无历史推进/)).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(3)
  })
  it('loads both directions under one budget for complete history', async () => {
    const { load } = setup(
      vi
        .fn()
        .mockResolvedValueOnce({ ...page, reachedStart: true })
        .mockResolvedValueOnce({ ...page, reachedStart: true, reachedEnd: true, complete: true })
    )
    fireEvent.click(screen.getByRole('button', { name: '补载此会话完整历史' }))
    expect(await screen.findByText(/历史已完整加载/)).toBeInTheDocument()
    expect(load.mock.calls.map(([request]) => request.direction)).toEqual(['older', 'newer'])
  })
  it('explains client actions before starting and pins context for sequential pages', async () => {
    const { load, onSettled } = setup(
      vi
        .fn()
        .mockResolvedValueOnce(page)
        .mockResolvedValueOnce({ ...page, complete: true })
    )
    expect(screen.getByText(/操作 Telegram 客户端打开当前会话并滚动/)).toBeInTheDocument()
    expect(load).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '补载更早历史' }))
    expect(await screen.findByText(/历史已完整加载/)).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenNthCalledWith(2, {
      conversationId,
      expectedContext: snapshot.context,
      direction: 'older'
    })
    expect(onSettled).toHaveBeenCalledOnce()
  })

  it('stops after three empty pages without claiming completion', async () => {
    const { load } = setup(vi.fn().mockResolvedValue({ ...page, addedCount: 0 }))
    fireEvent.click(screen.getByRole('button', { name: '补载更早历史' }))
    expect(await screen.findByText(/连续 3 页无历史推进/)).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(3)
    expect(screen.queryByText(/历史已完整加载/)).not.toBeInTheDocument()
  })

  it('resets the empty-page budget after real progress', async () => {
    const empty = { ...page, addedCount: 0 }
    const { load } = setup(
      vi
        .fn()
        .mockResolvedValueOnce(empty)
        .mockResolvedValueOnce(empty)
        .mockResolvedValueOnce(page)
        .mockResolvedValue(empty)
    )
    fireEvent.click(screen.getByRole('button', { name: '补载更早历史' }))
    await screen.findByText(/连续 3 页无历史推进/)
    expect(load).toHaveBeenCalledTimes(6)
  })

  it.each(['older', 'newer'] as const)(
    'stops at the %s boundary without inventing completeness',
    async (direction) => {
      const { load } = setup(
        vi.fn().mockResolvedValue({ ...page, reachedStart: true, reachedEnd: true })
      )
      fireEvent.click(
        screen.getByRole('button', {
          name: direction === 'older' ? '补载更早历史' : '补载较新消息'
        })
      )
      await screen.findByText(direction === 'older' ? /已到达历史起点/ : /已到达最新一端/)
      expect(load).toHaveBeenCalledOnce()
      expect(load).toHaveBeenCalledWith({
        conversationId,
        expectedContext: snapshot.context,
        direction
      })
      expect(screen.queryByText(/历史已完整加载/)).not.toBeInTheDocument()
    }
  )

  it('cancels subsequent pages and refreshes after the in-flight page settles', async () => {
    let finish!: (result: TelegramHistoryResult) => void
    const { load, onSettled } = setup(
      vi.fn(
        () =>
          new Promise<TelegramHistoryResult>((resolve) => {
            finish = resolve
          })
      )
    )
    fireEvent.click(screen.getByRole('button', { name: '补载更早历史' }))
    fireEvent.click(screen.getByRole('button', { name: '取消补载' }))
    expect(onSettled).not.toHaveBeenCalled()
    await act(async () => finish(page))
    await screen.findByText(/已取消补载/)
    expect(load).toHaveBeenCalledOnce()
    expect(onSettled).toHaveBeenCalledOnce()
  })

  it('prevents duplicate loops and cancels on unmount', async () => {
    let finish!: (result: TelegramHistoryResult) => void
    const { load, unmount } = setup(
      vi.fn(
        () =>
          new Promise<TelegramHistoryResult>((resolve) => {
            finish = resolve
          })
      )
    )
    fireEvent.click(screen.getByRole('button', { name: '补载更早历史' }))
    fireEvent.click(screen.getByRole('button', { name: '补载较新消息' }))
    unmount()
    await act(async () => finish(page))
    expect(load).toHaveBeenCalledOnce()
  })

  it('limits a continuous stream to 100 pages', async () => {
    const { load } = setup(vi.fn().mockResolvedValue(page))
    fireEvent.click(screen.getByRole('button', { name: '补载更早历史' }))
    await screen.findByText(/已达到 100 页上限/)
    expect(load).toHaveBeenCalledTimes(100)
  })

  it('stops after five minutes even while a page is pending', async () => {
    vi.useFakeTimers()
    let finish!: (result: TelegramHistoryResult) => void
    const { load, onSettled } = setup(
      vi.fn(
        () =>
          new Promise<TelegramHistoryResult>((resolve) => {
            finish = resolve
          })
      )
    )
    fireEvent.click(screen.getByRole('button', { name: '补载更早历史' }))
    await act(async () => vi.advanceTimersByTimeAsync(300_000))
    expect(screen.getByText(/已达到 5 分钟上限/)).toBeInTheDocument()
    await act(async () => finish(page))
    expect(load).toHaveBeenCalledOnce()
    expect(onSettled).toHaveBeenCalledOnce()
    expect(screen.queryByText(/历史已完整加载/)).not.toBeInTheDocument()
  })

  it('refreshes on page failure and releases the busy state', async () => {
    const { onSettled, onBusyChange } = setup(
      vi.fn().mockRejectedValue(new Error('fixture runtime unavailable'))
    )
    fireEvent.click(screen.getByRole('button', { name: '补载更早历史' }))
    await screen.findByText(/fixture runtime unavailable/)
    expect(onSettled).toHaveBeenCalledOnce()
    expect(onBusyChange.mock.calls).toEqual([[true], [false]])
  })

  it('keeps the local control visible but disabled when the API is missing', async () => {
    setup()
    window.api = {} as typeof window.api
    const view = render(
      <TelegramHistoryControls
        conversationId={conversationId}
        snapshot={snapshot}
        busy={false}
        onBusyChange={vi.fn()}
        onSettled={vi.fn()}
      />
    )
    await waitFor(() =>
      expect(view.getAllByRole('button', { name: '补载更早历史' })[1]).toBeDisabled()
    )
  })
})
