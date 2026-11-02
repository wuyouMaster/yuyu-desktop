import { test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { launchTestApp } from './support/electron'

interface AuditIssue {
  page: string
  subview?: string
  type: 'overflow' | 'alignment' | 'button-style' | 'spacing' | 'visual-bug'
  selector: string
  text?: string
  detail: string
}

async function auditPage(page: import('@playwright/test').Page, pageName: string, subview = ''): Promise<AuditIssue[]> {
  return page.evaluate(({ pageName, subview }) => {
    const issues: Array<{
      page: string
      subview?: string
      type: 'overflow' | 'alignment' | 'button-style' | 'spacing' | 'visual-bug'
      selector: string
      text?: string
      detail: string
    }> = []

    const allElements = Array.from(document.querySelectorAll('*'))
    for (const el of allElements) {
      if (!(el instanceof HTMLElement)) continue
      if (el.tagName === 'SVG' || el.tagName === 'PATH') continue

      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue

      // 1. Check for text or container overflow (scrollWidth > clientWidth)
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 3) {
        const isScrollable = style.overflowX === 'auto' || style.overflowX === 'scroll'
        if (!isScrollable) {
          const directText = Array.from(el.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent?.trim())
            .filter(Boolean)
            .join(' ')
          issues.push({
            page: pageName,
            subview,
            type: 'overflow',
            selector: el.className ? `${el.tagName.toLowerCase()}.${Array.from(el.classList).slice(0, 3).join('.')}` : el.tagName.toLowerCase(),
            text: directText.slice(0, 40) || el.innerText?.slice(0, 40),
            detail: `scrollWidth (${el.scrollWidth}px) > clientWidth (${el.clientWidth}px), text may be clipped or stretching layout`
          })
        }
      }

      // 2. Check icon + text horizontal row alignment
      // Look for elements whose display is flex/inline-flex with both svg and text
      if (style.display.includes('flex') && style.flexDirection === 'row') {
        const svg = el.querySelector(':scope > svg, :scope > span > svg')
        if (svg) {
          const svgRect = svg.getBoundingClientRect()
          for (const child of Array.from(el.children)) {
            if (child !== svg && !child.contains(svg) && (child.tagName === 'SPAN' || child.tagName === 'B' || child.tagName === 'LABEL' || child.tagName === 'P')) {
              const textRect = child.getBoundingClientRect()
              if (svgRect.width > 0 && textRect.width > 0 && Math.abs(svgRect.top - textRect.top) < 30) {
                const svgCenterY = svgRect.top + svgRect.height / 2
                const textCenterY = textRect.top + textRect.height / 2
                const diff = Math.abs(svgCenterY - textCenterY)
                if (diff > 3.5) {
                  issues.push({
                    page: pageName,
                    subview,
                    type: 'alignment',
                    selector: el.className ? `.${Array.from(el.classList).slice(0, 3).join('.')}` : el.tagName.toLowerCase(),
                    text: child.textContent?.slice(0, 30),
                    detail: `Row icon and text vertical center misalignment: icon Y=${svgCenterY.toFixed(1)}, text Y=${textCenterY.toFixed(1)}, diff=${diff.toFixed(1)}px`
                  })
                }
              }
            }
          }
        }
      }

      // 3. Check for bare <button> or button styling violations
      if (el.tagName === 'BUTTON') {
        const btn = el as HTMLButtonElement
        if (!btn.className || btn.className.trim() === '') {
          issues.push({
            page: pageName,
            subview,
            type: 'button-style',
            selector: 'button (bare)',
            text: btn.innerText?.slice(0, 30),
            detail: 'Bare <button> tag without any className or style'
          })
        }
      }
    }

    return issues
  }, { pageName, subview })
}

test('Comprehensive UI audit of all pages', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const screenshotsDir = testInfo.outputPath('audit-screenshots')
  mkdirSync(screenshotsDir, { recursive: true })
  const allIssues: AuditIssue[] = []

  // 1. Disconnected / Login Page
  {
    console.log('[Audit] Testing Disconnected Login Page...')
    const fixture = await launchTestApp({ mode: 'disconnected' })
    try {
      await fixture.page.waitForTimeout(800)
      await fixture.page.screenshot({ path: `${screenshotsDir}/01-login-automatic.png` })
      allIssues.push(...await auditPage(fixture.page, 'login', 'automatic'))

      const advancedTab = fixture.page.getByRole('tab', { name: /高级用户/ })
      if (await advancedTab.isVisible()) {
        await advancedTab.click()
        await fixture.page.waitForTimeout(500)
        await fixture.page.screenshot({ path: `${screenshotsDir}/01-login-manual.png` })
        allIssues.push(...await auditPage(fixture.page, 'login', 'manual'))
      }
    } finally {
      await fixture.close()
    }
  }

  // 2. Connected App - All Pages
  {
    console.log('[Audit] Testing Connected App Pages...')
    const fixture = await launchTestApp({ mode: 'connected', templateMarket: 'fixture' })
    try {
      await fixture.page.waitForTimeout(1000)

      // Dismiss first-use welcome dialog if present
      const welcome = fixture.page.getByRole('dialog', { name: '开始探索你的微信' })
      if (await welcome.isVisible()) {
        await fixture.page.screenshot({ path: `${screenshotsDir}/02-first-use-welcome.png` })
        allIssues.push(...await auditPage(fixture.page, 'first-use-welcome'))
        await welcome.getByRole('button', { name: '关闭' }).click()
        await fixture.page.waitForTimeout(300)
      }

      // Helper to navigate via primary rail
      const goToNav = async (label: string): Promise<boolean> => {
        const item = fixture.page.locator(`button.primary-nav-item[title="${label}"]`)
        if (await item.isVisible()) {
          await item.click()
          await fixture.page.waitForTimeout(600)
          return true
        }
        console.warn(`[Audit] Nav item "${label}" not visible`)
        return false
      }

      // Page 1: 档案
      console.log('[Audit] 1. 档案...')
      if (await goToNav('聊天助手')) {
        const firstContact = fixture.page.locator('.conversation-item').first()
        if (await firstContact.isVisible()) {
          await firstContact.click()
          await fixture.page.waitForTimeout(500)
        }
        await fixture.page.screenshot({ path: `${screenshotsDir}/03-archive-main.png` })
        allIssues.push(...await auditPage(fixture.page, 'archive', 'main'))

        const conversationAI = fixture.page.getByRole('complementary', { name: '当前聊天 AI 助手' })
        if (await conversationAI.isVisible()) {
          await fixture.page.screenshot({ path: `${screenshotsDir}/03-archive-ai-idle.png` })
          allIssues.push(...await auditPage(fixture.page, 'archive', 'ai-idle'))
          const aiInput = fixture.page.getByRole('textbox', { name: '询问当前聊天' })
          await aiInput.fill('测试群讨论了什么？')
          await fixture.page.getByRole('button', { name: '发送', exact: true }).click()
          await fixture.page.waitForTimeout(800)
          await fixture.page.screenshot({ path: `${screenshotsDir}/03-archive-ai-result.png` })
          allIssues.push(...await auditPage(fixture.page, 'archive', 'ai-result'))
        }

        // Send dialog
        const sendBtn = fixture.page.getByRole('button', { name: '微信发送' })
        if (await sendBtn.isVisible()) {
          await sendBtn.click()
          await fixture.page.waitForTimeout(400)
          await fixture.page.screenshot({ path: `${screenshotsDir}/03-archive-send-dialog.png` })
          allIssues.push(...await auditPage(fixture.page, 'archive', 'send-dialog'))
          await fixture.page.keyboard.press('Escape')
          await fixture.page.waitForTimeout(300)
        }
      }

      // Page 2: 群聊洞察
      console.log('[Audit] 2. 群聊洞察...')
      if (await goToNav('群聊洞察')) {
        await fixture.page.screenshot({ path: `${screenshotsDir}/04-group-analytics.png` })
        allIssues.push(...await auditPage(fixture.page, 'analytics', 'overview'))
      }

      // Page 3: 日报
      console.log('[Audit] 3. 日报...')
      if (await goToNav('日报')) {
        await fixture.page.screenshot({ path: `${screenshotsDir}/06-report-idle.png` })
        allIssues.push(...await auditPage(fixture.page, 'report', 'idle'))

        // Subtabs: 今日日报, 定时日报, 模板市场
        const scheduledTab = fixture.page.getByRole('button', { name: /定时日报/ })
        if (await scheduledTab.isVisible()) {
          await scheduledTab.click()
          await fixture.page.waitForTimeout(500)
          await fixture.page.screenshot({ path: `${screenshotsDir}/06-report-scheduled.png` })
          allIssues.push(...await auditPage(fixture.page, 'report', 'scheduled'))
        }

        const marketTab = fixture.page.getByRole('button', { name: /模板市场/ })
        if (await marketTab.isVisible()) {
          await marketTab.click()
          await fixture.page.waitForTimeout(500)
          await fixture.page.screenshot({ path: `${screenshotsDir}/06-report-market.png` })
          allIssues.push(...await auditPage(fixture.page, 'report', 'market'))
        }

        const todayTab = fixture.page.getByRole('button', { name: /今日日报/ })
        if (await todayTab.isVisible()) {
          await todayTab.click()
          await fixture.page.waitForTimeout(400)
          const createBtn = fixture.page.getByRole('button', { name: '开始生成日报' })
          if (await createBtn.isVisible()) {
            await createBtn.click()
            await fixture.page.waitForTimeout(400)
            const firstSource = fixture.page.locator('.report-source-item').first()
            if (await firstSource.isVisible()) await firstSource.click()
            await fixture.page.waitForTimeout(400)
            await fixture.page.screenshot({ path: `${screenshotsDir}/06-report-config.png` })
            allIssues.push(...await auditPage(fixture.page, 'report', 'config'))
          }
        }
      }

      // Page 4: 退群监控
      console.log('[Audit] 4. 退群监控...')
      if (await goToNav('退群监控')) {
        await fixture.page.screenshot({ path: `${screenshotsDir}/07-exit-monitor-main.png` })
        allIssues.push(...await auditPage(fixture.page, 'exit-monitor', 'main'))

        const manageBtn = fixture.page.getByRole('button', { name: '管理群聊' })
        if (await manageBtn.isVisible()) {
          await manageBtn.click()
          await fixture.page.waitForTimeout(500)
          await fixture.page.screenshot({ path: `${screenshotsDir}/07-exit-monitor-manage.png` })
          allIssues.push(...await auditPage(fixture.page, 'exit-monitor', 'manage'))

          const viewTemplateBtn = fixture.page.getByRole('button', { name: '查看退群监测模板' })
          if (await viewTemplateBtn.isVisible()) {
            await viewTemplateBtn.click()
            await fixture.page.waitForTimeout(400)
            await fixture.page.screenshot({ path: `${screenshotsDir}/07-exit-monitor-template.png` })
            await fixture.page.keyboard.press('Escape')
            await fixture.page.waitForTimeout(300)
          }
          await fixture.page.keyboard.press('Escape')
          await fixture.page.waitForTimeout(300)
        }
      }

      // Page 5: Agent
      console.log('[Audit] 5. Agent...')
      if (await goToNav('Agent')) {
        await fixture.page.screenshot({ path: `${screenshotsDir}/08-agent-hub.png` })
        allIssues.push(...await auditPage(fixture.page, 'agent-hub', 'main'))
      }

      // Page 6: 导出
      console.log('[Audit] 6. 导出...')
      if (await goToNav('导出')) {
        await fixture.page.screenshot({ path: `${screenshotsDir}/09-export-main.png` })
        allIssues.push(...await auditPage(fixture.page, 'export', 'main'))
      }

      // Page 7: API
      console.log('[Audit] 7. API...')
      if (await goToNav('API')) {
        await fixture.page.screenshot({ path: `${screenshotsDir}/10-api-main.png` })
        allIssues.push(...await auditPage(fixture.page, 'api', 'main'))

        const previewBtn = fixture.page.locator('#api-reader-skill').getByRole('button', { name: '预览 Skill' })
        if (await previewBtn.isVisible()) {
          await previewBtn.click()
          await fixture.page.waitForTimeout(400)
          await fixture.page.screenshot({ path: `${screenshotsDir}/10-api-skill-preview.png` })
          allIssues.push(...await auditPage(fixture.page, 'api', 'skill-preview'))
          await fixture.page.keyboard.press('Escape')
          await fixture.page.waitForTimeout(300)
        }
      }

      // Page 8: 设置
      console.log('[Audit] 8. 设置...')
      if (await goToNav('设置')) {
        const settingsTabs = [
          '账号与数据库',
          '数据库密钥',
          '图片解密',
          '语音转文字',
          '文字转语音',
          'AI 模型',
          '微信发送',
          '缓存与清理',
          '防撤回',
          '高级',
          '关于'
        ]

        for (const tabName of settingsTabs) {
          const tabBtn = fixture.page.getByRole('button', { name: tabName, exact: true })
          if (await tabBtn.isVisible()) {
            await tabBtn.click()
            await fixture.page.waitForTimeout(400)
            const slug = tabName.replace(/\s+/g, '-')
            await fixture.page.screenshot({ path: `${screenshotsDir}/11-settings-${slug}.png` })
            allIssues.push(...await auditPage(fixture.page, 'settings', tabName))
          }
        }
      }

      console.log(`[Audit] Completed! Recorded ${allIssues.length} issue candidates.`);
      writeFileSync(
        resolve(screenshotsDir, '..', 'audit-results.json'),
        JSON.stringify(allIssues, null, 2),
        'utf8'
      )
    } finally {
      await fixture.close()
    }
  }
})
