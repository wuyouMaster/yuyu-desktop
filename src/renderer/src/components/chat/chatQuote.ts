export interface ChatQuote {
  sender: string
  text: string
}

export function readSelectedChatQuotes(range: Range, list: HTMLElement): ChatQuote[] {
  return Array.from(list.querySelectorAll<HTMLElement>('[data-quote-sender]')).flatMap((node) => {
    if (!range.intersectsNode(node)) return []
    const part = document.createRange()
    part.selectNodeContents(node)
    if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) {
      part.setStart(range.startContainer, range.startOffset)
    }
    if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) {
      part.setEnd(range.endContainer, range.endOffset)
    }
    const text = part.toString().trim()
    return text ? [{ sender: node.dataset.quoteSender || '未知发送者', text }] : []
  })
}
