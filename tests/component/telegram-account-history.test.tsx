import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TelegramAccountHistory } from '../../src/renderer/src/features/telegram/TelegramAccountHistory'
import type { ProviderSnapshot } from '../../src/shared/data-source'
import type { TelegramHistoryQueueStatus } from '../../src/shared/telegram-history'
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
  health: { state: 'ready', available: true, capturedAt: Date.UTC(2026, 0, 1, 8, 30) }
}

const job: TelegramHistoryQueueStatus = {
  jobId: 'fixture-job',
  state: 'running',
  startedAt: 1,
  pages: 0,
  addedCount: 0,
  messageCount: 1,
  items: [
    {
      conversationId,
      title: 'Fixture chat',
      state: 'pending',
      pages: 0,
      addedCount: 0,
      messageCount: 1
    }
  ]
}
function setup(get = vi.fn().mockResolvedValue(undefined)) {
  const start = vi.fn().mockResolvedValue(job)
  const cancel = vi.fn().mockResolvedValue({ ...job, state: 'stopping' })
  window.api = {
    startTelegramHistoryQueue: start,
    getTelegramHistoryQueue: get,
    cancelTelegramHistoryQueue: cancel
  } as unknown as typeof window.api
  const settled = vi.fn().mockResolvedValue(undefined),
    busy = vi.fn()
  const view = render(
    <TelegramAccountHistory
      snapshot={snapshot}
      busy={false}
      onSettled={settled}
      onBusyChange={busy}
    />
  )
  return { ...view, start, get, cancel, settled, busy }
}
afterEach(() => vi.useRealTimers())
describe('Telegram account history UI', () => {
  it('keeps the snapshot context visible and expands instructions without starting a job', () => {
    const f = setup()
    expect(screen.getByRole('heading', { name: 'Telegram 本地快照' })).toBeVisible()
    expect(screen.getByText(/仅包含已采集消息，尚非完整历史/)).toBeVisible()
    expect(screen.getByText(/读取于/)).toHaveAttribute('datetime', '2026-01-01T08:30:00.000Z')
    const help = screen.getByRole('button', { name: '补载说明' })
    const instructions = screen.getByText(/补载会依次打开 Telegram/)
    expect(help).toHaveAttribute('aria-expanded', 'false')
    expect(instructions).not.toBeVisible()
    fireEvent.click(help)
    expect(help).toHaveAttribute('aria-expanded', 'true')
    expect(instructions).toBeVisible()
    fireEvent.click(help)
    expect(instructions).not.toBeVisible()
    expect(f.start).not.toHaveBeenCalled()
  })

  it('starts with pinned context and cancellation identifies the exact job', async () => {
    const f = setup()
    await waitFor(() => expect(f.get).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: '补载当前账号全部会话' }))
    await screen.findByRole('button', { name: '取消账号补载' })
    expect(f.start).toHaveBeenCalledWith({ expectedContext: snapshot.context })
    fireEvent.click(screen.getByRole('button', { name: '取消账号补载' }))
    await screen.findByRole('button', { name: '正在停止…' })
    expect(f.cancel).toHaveBeenCalledWith({ expectedContext: snapshot.context, jobId: job.jobId })
    expect(f.busy).toHaveBeenCalledWith(true)
  })
  it('displays separate outcomes without describing skipped chats as complete', async () => {
    const f = setup()
    const result = {
      ...job,
      state: 'finished',
      items: [{ ...job.items[0], state: 'skipped', reason: 'open_in_client' }]
    }
    f.get.mockResolvedValue(result)
    await screen.findByText(/Fixture chat · 跳过/, {}, { timeout: 2500 })
    expect(screen.getByText(/此类会话需先在 Telegram/)).toBeInTheDocument()
    await waitFor(() => expect(f.settled).toHaveBeenCalledOnce())
  })
  it('cancels a late start result when the workspace has already unmounted', async () => {
    const f = setup()
    let finish!: (value: TelegramHistoryQueueStatus) => void
    f.start.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    fireEvent.click(screen.getByRole('button', { name: '补载当前账号全部会话' }))
    f.unmount()
    await act(async () => finish(job))
    expect(f.cancel).toHaveBeenCalledWith({ expectedContext: snapshot.context, jobId: job.jobId })
  })
  it('ignores a pre-start poll that resolves after the newly started job', async () => {
    let finish!: (value: undefined) => void
    const get = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const f = setup(get)
    fireEvent.click(screen.getByRole('button', { name: '补载当前账号全部会话' }))
    await screen.findByRole('button', { name: '取消账号补载' })
    await act(async () => finish(undefined))
    expect(screen.getByRole('button', { name: '取消账号补载' })).toBeInTheDocument()
    f.unmount()
    expect(f.cancel).toHaveBeenCalledWith({ expectedContext: snapshot.context, jobId: job.jobId })
  })
  it('cancels a late start from the previous source without attaching it to the new source', async () => {
    const f = setup()
    let finish!: (value: TelegramHistoryQueueStatus) => void
    f.start.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    fireEvent.click(screen.getByRole('button', { name: '补载当前账号全部会话' }))
    const next: ProviderSnapshot = {
      ...snapshot,
      context: { ...snapshot.context!, sessionId: 'fixture-next' }
    }
    f.rerender(
      <TelegramAccountHistory
        snapshot={next}
        busy={false}
        onSettled={f.settled}
        onBusyChange={f.busy}
      />
    )
    await act(async () => finish(job))
    expect(f.cancel).toHaveBeenCalledWith({ expectedContext: snapshot.context, jobId: job.jobId })
    expect(screen.queryByRole('button', { name: '取消账号补载' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '补载当前账号全部会话' })).toBeEnabled()
  })
  it('discards a delayed cancellation response after the source changes', async () => {
    const f = setup()
    fireEvent.click(screen.getByRole('button', { name: '补载当前账号全部会话' }))
    await screen.findByRole('button', { name: '取消账号补载' })
    let finish!: (value: TelegramHistoryQueueStatus) => void
    f.cancel.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    fireEvent.click(screen.getByRole('button', { name: '取消账号补载' }))
    const next: ProviderSnapshot = {
      ...snapshot,
      context: { ...snapshot.context!, sessionId: 'fixture-next' }
    }
    f.rerender(
      <TelegramAccountHistory
        snapshot={next}
        busy={false}
        onSettled={f.settled}
        onBusyChange={f.busy}
      />
    )
    await act(async () => finish({ ...job, state: 'stopping' }))
    expect(screen.queryByRole('button', { name: '正在停止…' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '补载当前账号全部会话' })).toBeEnabled()
  })
})
