import { test, expect } from '@playwright/test'
import { launchTestApp } from './support/electron'

test('chat streams through preload, preserves drafts across tabs and promotes quotes', async ({}, testInfo) => {
  const fixture = await launchTestApp()
  try {
    await fixture.app.evaluate(({ ipcMain }) => {
      ipcMain.handle('conversation-chat:run', async (event, request) => {
        const activities = [{ id: 'fixture-tool', kind: 'tool', label: '查询聊天消息', state: 'running', startedAt: Date.now() }]
        event.sender.send('ask-wechat:progress', request.requestId, {
          stage: 'searching', at: Date.now(), elapsedMs: 0, modelCallCount: 1, toolCallCount: 1, activities
        })
        event.sender.send('conversation-chat:delta', request.requestId, '合成流式回复')
        await new Promise((resolve) => setTimeout(resolve, 700))
        return { success: true, answer: '合成流式回复已完成。需要历史记录时可以转为分析。',
          activities: activities.map((item) => ({ ...item, state: 'completed', endedAt: Date.now(), summary: '返回 3 条结果' })) }
      })
      ipcMain.handle('conversation-chat:cancel', () => true)
      ipcMain.removeHandler('agent-runtime:forget')
      ipcMain.handle('agent-runtime:forget', () => undefined)
    })
    await fixture.page.locator('.conversation-item').filter({ hasText: '产品测试群' }).click()
    const drawer = fixture.page.getByRole('complementary', { name: '当前聊天 AI 助手' })
    await expect(drawer.getByRole('tab', { name: '对话', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(drawer.getByRole('button', { name: '先做计划' })).toHaveCount(0)
    await drawer.getByRole('textbox').fill('帮我润色一段合成文案')
    await drawer.getByRole('tab', { name: '分析', exact: true }).click()
    await expect(drawer.getByRole('textbox')).toHaveValue('帮我润色一段合成文案')
    await expect(drawer.getByRole('button', { name: '先做计划' })).toBeVisible()
    await drawer.getByRole('tab', { name: '对话', exact: true }).click()
    await drawer.getByRole('button', { name: '发送', exact: true }).click()
    await expect(drawer.getByText('合成流式回复', { exact: true })).toBeVisible()
    await expect(drawer.getByText('合成流式回复已完成。需要历史记录时可以转为分析。')).toBeVisible()
    await expect(drawer.getByText('查询聊天消息')).toBeVisible()
    await drawer.locator('.conversation-ai-activity-item > summary').click()
    await expect(drawer.getByText('返回 3 条结果')).toBeVisible()
    await drawer.getByRole('textbox').fill('另一段草稿')
    await drawer.getByRole('button', { name: '转为分析' }).click()
    await expect(drawer.getByRole('textbox')).toHaveValue('帮我润色一段合成文案\n\n另一段草稿')
    await expect(drawer.getByRole('tab', { name: '分析', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(await drawer.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    const headerBottoms = await fixture.page.evaluate(() => [
      document.querySelector('.chat-archive-header')!.getBoundingClientRect().bottom,
      document.querySelector('.conversation-ai-header')!.getBoundingClientRect().bottom
    ])
    expect(Math.abs(headerBottoms[0] - headerBottoms[1])).toBeLessThanOrEqual(1)
    await fixture.page.screenshot({ path: testInfo.outputPath('conversation-ai-tabs-analysis.png') })
    await drawer.getByRole('tab', { name: '对话', exact: true }).click()
    await fixture.page.screenshot({ path: testInfo.outputPath('conversation-ai-tabs-chat.png') })
    const rightInset = await drawer.evaluate((el) => {
      const header = el.querySelector('.conversation-ai-header')!
      const tabs = el.querySelector('.conversation-ai-tabs')!
      return header.getBoundingClientRect().right - tabs.getBoundingClientRect().right
    })
    expect(Math.abs(rightInset - 16)).toBeLessThanOrEqual(1)
    await drawer.getByRole('textbox').press('Escape')
    await expect(drawer).toHaveCount(0)
    const toggle = fixture.page.getByRole('button', { name: '问这个聊天', exact: true })
    await expect(toggle).toBeFocused()
    await toggle.click()
    await expect(drawer).toBeVisible()
    await toggle.click()
    await expect(drawer).toHaveCount(0)

  } finally {
    await fixture.close()
  }
})
