import { expect, test } from '@playwright/test'
import { launchTestApp } from './support/electron'

test('usage guide is accessible from both onboarding routes and preserves setup', async () => {
  const fixture = await launchTestApp({ mode: 'disconnected' })
  try {
    const { page } = fixture
    const trigger = page.getByRole('button', { name: '使用说明', exact: true })
    await expect(trigger).toBeInViewport()
    await page.screenshot({ path: '.tmp/usage-guide-entry.png' })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'YUYU 使用说明' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: '可以先进入主界面' })).toBeVisible()
    await page.screenshot({ path: '.tmp/usage-guide-start.png' })
    await dialog.getByRole('tab', { name: '连接数据源' }).click()
    await expect(dialog.getByRole('region', { name: 'Telegram 使用说明' })).toBeVisible()
    await page.screenshot({ path: '.tmp/usage-guide-sources.png' })
    await page.setViewportSize({ width: 1000, height: 600 })
    await dialog.getByRole('tab', { name: '常见问题' }).click()
    const lastQuestion = dialog.getByRole('heading', { name: '必须配置 AI 吗？' })
    await lastQuestion.scrollIntoViewIfNeeded()
    await expect(lastQuestion).toBeInViewport()
    await expect(dialog.getByRole('button', { name: '我知道了' })).toBeInViewport()
    await page.screenshot({ path: '.tmp/usage-guide-small-window.png' })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    await page.getByRole('button', { name: '配置微信', exact: true }).click()
    await page.getByRole('tab', { name: /高级用户/ }).click()
    await page.getByLabel('数据库密钥', { exact: true }).fill('a'.repeat(64))
    await trigger.click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '我知道了' }).click()
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    await expect(page.getByLabel('数据库密钥', { exact: true })).toHaveValue('a'.repeat(64))
    await expect(page.getByRole('tab', { name: /高级用户/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  } finally {
    await fixture.close()
  }
})
