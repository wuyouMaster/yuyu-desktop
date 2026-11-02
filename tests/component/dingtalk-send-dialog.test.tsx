import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DingtalkSendDialog } from '../../src/renderer/src/features/dingtalk/DingtalkSendDialog'
import type { ProviderSnapshot } from '../../src/shared/data-source'
import { serializeEntityId } from '../../src/shared/entity-id'

const accountId = serializeEntityId({
  source: 'dingtalk',
  account: 'fixture-account',
  native: 'fixture-account'
})
const conversationId = serializeEntityId({
  source: 'dingtalk',
  account: 'fixture-account',
  native: 'fixture-conversation'
})
const context: NonNullable<ProviderSnapshot['context']> = {
  source: 'dingtalk',
  accountId,
  sessionId: 'fixture-session',
  revision: 'fixture-revision',
  identity: { kind: 'unknown' }
}

function snapshot(sendHealth: NonNullable<ProviderSnapshot['send']>['health']): ProviderSnapshot {
  return {
    source: 'dingtalk',
    accountId,
    context,
    capabilities: {
      supportsRecall: false,
      supportsPayment: false,
      canSend: false,
      hasGroupNicknames: true,
      supportsRealtime: false,
      supportsLazyAssets: false
    },
    health: { state: 'ready', available: true },
    send: {
      capabilities: {
        supportsRecall: false,
        supportsPayment: false,
        canSend: sendHealth.available,
        hasGroupNicknames: true,
        supportsRealtime: false,
        supportsLazyAssets: false
      },
      health: sendHealth
    }
  }
}

afterEach(() => vi.restoreAllMocks())

describe('DingtalkSendDialog', () => {
  it('shows the native loading reason and keeps submit disabled', () => {
    window.api = {} as unknown as typeof window.api
    render(
      <DingtalkSendDialog
        open
        conversationId={conversationId}
        displayName="合成联系人"
        context={context}
        snapshot={snapshot({
          state: 'degraded',
          available: false,
          message: 'fixture native unavailable'
        })}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('fixture native unavailable')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '钉钉文字消息' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '发送文字' })).toBeDisabled()
  })

  it('sends text through the unified API and invokes the refresh callback', async () => {
    const sendUnifiedMessage = vi.fn().mockResolvedValue({ accepted: true })
    window.api = { sendUnifiedMessage } as unknown as typeof window.api
    const onSent = vi.fn()
    const user = userEvent.setup()
    render(
      <DingtalkSendDialog
        open
        conversationId={conversationId}
        displayName="合成联系人"
        context={context}
        snapshot={snapshot({ state: 'ready', available: true })}
        onClose={vi.fn()}
        onSent={onSent}
      />
    )

    await user.type(screen.getByRole('textbox', { name: '钉钉文字消息' }), 'fixture text')
    await user.click(screen.getByRole('button', { name: '发送文字' }))

    expect(sendUnifiedMessage).toHaveBeenCalledWith({
      expectedContext: context,
      conversationId,
      content: { type: 'text', text: 'fixture text' }
    })
    expect(onSent).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('文字已提交给钉钉')
  })
})
