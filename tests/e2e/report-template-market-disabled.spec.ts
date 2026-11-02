import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('the disabled market rejects IPC without a network request', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'yuyu-disabled-market-'))
  const app = await electron.launch({
    args: [resolve('out/main/reportTemplateTest.js')],
    env: { ...process.env, YUYU_TEMPLATE_TEST_USER_DATA: userData, YUYU_TEMPLATE_TEST_MARKET_FIXTURE: '0' }
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const network = await app.evaluateHandle(() => {
      const state = { requests: 0 }
      globalThis.fetch = async () => {
        state.requests += 1
        throw new Error('unexpected request')
      }
      return state
    })
    const result = await page.evaluate(async () => ({
      catalog: await window.api.listReportTemplateCatalog(),
      install: await window.api.installReportTemplateFromCatalog('community.github.fixture.example', '1.0.0')
    }))
    expect(result.catalog).toMatchObject({ success: false, code: 'market_unavailable' })
    expect(result.install).toMatchObject({ success: false, code: 'market_unavailable' })
    expect(await network.evaluate((state) => state.requests)).toBe(0)
    await network.dispose()
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
  }
})
