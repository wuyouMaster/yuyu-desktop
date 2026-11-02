import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TelegramSendDialog } from '../../src/renderer/src/features/telegram/TelegramSendDialog'
import type { ProviderSnapshot } from '../../src/shared/data-source'
import { serializeEntityId } from '../../src/shared/entity-id'

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

function snapshot(available: boolean): ProviderSnapshot {
  const health = available
    ? { state: 'ready' as const, available: true }
    : {
        state: 'degraded' as const,
        available: false,
        message: 'fixture Telegram Desktop unavailable'
      }
  return {
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
    health: { state: 'ready', available: true },
    send: {
      capabilities: {
        supportsRecall: false,
        supportsPayment: false,
        canSend: available,
        hasGroupNicknames: false,
        supportsRealtime: false,
        supportsLazyAssets: false
      },
      health
    }
  }
}

afterEach(() => vi.restoreAllMocks())

describe('TelegramSendDialog', () => {
  it('shows the native unavailable reason and keeps submit disabled', () => {
    window.api = {} as unknown as typeof window.api
    render(
      <TelegramSendDialog
        open
        conversationId={conversationId}
        displayName="合成 Telegram 群组"
        context={context}
        snapshot={snapshot(false)}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('fixture Telegram Desktop unavailable')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Telegram 文字消息' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '发送文字' })).toBeDisabled()
  })

  it('sends text through the unified API and clears the editor after confirmed success', async () => {
    const sendUnifiedMessage = vi.fn().mockResolvedValue({ accepted: true })
    window.api = { sendUnifiedMessage } as unknown as typeof window.api
    const onSent = vi.fn()
    const user = userEvent.setup()
    render(
      <TelegramSendDialog
        open
        conversationId={conversationId}
        displayName="合成 Telegram 群组"
        context={context}
        snapshot={snapshot(true)}
        onClose={vi.fn()}
        onSent={onSent}
      />
    )

    const textbox = screen.getByRole('textbox', { name: 'Telegram 文字消息' })
    await user.type(textbox, 'fixture text')
    await user.click(screen.getByRole('button', { name: '发送文字' }))

    expect(sendUnifiedMessage).toHaveBeenCalledWith({
      expectedContext: context,
      conversationId,
      content: { type: 'text', text: 'fixture text' }
    })
    expect(onSent).toHaveBeenCalledOnce()
    expect(textbox).toHaveValue('')
    expect(screen.getByRole('status')).toHaveTextContent('文字已发送，并已在 Telegram 中确认回显')
  })

  it('marks an unconfirmed native result as uncertain', async () => {
    window.api = {
      sendUnifiedMessage: vi.fn().mockResolvedValue({
        accepted: false,
        error: '未能确认发送结果，请检查 Telegram 目标会话'
      })
    } as unknown as typeof window.api
    const user = userEvent.setup()
    render(
      <TelegramSendDialog
        open
        conversationId={conversationId}
        displayName="合成 Telegram 群组"
        context={context}
        snapshot={snapshot(true)}
        onClose={vi.fn()}
      />
    )

    await user.type(screen.getByRole('textbox', { name: 'Telegram 文字消息' }), 'fixture text')
    await user.click(screen.getByRole('button', { name: '发送文字' }))

    expect(screen.getByRole('status')).toHaveTextContent('未能确认发送结果')
  })
})

it('selects a local PNG and sends its caption through the pinned Telegram context', async () => {
  const runtimeId = serializeEntityId({
    source: 'telegram',
    account: 'telegram-local:' + 'a'.repeat(24),
    native: 'account'
  })
  const runtimeSnapshot = { ...snapshot(true), accountId: runtimeId }
  const sendUnifiedMessage = vi.fn().mockResolvedValue({ accepted: true })
  const selectSourceSendFile = vi
    .fn()
    .mockResolvedValue({ canceled: false, path: '/fixture/synthetic.png' })
  window.api = { sendUnifiedMessage, selectSourceSendFile } as unknown as typeof window.api
  const user = userEvent.setup()
  render(
    <TelegramSendDialog
      open
      conversationId={conversationId}
      displayName="Fixture Saved Messages"
      context={context}
      snapshot={runtimeSnapshot}
      onClose={vi.fn()}
    />
  )
  await user.click(screen.getByRole('button', { name: '选择 PNG 图片' }))
  expect(screen.getByRole('button', { name: '发送图片' })).toBeDisabled()
  await user.type(screen.getByRole('textbox', { name: 'Telegram 图片说明' }), 'fixture caption')
  await user.click(screen.getByRole('button', { name: '发送图片' }))
  expect(sendUnifiedMessage).toHaveBeenCalledWith({
    conversationId,
    expectedContext: context,
    content: {
      type: 'image',
      localPath: '/fixture/synthetic.png',
      extensions: { telegram: { caption: 'fixture caption' } }
    }
  })
  expect(screen.getByRole('status')).toHaveTextContent('图片已发送')
})

it('selects a local file and sends its caption through the pinned Telegram context', async () => {
  const runtimeId = serializeEntityId({
    source: 'telegram',
    account: 'telegram-local:' + 'a'.repeat(24),
    native: 'account'
  })
  const runtimeSnapshot = { ...snapshot(true), accountId: runtimeId }
  const sendUnifiedMessage = vi.fn().mockResolvedValue({ accepted: true })
  const selectSourceSendFile = vi
    .fn()
    .mockResolvedValue({ canceled: false, path: '/fixture/synthetic.txt' })
  window.api = { sendUnifiedMessage, selectSourceSendFile } as unknown as typeof window.api
  const user = userEvent.setup()
  render(
    <TelegramSendDialog
      open
      conversationId={conversationId}
      displayName="Fixture Saved Messages"
      context={context}
      snapshot={runtimeSnapshot}
      onClose={vi.fn()}
    />
  )
  await user.click(screen.getByRole('button', { name: '选择文件' }))
  expect(screen.getByRole('button', { name: '发送文件' })).toBeDisabled()
  await user.type(screen.getByRole('textbox', { name: 'Telegram 文件说明' }), 'fixture caption')
  await user.click(screen.getByRole('button', { name: '发送文件' }))
  expect(sendUnifiedMessage).toHaveBeenCalledWith({
    conversationId,
    expectedContext: context,
    content: {
      type: 'file',
      localPath: '/fixture/synthetic.txt',
      extensions: { telegram: { caption: 'fixture caption' } }
    }
  })
  expect(screen.getByRole('status')).toHaveTextContent('文件已发送')
})

it.each([
  { kind: 'audio', select: '选择语音', send: '发送语音气泡', path: '/fixture/voice.wav' },
  { kind: 'sticker', select: '选择贴纸', send: '发送贴纸', path: '/fixture/sticker.webp' }
])('sends $kind without a caption or stale editor text', async ({ kind, select, send, path }) => {
  const runtimeSnapshot = {
    ...snapshot(true),
    accountId: serializeEntityId({
      source: 'telegram',
      account: 'telegram-local:' + 'a'.repeat(24),
      native: 'account'
    })
  }
  const sendUnifiedMessage = vi.fn().mockResolvedValue({ accepted: true })
  const selectSourceSendFile = vi.fn().mockResolvedValue({ canceled: false, path })
  window.api = { sendUnifiedMessage, selectSourceSendFile } as unknown as typeof window.api
  const user = userEvent.setup()
  render(
    <TelegramSendDialog
      open
      conversationId={conversationId}
      displayName="Fixture Saved Messages"
      context={context}
      snapshot={runtimeSnapshot}
      onClose={vi.fn()}
    />
  )
  await user.type(screen.getByRole('textbox'), 'fixture stale caption')
  await user.click(screen.getByRole('button', { name: select }))
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: send }))
  expect(selectSourceSendFile).toHaveBeenCalledWith(kind)
  expect(sendUnifiedMessage).toHaveBeenCalledWith({
    expectedContext: context,
    conversationId,
    content: { type: kind, localPath: path }
  })
})

it('selects an album and sends all images with one caption', async () => {
  const runtimeSnapshot = {
    ...snapshot(true),
    accountId: serializeEntityId({
      source: 'telegram',
      account: 'telegram-local:' + 'a'.repeat(24),
      native: 'account'
    })
  }
  const paths = ['/fixture/first.png', '/fixture/second.png']
  const sendUnifiedMessage = vi.fn().mockResolvedValue({ accepted: true })
  window.api = {
    sendUnifiedMessage,
    selectSourceSendFile: vi.fn().mockResolvedValue({ canceled: false, path: paths[0], paths })
  } as unknown as typeof window.api
  const user = userEvent.setup()
  render(
    <TelegramSendDialog
      open
      conversationId={conversationId}
      displayName="Fixture Saved Messages"
      context={context}
      snapshot={runtimeSnapshot}
      onClose={vi.fn()}
    />
  )
  await user.click(screen.getByRole('button', { name: '选择相册' }))
  expect(screen.getByRole('button', { name: '发送相册' })).toBeDisabled()
  await user.type(screen.getByRole('textbox', { name: 'Telegram 相册说明' }), 'fixture caption')
  await user.click(screen.getByRole('button', { name: '发送相册' }))
  expect(sendUnifiedMessage).toHaveBeenCalledWith({
    expectedContext: context,
    conversationId,
    content: {
      type: 'image',
      localPaths: paths,
      extensions: { telegram: { caption: 'fixture caption' } }
    }
  })
})
