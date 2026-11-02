import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatSelectionAction } from '../../src/renderer/src/components/chat/ChatSelectionAction'
import { readSelectedChatQuotes } from '../../src/renderer/src/components/chat/chatQuote'

function selectText(node: Node): void {
  const range = document.createRange()
  range.selectNodeContents(node)
  range.getBoundingClientRect = () => ({ left: 100, top: 120, width: 160, bottom: 150 }) as DOMRect
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
  fireEvent(document, new Event('selectionchange'))
}

afterEach(() => window.getSelection()?.removeAllRanges())

describe('ChatSelectionAction', () => {
  it('keeps partial selections with their own senders across message boundaries', () => {
    const { container } = render(
      <div>
        <div data-quote-sender="合成成员甲">甲的消息内容</div>
        <span>不应引用的时间和昵称</span>
        <div data-quote-sender="合成成员乙">乙的消息内容</div>
      </div>
    )
    const nodes = container.querySelectorAll('[data-quote-sender]')
    const range = document.createRange()
    range.setStart(nodes[0].firstChild!, 2)
    range.setEnd(nodes[1].firstChild!, 4)
    expect(readSelectedChatQuotes(range, container)).toEqual([
      { sender: '合成成员甲', text: '消息内容' },
      { sender: '合成成员乙', text: '乙的消息' }
    ])
  })

  it('quotes the selection and dismisses the action', () => {
    const listRef = createRef<HTMLDivElement>()
    const onQuote = vi.fn()
    render(
      <>
        <div ref={listRef}>
          <div data-quote-sender="合成成员甲">合成消息原文</div>
        </div>
        <ChatSelectionAction listRef={listRef} onQuote={onQuote} />
      </>
    )
    selectText(listRef.current!)
    expect(screen.getByRole('button', { name: '引用到 AI' })).toHaveStyle({
      left: '118px',
      top: '76px'
    })
    fireEvent.click(screen.getByRole('button', { name: '引用到 AI' }))
    expect(onQuote).toHaveBeenCalledWith([{ sender: '合成成员甲', text: '合成消息原文' }])
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('ignores outside selections and dismisses on scroll or Escape', () => {
    const listRef = createRef<HTMLDivElement>()
    render(
      <>
        <div ref={listRef}>
          <div data-quote-sender="合成成员甲">合成消息</div>
        </div>
        <p>外部文本</p>
        <ChatSelectionAction listRef={listRef} onQuote={vi.fn()} />
      </>
    )
    selectText(screen.getByText('外部文本'))
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    selectText(listRef.current!)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    selectText(listRef.current!)
    fireEvent.scroll(listRef.current!)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
