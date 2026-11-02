import { expect, test } from '@playwright/test'
import { launchTestApp } from './support/electron'

test('startup loads live conversations when the cache contains only the account profile', async () => {
  const fixture = await launchTestApp({ selfOnlyBootstrapCache: true })
  const pageErrors: Error[] = []
  fixture.page.on('pageerror', (error) => pageErrors.push(error))
  try {
    const cache = await fixture.page.evaluate(() => window.api.getBootstrapCache())
    expect(cache?.self).toBeTruthy()
    expect(cache?.contacts).toHaveLength(0)

    await expect(fixture.page.getByRole('navigation', { name: '一级导航' })).toBeVisible()
    await expect(
      fixture.page.locator('.conversation-item').filter({ hasText: '产品测试群' })
    ).toBeVisible()
    await expect(fixture.page.getByText('这是一条脱敏测试消息', { exact: true })).toBeVisible()
    expect(pageErrors).toEqual([])
  } finally {
    await fixture.close()
  }
})
