import { expect, test } from '@playwright/test'
import { launchTestApp } from './support/electron'

for (const theme of ['light', 'dark'] as const) {
  test(`priority watch setup, context, persistence and jump (${theme})`, async () => {
    const fixture = await launchTestApp({ appearanceTheme: theme })
    const errors: string[] = []
    fixture.page.on('pageerror', (error) => errors.push(error.message))
    try {
      const page = fixture.page
      const nav = page.getByRole('navigation', { name: '一级导航' })
      await nav.getByRole('button', { name: '重点关注', exact: true }).click()
      await page.locator('.priority-watch-header').getByRole('button', { name: '管理关注' }).click()
      await page.getByLabel('选择群聊').selectOption('group-regular-md5')
      await page.getByRole('checkbox', { name: /测试成员/ }).check()
      await page.getByRole('button', { name: '保存关注' }).click()
      const card = page
        .locator('.priority-watch-message')
        .filter({ hasText: '这是一条脱敏测试消息' })
      await expect(card).toBeVisible()
      await card.getByRole('button', { name: '查看上下文' }).click()
      await expect(card.getByRole('region', { name: '消息上下文' })).toBeVisible()
      expect(
        await page
          .locator('.priority-watch-messages')
          .evaluate((el) => el.scrollWidth <= el.clientWidth)
      ).toBe(true)
      await page.screenshot({ path: `test-results/priority-watch-${theme}.png` })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true)
      await card.getByRole('button', { name: '跳转原聊天' }).click()
      await expect(page.locator('.priority-watch')).toHaveCount(0)
      await expect(page.locator('.archive-jump-message')).toBeVisible()
      await nav.getByRole('button', { name: '重点关注', exact: true }).click()
      await expect(
        page.locator('.priority-watch-message').filter({ hasText: '这是一条脱敏测试消息' })
      ).toBeVisible()
      await page.reload()
      await nav.getByRole('button', { name: '重点关注', exact: true }).click()
      await expect(
        page.locator('.priority-watch-message').filter({ hasText: '这是一条脱敏测试消息' })
      ).toBeVisible()
      expect(errors).toEqual([])
    } finally {
      await fixture.close()
    }
  })
}
