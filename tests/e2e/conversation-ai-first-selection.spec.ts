import { test, expect } from '@playwright/test'
import { launchTestApp } from './support/electron'

test('chat assistant selects the first visible group and preserves it across tabs', async () => {
  const fixture = await launchTestApp()
  try {
    const drawer = fixture.page.getByRole('complementary', { name: '当前聊天 AI 助手' })
    await expect(drawer).toBeVisible()
    await expect(drawer.locator('.conversation-ai-scope')).toContainText('产品测试群')
    const navigation = fixture.page.getByRole('navigation', { name: '一级导航' })
    await navigation.getByRole('button', { name: '设置', exact: true }).click()
    await navigation.getByRole('button', { name: '聊天助手', exact: true }).click()
    await expect(drawer).toBeVisible()
    await fixture.page.locator('.conversation-item').filter({ hasText: '产品测试群' }).click()
    await expect(drawer).toBeVisible()
    await expect(drawer).toBeInViewport()
    await expect(drawer.locator('.conversation-ai-scope')).toContainText('产品测试群')
    await drawer.getByRole('textbox').press('Escape')
    await expect(drawer).toHaveCount(0)
    await fixture.page.locator('.conversation-item').filter({ hasText: '产品测试群' }).click()
    await expect(drawer).toBeVisible()
    for (const tab of ['设置', '日报', '导出']) {
      await navigation.getByRole('button', { name: tab, exact: true }).click()
      await expect(drawer).toHaveCount(0)
      await navigation.getByRole('button', { name: '聊天助手', exact: true }).click()
      await expect(drawer).toBeVisible()
      await expect(drawer).toBeInViewport()
      await expect(drawer.locator('.conversation-ai-scope')).toContainText('产品测试群')
      await fixture.page.locator('.conversation-item').filter({ hasText: '产品测试群' }).click()
      await expect(drawer).toBeVisible()
    }
  } finally {
    await fixture.close()
  }
})
