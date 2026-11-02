import { test, expect } from '@playwright/test'
import { launchTestApp } from './support/electron'

// Real Electron renderer/preload/IPC; synthetic execution result, no account or provider access.
test('archive plan mode renders and resumes through runtime IPC', async ({}, testInfo) => {
  const fixture = await launchTestApp()
  try {
    await fixture.app.evaluate(({ ipcMain }) => {
      for (const channel of ['agent-runtime:run', 'agent-runtime:cancel', 'agent-runtime:forget']) {
        ipcMain.removeHandler(channel)
      }
      ipcMain.handle('agent-runtime:run', (_event, request) => ({
        engine: 'query-agent',
        status: 'answered',
        answer: request.mode === 'plan' ? '合成计划已准备' : '合成任务已完成',
        evidence: [],
        execution: {
          runId: request.requestId,
          state: request.mode === 'plan' ? 'planned' : 'completed',
          planVersion: 1,
          steps: [
            {
              id: 'find',
              objective: '查找合成讨论的结论与待办事项',
              role: 'retriever',
              dependencies: [],
              doneWhen: '找到合成证据',
              state: request.mode === 'plan' ? 'queued' : 'completed'
            }
          ],
          activities: request.mode === 'plan' ? [] : [
            { id: 'fixture-agent', kind: 'agent', label: 'retriever · 查找合成讨论', state: 'completed', startedAt: 100, endedAt: 1100, summary: '找到合成记录' },
            { id: 'fixture-tool', parentId: 'fixture-agent', kind: 'tool', label: '搜索关键词', state: 'completed', startedAt: 200, endedAt: 1000, summary: '返回 2 条结果' }
          ],
          skills: ['extract-action-items'],
          modelCalls: 2,
          toolCalls: 1,
          tokens: 100,
          tokensEstimated: false,
          resumable: request.mode === 'plan'
        },
        stats: {
          tools: [],
          reads: { messageCount: 0, matchedCount: 0, overviewSourceCount: 0, evidenceCount: 0 },
          modelCallCount: 2,
          toolCallCount: 1,
          totalMs: 50
        },
        diagnostics: {
          entry: 'desktop',
          provider: 'fixture',
          model: 'fixture',
          modelCallCount: 2,
          toolCallCount: 1,
          tools: [],
          totalMs: 50,
          outcome: 'answered'
        }
      }))
      ipcMain.handle('agent-runtime:cancel', () => true)
      ipcMain.handle('agent-runtime:forget', () => undefined)
    })
    await fixture.page.locator('.conversation-item').filter({ hasText: '产品测试群' }).click()
    const drawer = fixture.page.getByRole('complementary', { name: '当前聊天 AI 助手' })
    await drawer.getByRole('tab', { name: '分析' }).click()
    await drawer.getByRole('button', { name: '先做计划' }).click()
    await expect(drawer.getByRole('button', { name: '先做计划' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await drawer.getByRole('textbox').fill('整理合成讨论')
    await drawer.getByRole('button', { name: '发送', exact: true }).click()
    await expect(drawer.getByText('合成计划已准备')).toBeVisible()
    await expect(drawer.getByRole('button', { name: '按计划执行' })).toBeInViewport()
    await expect(drawer.getByText('使用方法：提取待办')).toBeVisible()
    await fixture.page.screenshot({ path: testInfo.outputPath('agent-runtime-plan-fixture.png') })
    expect(await drawer.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await drawer.getByRole('button', { name: '按计划执行' }).click()
    await expect(drawer.getByText('合成任务已完成')).toBeVisible()
    await drawer.getByText('retriever · 查找合成讨论').click()
    await drawer.getByText('搜索关键词', { exact: true }).click()
    await expect(drawer.getByText('返回 2 条结果')).toBeVisible()
    await fixture.page.screenshot({ path: testInfo.outputPath('agent-activity-fixture.png') })
  } finally {
    await fixture.close()
  }
})
