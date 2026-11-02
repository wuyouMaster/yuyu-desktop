import { expect, test } from '@playwright/test'
import { launchTestApp } from './support/electron'

test('fixture keeps the baseline viewport when the native window is constrained', async ({}, testInfo) => {
  const fixture = await launchTestApp()
  try {
    // GitHub's macOS VM constrains native windows to a smaller display than the baseline.
    await fixture.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(1024, 674)
    })
    await expect
      .poll(() =>
        fixture.page.evaluate(() => ({
          width: window.innerWidth,
          height: window.innerHeight
        }))
      )
      .toEqual({ width: 1400, height: 768 })
    await expect(fixture.page.getByRole('button', { name: '刷新聊天记录' })).toBeVisible()
    await fixture.page.getByRole('button', { name: '刷新聊天记录' }).click()
    await expect(fixture.page.locator('.conversation-item-name').first()).toBeVisible()
    const cdp = await fixture.page.context().newCDPSession(fixture.page)
    try {
      await cdp.send('DOM.enable')
      await cdp.send('CSS.enable')
      const { root } = await cdp.send('DOM.getDocument')
      const { nodeId } = await cdp.send('DOM.querySelector', {
        nodeId: root.nodeId,
        selector: '.conversation-item-name'
      })
      const fonts = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
      expect(fonts.fonts.length).toBeGreaterThan(0)
      const environment = {
        fonts: fonts.fonts,
        native: await fixture.app.evaluate(({ app, screen, systemPreferences }) => ({
          locale: app.getLocale(),
          languages: app.getPreferredSystemLanguages(),
          displayScaleFactor: screen.getPrimaryDisplay().scaleFactor,
          gpu: app.getGPUFeatureStatus(),
          scrollbars:
            process.platform === 'darwin'
              ? systemPreferences.getUserDefault('AppleShowScrollBars', 'string')
              : undefined
        })),
        renderer: await fixture.page.evaluate(() => {
          const row = document.querySelector<HTMLElement>('.conversation-item-name')!
          const style = getComputedStyle(row)
          const bounds = row.getBoundingClientRect()
          return {
            language: navigator.language,
            languages: navigator.languages,
            devicePixelRatio,
            viewport: { width: innerWidth, height: innerHeight },
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
          }
        })
      }
      if (process.platform === 'darwin') {
        expect(environment.native.displayScaleFactor).toBe(2)
        expect(environment.renderer.devicePixelRatio).toBe(1)
      }
      // Keep diagnostic evidence in raw CI logs too, when artifact downloads are unavailable.
      console.log('[fixture-rendering-environment]', JSON.stringify(environment))
      await testInfo.attach('fixture-rendering-environment', {
        body: JSON.stringify(environment, null, 2),
        contentType: 'application/json'
      })
    } finally {
      await cdp.detach()
    }
  } finally {
    await fixture.close()
  }
})

test('macOS fixture controls scrollbar layout independently of the host preference', async () => {
  test.skip(process.platform !== 'darwin', 'macOS native scrollbar preference')
  for (const macScrollbars of ['Always', 'WhenScrolling'] as const) {
    const fixture = await launchTestApp({ mode: 'disconnected', macScrollbars })
    try {
      await fixture.page.setViewportSize({ width: 1400, height: 500 })
      await expect(
        fixture.page.getByRole('heading', { name: '语屿 YUYU', exact: true })
      ).toBeVisible()
      expect(
        await fixture.app.evaluate(({ systemPreferences }) =>
          systemPreferences.getUserDefault('AppleShowScrollBars', 'string')
        )
      ).toBe(macScrollbars)
      const gutter = await fixture.page
        .locator('.database-login-workspace')
        .evaluate((node) => (node as HTMLElement).offsetWidth - node.clientWidth)
      if (macScrollbars === 'Always') expect(gutter).toBeGreaterThan(0)
      else expect(gutter).toBe(0)
    } finally {
      await fixture.close()
    }
  }
})
