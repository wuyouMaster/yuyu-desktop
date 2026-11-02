import { expect, test } from '@playwright/test'
import { launchTestApp } from './support/electron'

test('runtime management remains accessible beside the connected source selector', async () => {
  const fixture = await launchTestApp({ mode: 'connected' })
  try {
    const { page } = fixture
    const welcome = page.getByRole('dialog', { name: '开始探索你的微信' })
    if (await welcome.isVisible()) await welcome.getByRole('button', { name: '关闭' }).click()
    const source = page.getByRole('button', { name: /切换数据源/ })
    await expect(source).toBeVisible()
    const before = await source.getAttribute('aria-label')
    await page.getByRole('button', { name: '管理应用运行时', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '管理应用运行时' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('region', { name: '应用运行时管理' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(source).toHaveAttribute('aria-label', before!)
    await page.screenshot({ path: '.tmp/runtime-source-entry.png' })
  } finally {
    await fixture.close()
  }
})

test('connection guide allows entering the workspace without a data source', async () => {
  const fixture = await launchTestApp({ mode: 'disconnected' })
  try {
    const { page } = fixture
    const entry = page.getByRole('region', { name: '开始使用' })
    await expect(entry).toBeVisible()
    await expect(entry.getByRole('heading', { name: '选择你的开始方式' })).toBeVisible()
    await expect(page.getByRole('list', { name: '微信连接阶段' })).toHaveCount(0)
    await expect(entry.getByRole('button', { name: '暂不连接，进入主界面' })).toBeInViewport()
    await expect(entry.getByRole('button', { name: '管理应用运行时' })).toBeInViewport()
    await page.screenshot({ path: '.tmp/runtime-guide-entry.png' })
    await entry.getByRole('button', { name: '暂不连接，进入主界面' }).click()
    const source = page.getByRole('button', { name: /切换数据源/ })
    await expect(source).toBeVisible()
    await expect(source).not.toContainText('已连接')
    await expect(page.getByRole('heading', { name: '从一个数据源开始' })).toBeVisible()
    await expect(page.getByRole('button', { name: '连接微信' })).toBeDisabled()
    await page.reload()
    await expect(page.getByRole('heading', { name: '从一个数据源开始' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '开始连接微信' })).toBeHidden()
    await page.getByRole('button', { name: '管理应用运行时', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '管理应用运行时' })).toBeVisible()
    await page.keyboard.press('Escape')
    await source.click()
    await page.getByRole('menuitem', { name: '添加数据源…' }).click()
    await expect(page.getByRole('dialog', { name: '添加数据源' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('heading', { name: '从一个数据源开始' }).click()
    await expect(page.getByRole('menu', { name: '数据源与账号' })).toBeHidden()
    await page.screenshot({ path: '.tmp/runtime-unconnected-workspace.png' })
  } finally {
    await fixture.close()
  }
})
