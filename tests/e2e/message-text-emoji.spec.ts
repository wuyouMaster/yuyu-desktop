import { expect, test } from '@playwright/test'
import { launchTestApp } from './support/electron'

test('shows bracketed emoji names as original message text', async ({}, testInfo) => {
  const fixture = await launchTestApp({ textEmojiFixture: true })
  try {
    await fixture.page.locator('.conversation-item').filter({ hasText: '产品测试群' }).click()
    const text = fixture.page.locator('.message-text').filter({ hasText: '合成消息 [微笑] [未知表情] 🙂' })
    await expect(text).toHaveText('合成消息 [微笑] [未知表情] 🙂')
    await expect(text.locator('img')).toHaveCount(0)
    await fixture.page.screenshot({ path: testInfo.outputPath('text-emoji.png') })
  } finally {
    await fixture.close()
  }
})
