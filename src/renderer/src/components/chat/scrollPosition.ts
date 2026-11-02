export interface ScrollAnchor {
  groupId: string
  offset: number
}

export function captureScrollAnchor(list: HTMLElement): ScrollAnchor | undefined {
  const top = list.getBoundingClientRect().top
  const row = Array.from(list.querySelectorAll<HTMLElement>('[data-group-id]')).find(
    (node) => node.getBoundingClientRect().bottom > top + 1
  )
  return row
    ? { groupId: row.dataset.groupId!, offset: row.getBoundingClientRect().top - top }
    : undefined
}

/** Keep the same message at the same screen offset while virtual rows finish measuring.
 * User input ends restoration immediately so later layout changes cannot fight scrolling. */
export function restoreScrollPosition(
  list: HTMLElement,
  position: { scrollTop: number; anchor?: ScrollAnchor },
  restored: () => void,
  stopped: () => void
): () => void {
  let active = true
  let frame = 0
  let notified = false
  const apply = (): void => {
    frame = 0
    if (!active) return
    const row =
      position.anchor &&
      Array.from(list.querySelectorAll<HTMLElement>('[data-group-id]')).find(
        (node) => node.dataset.groupId === position.anchor!.groupId
      )
    if (row && position.anchor) {
      const delta =
        row.getBoundingClientRect().top - list.getBoundingClientRect().top - position.anchor.offset
      if (Math.abs(delta) > 0.1) list.scrollTop += delta
    } else if (Math.abs(list.scrollTop - position.scrollTop) > 0.1) {
      list.scrollTop = position.scrollTop
    }
    if (!notified) {
      notified = true
      restored()
    }
  }
  const queue = (): void => {
    if (active && !frame) frame = requestAnimationFrame(apply)
  }
  const resize = new ResizeObserver(queue)
  resize.observe(list)
  const content = list.querySelector('.virtual-message-list')
  if (content) resize.observe(content)
  const mutation = new MutationObserver(queue)
  if (content)
    mutation.observe(content, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style']
    })
  const stop = (): void => {
    if (!active) return
    active = false
    cancelAnimationFrame(frame)
    resize.disconnect()
    mutation.disconnect()
    for (const type of ['wheel', 'touchstart', 'pointerdown']) list.removeEventListener(type, stop)
    list.removeEventListener('keydown', keyboard)
    stopped()
  }
  const keyboard = (event: KeyboardEvent): void => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key))
      stop()
  }
  for (const type of ['wheel', 'touchstart', 'pointerdown'])
    list.addEventListener(type, stop, { passive: true })
  list.addEventListener('keydown', keyboard)
  list.scrollTop = position.scrollTop
  queue()
  return stop
}
