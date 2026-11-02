import React, { useEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../ui'
import { AiIcon } from './icons'
import { readSelectedChatQuotes, type ChatQuote } from './chatQuote'

interface Props {
  listRef: RefObject<HTMLDivElement | null>
  onQuote: (quotes: ChatQuote[]) => void
}

export function ChatSelectionAction({ listRef, onQuote }: Props): React.ReactPortal | null {
  const [selection, setSelection] = useState<{ quotes: ChatQuote[]; x: number; y: number } | null>(
    null
  )

  useEffect(() => {
    let selecting = false
    const clear = (): void => setSelection(null)
    const update = (): void => {
      if (selecting) return
      const selected = window.getSelection()
      const list = listRef.current
      if (!selected || selected.isCollapsed || !selected.rangeCount || !list) return clear()
      const range = selected.getRangeAt(0)
      if (!list.contains(range.startContainer) || !list.contains(range.endContainer)) return clear()
      const quotes = readSelectedChatQuotes(range, list)
      if (!quotes.length) return clear()
      const rect = range.getBoundingClientRect()
      setSelection({
        quotes,
        x: Math.max(8, Math.min(rect.left + rect.width / 2 - 62, window.innerWidth - 132)),
        y: rect.top >= 52 ? rect.top - 44 : Math.min(rect.bottom + 10, window.innerHeight - 42)
      })
    }
    const pointerdown = (event: PointerEvent): void => {
      if ((event.target as Element).closest?.('.chat-selection-action')) return
      selecting = true
      clear()
    }
    const pointerup = (): void => {
      selecting = false
      update()
    }
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') clear()
    }
    document.addEventListener('selectionchange', update)
    document.addEventListener('pointerdown', pointerdown)
    document.addEventListener('pointerup', pointerup)
    document.addEventListener('pointercancel', pointerup)
    document.addEventListener('keydown', keydown)
    window.addEventListener('resize', clear)
    window.addEventListener('scroll', clear, true)
    return () => {
      document.removeEventListener('selectionchange', update)
      document.removeEventListener('pointerdown', pointerdown)
      document.removeEventListener('pointerup', pointerup)
      document.removeEventListener('pointercancel', pointerup)
      document.removeEventListener('keydown', keydown)
      window.removeEventListener('resize', clear)
      window.removeEventListener('scroll', clear, true)
    }
  }, [listRef])

  if (!selection) return null
  return createPortal(
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="chat-selection-action"
      style={{ left: selection.x, top: selection.y }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        window.getSelection()?.removeAllRanges()
        setSelection(null)
        onQuote(selection.quotes)
      }}
    >
      <AiIcon />
      引用到 AI
    </Button>,
    document.body
  )
}
