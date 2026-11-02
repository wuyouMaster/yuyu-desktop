import { expect, test } from '@playwright/test'
import { launchTestApp } from './support/electron'

test('MEDIA-05 missing image key guides setup, preserves position, and retries after saving', async () => {
  const fixture = await launchTestApp({ missingImageKey: true, historyMessages: 40 })
  const pageErrors: Error[] = []
  fixture.page.on('pageerror', (error) => pageErrors.push(error))
  try {
    await fixture.page.setViewportSize({ width: 1400, height: 500 })
    const lockedImage = fixture.page.getByRole('button', {
      name: '图片待解锁，前往配置图片密钥'
    })
    const notice = fixture.page.locator('.chat-image-key-notice')
    await expect(lockedImage).toBeVisible()
    await expect(notice).toContainText('获取成功后，请记得保存')
    const messageList = fixture.page.locator('.wechat-message-list')
    await expect
      .poll(() => messageList.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(24)
    await messageList.hover()
    await fixture.page.mouse.wheel(0, -500)
    await expect(fixture.page.getByRole('button', { name: '跳转到最新消息' })).toBeEnabled()
    // Focusing can measure more virtual rows; capture the position at activation, before navigation.
    const navigationPosition = await lockedImage.evaluateHandle((button) => {
      const position = { scrollTop: -1, groupId: '', offset: 0 }
      button.addEventListener(
        'click',
        () => {
          const scroller = button.closest('.wechat-message-list')
          if (scroller) {
            position.scrollTop = scroller.scrollTop
            const top = scroller.getBoundingClientRect().top
            const anchor = Array.from(
              scroller.querySelectorAll<HTMLElement>('[data-group-id]')
            ).find((row) => row.getBoundingClientRect().bottom > top + 1)
            if (anchor) {
              position.groupId = anchor.dataset.groupId!
              position.offset = anchor.getBoundingClientRect().top - top
            }
          }
        },
        { once: true, capture: true }
      )
      return position
    })
    await lockedImage.focus()
    await fixture.page.keyboard.press('Enter')
    const originalPosition = await navigationPosition.evaluate((position) => position)
    await navigationPosition.dispose()
    expect(originalPosition.scrollTop).toBeGreaterThan(24)
    expect(originalPosition.groupId).not.toBe('')
    await expect(fixture.page.getByRole('heading', { name: '图片解密', exact: true })).toBeVisible()
    const automatic = fixture.page.locator('.image-auto-detect')
    await automatic.getByRole('button', { name: '开始自动获取' }).click()
    await expect(automatic.getByText('验证成功，尚未保存')).toBeVisible()
    const navigation = fixture.page.getByRole('navigation', { name: '一级导航' })
    await navigation.getByRole('button', { name: '聊天助手' }).click()
    await expect(lockedImage).toBeVisible()
    await expect(notice).toBeVisible()
    await expect
      .poll(() =>
        messageList.evaluate((element, groupId) => {
          const row = Array.from(element.querySelectorAll<HTMLElement>('[data-group-id]')).find(
            (node) => node.dataset.groupId === groupId
          )
          return row ? row.getBoundingClientRect().top - element.getBoundingClientRect().top : null
        }, originalPosition.groupId)
      )
      .toBeCloseTo(originalPosition.offset, 0)
    await expect(fixture.page.getByRole('button', { name: '跳转到最新消息' })).toBeEnabled()

    await notice.getByRole('button', { name: '去获取图片密钥' }).click()
    await automatic.getByRole('button', { name: '开始自动获取' }).click()
    await expect(automatic.getByText('验证成功，尚未保存')).toBeVisible()
    await automatic.getByRole('button', { name: '保存图片密钥' }).click()
    await expect(automatic.getByText('图片密钥已保存', { exact: true })).toBeVisible()
    await navigation.getByRole('button', { name: '聊天助手' }).click()
    await expect(fixture.page.locator('.image-loaded img').first()).toBeVisible()
    await expect(notice).toHaveCount(0)
    await expect(lockedImage).toHaveCount(0)
    expect(pageErrors).toEqual([])
  } finally {
    await fixture.close()
  }
})
