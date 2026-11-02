import { expect, test } from '@playwright/test'
import { launchTestApp } from './support/electron'

test('image settings return keeps the visible message anchored after a row is remeasured', async () => {
  const fixture = await launchTestApp({ missingImageKey: true, historyMessages: 40 })
  try {
    await fixture.page.setViewportSize({ width: 1400, height: 500 })
    const image = fixture.page.getByRole('button', { name: '图片待解锁，前往配置图片密钥' })
    const list = fixture.page.locator('.wechat-message-list')
    await expect(image).toBeVisible()
    await expect(fixture.page.locator('.chat-image-key-notice')).toBeVisible()
    await list.hover()
    await fixture.page.mouse.wheel(0, -500)
    await expect(fixture.page.getByRole('button', { name: '跳转到最新消息' })).toBeEnabled()
    await image.focus()
    const capture = await image.evaluateHandle((button) => {
      const state = {
        position: null as null | { index: number; offset: number; previousHeight: number }
      }
      button.addEventListener(
        'click',
        () => {
          const element = button.closest('.wechat-message-list')!
          const top = element.getBoundingClientRect().top
          const rows = Array.from(element.querySelectorAll<HTMLElement>('.virtual-message-group'))
          const row = rows.find((node) => node.getBoundingClientRect().bottom > top + 1)!
          const index = Number(row.dataset.index)
          const previous = rows.find((node) => Number(node.dataset.index) === index - 1)!
          state.position = {
            index,
            offset: row.getBoundingClientRect().top - top,
            previousHeight: previous.getBoundingClientRect().height
          }
        },
        { once: true, capture: true }
      )
      return state
    })
    await fixture.page.keyboard.press('Enter')
    const saved = await capture.evaluate((state) => state.position!)
    await capture.dispose()
    expect(saved.index).toBeGreaterThan(0)
    await expect(fixture.page.getByRole('heading', { name: '图片解密', exact: true })).toBeVisible()
    await fixture.page.addStyleTag({
      content: `.virtual-message-group[data-index="${saved.index - 1}"] { padding-bottom: 15px; }`
    })
    await fixture.page
      .getByRole('navigation', { name: '一级导航' })
      .getByRole('button', { name: '聊天助手' })
      .click()
    await expect(image).toBeVisible()
    await expect(fixture.page.locator('.chat-image-key-notice')).toBeVisible()
    await expect
      .poll(() =>
        list
          .locator(`[data-index="${saved.index - 1}"]`)
          .evaluate((node) => node.getBoundingClientRect().height)
      )
      .toBeCloseTo(saved.previousHeight + 15, 0)
    await expect
      .poll(() =>
        list.evaluate((element, index) => {
          const row = element.querySelector<HTMLElement>(`[data-index="${index}"]`)!
          return row.getBoundingClientRect().top - element.getBoundingClientRect().top
        }, saved.index)
      )
      .toBeCloseTo(saved.offset, 0)
    const latest = fixture.page.getByRole('button', { name: '跳转到最新消息' })
    await latest.click()
    await expect(fixture.page.getByRole('button', { name: '已是最新消息' })).toBeDisabled()
    await expect
      .poll(() =>
        list.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)
      )
      .toBeLessThanOrEqual(24)
  } finally {
    await fixture.close()
  }
})
