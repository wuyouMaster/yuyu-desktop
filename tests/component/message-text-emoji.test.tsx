import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MessageBubble } from '../../src/renderer/src/components/chat/MessageBubble'
import { RichMessageBubble } from '../../src/renderer/src/components/RichMessageBubble'

describe('message text containing bracketed emoji names', () => {
  it('keeps normal message text unchanged without loading emoji images', () => {
    const text = '你好 [微笑] [未知表情] 🙂'
    const { container } = render(
      <MessageBubble
        message={{ id: 'fixture', from: 'fixture-sender', type: '文本', datetime: '', content: text, isSender: false }}
        contact={{ m_nsUsrName: 'fixture', m_nsNickName: 'Fixture', md5: '', type: 'user' }}
        isGroupChat={false}
        isMine={false}
        showAvatarSpace
        onImageClick={vi.fn()}
      />
    )
    expect(screen.getByText(text)).toBeVisible()
    expect(container.querySelector('img')).toBeNull()
  })

  it('preserves quoted and reply text exactly', () => {
    const { container } = render(
      <RichMessageBubble contentData={{ type: 'quote', quotedContent: '原文 [微笑]', content: '回复 [捂脸]' }} />
    )
    expect(screen.getByText('原文 [微笑]')).toBeVisible()
    expect(screen.getByText('回复 [捂脸]')).toBeVisible()
    expect(container.querySelector('img')).toBeNull()
  })

  it('preserves system and forwarded message text', () => {
    const { container } = render(
      <>
        <RichMessageBubble contentData={{ type: 'system', content: '系统 [微笑]' }} />
        <RichMessageBubble contentData={{ type: 'forwardBundle', title: '记录', items: [{ messageType: 1, text: '转发 [捂脸]' }] }} />
      </>
    )
    expect(screen.getByText('系统 [微笑]')).toBeVisible()
    expect(screen.getByText('转发 [捂脸]')).toBeVisible()
    expect(container.querySelector('img')).toBeNull()
  })
})
