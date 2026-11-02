import { expect, test } from '@playwright/test'
import { launchTestApp } from './support/electron'

// Synthetic diagnostic result: these tests validate renderer/preload/IPC, not database decoding.
for (const mode of ['disconnected', 'connected'] as const) {
  test(`DingTalk discovery entry works while ${mode}`, async () => {
    const testInfo = test.info()
    const fixture = await launchTestApp({
      mode,
      appearanceTheme: mode === 'connected' ? 'dark' : 'light'
    })
    const page = fixture.page
    try {
      await fixture.app.evaluate(({ ipcMain }) => {
        ipcMain.handle('source:inspectDingtalkLocal', () => ({
          source: 'dingtalk',
          state: 'detected',
          checkedAt: new Date().toISOString(),
          truncated: false,
          message: '发现合成测试数据库，尚未具备读取能力。',
          accounts: [
            {
              id: 'fixture-dingtalk',
              label: '合成测试账号',
              state: 'needs_decoder',
              canRead: false,
              canSend: false,
              databases: [{ name: 'dingtalk.db', format: 'encoded_or_unknown', walPresent: true }]
            }
          ]
        }))
      })
      if (mode === 'disconnected') {
        await page.getByRole('button', { name: '配置钉钉' }).click()
      } else {
        const welcome = page.getByRole('dialog', { name: '开始探索你的微信' })
        await expect(page.getByRole('button', { name: /切换数据源，当前/ })).toBeVisible()
        if (await welcome.isVisible()) await welcome.getByRole('button', { name: '关闭' }).click()
        await page.getByRole('button', { name: /切换数据源，当前/ }).click()
        await page.getByRole('menuitem', { name: '添加数据源…' }).click()
      }
      const dialog = page.getByRole('dialog', { name: '添加数据源' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: '检测本机钉钉' }).click()
      await expect(dialog.getByText('合成测试账号 · 尚未连接')).toBeVisible()
      await expect(dialog.getByRole('button', { name: '重新检测钉钉' })).toBeEnabled()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      )
      await page.screenshot({
        path: testInfo.outputPath('dingtalk-diagnostic.png'),
        animations: 'disabled'
      })
      await dialog.getByRole('button', { name: '关闭', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      if (mode === 'connected') {
        await expect(page.getByRole('button', { name: /切换数据源，当前：微信/ })).toBeVisible()
      } else {
        await expect(page.getByRole('heading', { name: '选择你的开始方式' })).toBeVisible()
      }
    } finally {
      await fixture.close()
    }
  })
}
