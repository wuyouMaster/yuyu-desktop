import { expect, test } from '@playwright/test'
import { launchTestApp } from './support/electron'

// Synthetic IPC fixtures validate the renderer/preload connection path, not a real Telegram account.
for (const mode of ['disconnected', 'connected'] as const) {
  test(`native macOS Telegram connects and pages read-only messages while ${mode}`, async () => {
    const fixture = await launchTestApp({
      mode,
      appearanceTheme: mode === 'connected' ? 'dark' : 'light'
    })
    const page = fixture.page
    try {
      await fixture.app.evaluate(({ ipcMain }) => {
        const account = 'synthetic-native-account'
        const id = (native: string): string =>
          ['telegram', account, native].map(encodeURIComponent).join(':')
        const accountId = id('account')
        const conversationId = id('chat/1')
        const context = {
          source: 'telegram',
          accountId,
          sessionId: 'synthetic-session',
          revision: 'synthetic-revision',
          identity: { kind: 'account' }
        }
        const capabilities = {
          supportsRecall: false,
          supportsPayment: false,
          canSend: false,
          hasGroupNicknames: false,
          supportsRealtime: false,
          supportsLazyAssets: false
        }
        const snapshot = {
          source: 'telegram',
          accountId,
          context,
          capabilities,
          health: {
            state: 'ready',
            available: true,
            message: 'Telegram macOS 原生版 · 合成本地只读快照'
          }
        }
        const calls = { inspections: 0, connections: 0, messagePages: 0, prohibited: 0 }
        ;(
          globalThis as typeof globalThis & { telegramMacOSTestCalls: typeof calls }
        ).telegramMacOSTestCalls = calls
        const handler = (channel: string, run: (...args: unknown[]) => unknown): void => {
          ipcMain.removeHandler(channel)
          ipcMain.handle(channel, (_event, ...args: unknown[]) => run(...args))
        }
        handler('source:inspectTelegramMacOS', () => {
          calls.inspections++
          return {
            clientType: 'telegram-macos',
            state: 'detected',
            message: '发现合成原生账号。',
            candidates: [{ id: 'synthetic-candidate', label: '合成原生账号' }]
          }
        })
        handler('source:connectTelegramMacOS', (candidate) => {
          if (candidate !== 'synthetic-candidate') throw new Error('Unexpected synthetic candidate')
          calls.connections++
          return { accountId, accountLabel: '合成原生账号', conversationCount: 1, messageCount: 0 }
        })
        handler('entity:getProviderSnapshot', () => snapshot)
        handler('entity:listConversations', () => ({
          items: [
            {
              id: conversationId,
              kind: 'conversation',
              accountId,
              nativeRef: { source: 'telegram', account, native: 'chat/1' },
              conversationKind: 'unknown',
              title: '合成原生会话'
            }
          ]
        }))
        handler('entity:listMessages', (raw) => {
          const query = raw as {
            context?: { expected: { sessionId: string } }
            cursor?: string
            limit?: number
            conversationId?: string
          }
          if (
            query.context?.expected.sessionId !== context.sessionId ||
            query.conversationId !== conversationId ||
            query.limit !== 50
          )
            throw new Error('Unexpected synthetic page context')
          if (query.cursor && query.cursor !== 'synthetic-next')
            throw new Error('Unexpected synthetic cursor')
          calls.messagePages++
          const native = query.cursor ? 'message/earlier' : 'message/latest'
          return {
            items: [
              {
                id: id(native),
                kind: 'message',
                accountId,
                conversationId,
                nativeRef: { source: 'telegram', account, native },
                direction: 'incoming',
                senderId: id('author/1001'),
                sentAt: Date.UTC(2026, 0, 1, 12, query.cursor ? 0 : 1),
                content: {
                  type: 'text',
                  text: query.cursor
                    ? '合成较早消息，仅在点击分页后读取。'
                    : '合成原生消息，这是只读本地快照。'
                },
                extensions: query.cursor
                  ? undefined
                  : {
                      telegramMacOS: {
                        mediaCount: 2,
                        mediaAvailable: false,
                        media: [
                          {
                            kind: 'file',
                            filename: 'synthetic-report.pdf',
                            mimeType: 'application/pdf',
                            byteLength: 4096,
                            metadataState: 'decoded'
                          },
                          {
                            kind: 'voice',
                            mimeType: 'audio/ogg',
                            byteLength: 2048,
                            durationSeconds: 12.5,
                            metadataState: 'decoded'
                          }
                        ]
                      }
                    }
              }
            ],
            nextCursor: query.cursor ? undefined : 'synthetic-next'
          }
        })
        for (const channel of [
          'source:connectTelegramLocal',
          'source:loadTelegramHistory',
          'source:startTelegramHistoryQueue',
          'source:loadTelegramMedia',
          'entity:sendMessage'
        ]) {
          handler(channel, () => {
            calls.prohibited++
            throw new Error('Desktop action must not run for native Telegram')
          })
        }
      })
      if (mode === 'disconnected') {
        await page.getByRole('button', { name: '配置 Telegram' }).click()
      } else {
        const welcome = page.getByRole('dialog', { name: '开始探索你的微信' })
        await expect(page.getByRole('button', { name: /切换数据源，当前/ })).toBeVisible()
        if (await welcome.isVisible()) await welcome.getByRole('button', { name: '关闭' }).click()
        await page.getByRole('button', { name: /切换数据源，当前/ }).click()
        await page.getByRole('menuitem', { name: '添加数据源…' }).click()
      }
      const dialog = page.getByRole('dialog', { name: '添加数据源' })
      await expect(
        dialog.getByRole('button', { name: 'Telegram（macOS 原生版）' })
      ).toHaveAttribute('aria-pressed', 'true')
      await expect(dialog.getByText(/连接 macOS 原生 Telegram/)).toContainText('媒体播放尚未接通')
      await dialog.getByRole('button', { name: '检测本机 Telegram' }).click()
      await expect(dialog.getByText('合成原生账号', { exact: true })).toBeVisible()
      await page.screenshot({
        path: test.info().outputPath('telegram-macos-discovery.png'),
        animations: 'disabled'
      })
      await dialog.getByRole('button', { name: '只读连接此账号' }).click()
      await expect(dialog).toHaveCount(0)
      const workspace = page.getByTestId('telegram-read-workspace')
      await expect(workspace.getByText(/合成原生消息，这是只读本地快照/)).toBeVisible()
      await expect(workspace.getByText(/含 2 个附件/)).toBeVisible()
      await expect(workspace.getByText('用户 1001', { exact: true })).toBeVisible()
      await expect(workspace.getByRole('button', { name: /^会话/ })).toBeVisible()
      await expect(workspace.getByRole('button', { name: /^群聊|^联系人/ })).toHaveCount(0)
      await expect(workspace.getByText(/合成原生消息，这是只读本地快照/)).toContainText(
        '文件 · synthetic-report.pdf · application/pdf · 4 KiB'
      )
      await expect(workspace.getByText(/合成原生消息，这是只读本地快照/)).toContainText(
        '语音 · audio/ogg · 2 KiB · 12.5 秒'
      )
      await expect(workspace.getByText('合成较早消息，仅在点击分页后读取。')).toHaveCount(0)
      await expect(
        workspace.getByRole('button', { name: /发送|补载|下载|在 Telegram 中加载/ })
      ).toHaveCount(0)
      await expect(page.getByRole('button', { name: /切换数据源，当前：Telegram/ })).toContainText(
        '合成原生账号'
      )
      await workspace.getByRole('button', { name: '加载更早的本地消息' }).click()
      await expect(workspace.getByText('合成较早消息，仅在点击分页后读取。')).toBeVisible()
      await expect(workspace.locator('.message-sender-name')).toHaveText(['用户 1001'])
      await expect(workspace.getByText(/telegram:synthetic-native-account:/)).toHaveCount(0)
      await expect(workspace.getByRole('button', { name: '加载更早的本地消息' })).toHaveCount(0)
      expect(
        await fixture.app.evaluate(
          () =>
            (globalThis as typeof globalThis & { telegramMacOSTestCalls: unknown })
              .telegramMacOSTestCalls
        )
      ).toEqual({ inspections: 1, connections: 1, messagePages: 2, prohibited: 0 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      )
      await page.screenshot({
        path: test.info().outputPath('telegram-macos-workspace.png'),
        animations: 'disabled'
      })
    } finally {
      await fixture.close()
    }
  })
}
