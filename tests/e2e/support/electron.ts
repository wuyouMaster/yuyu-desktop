import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { loadEnv } from 'vite'

const DEFAULT_WINDOW_CLOSE_DELAY_MS = 2000
const FIXTURE_TIMEZONE = 'Asia/Shanghai'

export interface TestApplication {
  app: ElectronApplication
  page: Page
  userData: string
  close: () => Promise<void>
}

export async function launchTestApp(
  options: {
    mode?: 'connected' | 'disconnected'
    /** 让模板市场 IPC 返回确定性的合成目录，供社区模板市场页视觉/行为用例使用。 */
    templateMarket?: 'off' | 'fixture'
    userData?: string
    largeContacts?: number
    corruptCache?: boolean
    selfOnlyBootstrapCache?: boolean
    missingImageKey?: boolean
    historyMessages?: number
    aiFailure?: string
    updateSimulation?: boolean
    unsignedMacUpdate?: boolean
    realtimeReorder?: boolean
    now?: number
    appearanceTheme?: 'light' | 'dark'
    stableUserData?: string
    macScrollbars?: 'WhenScrolling' | 'Always'
  } = {}
): Promise<TestApplication> {
  const ownsDirectory = !options.userData || Boolean(options.stableUserData)
  const userData =
    options.userData ||
    (options.stableUserData
      ? resolve(options.stableUserData)
      : mkdtempSync(resolve(tmpdir(), 'yuyu-e2e-')))
  if (options.stableUserData) rmSync(userData, { recursive: true, force: true })
  const localTestEnv = loadEnv('test', process.cwd(), 'YUYU_E2E_')
  const configuredCloseDelay = Number(
    process.env.YUYU_E2E_CLOSE_DELAY_MS ?? localTestEnv.YUYU_E2E_CLOSE_DELAY_MS
  )
  const closeDelayMs = Number.isFinite(configuredCloseDelay)
    ? Math.max(0, configuredCloseDelay)
    : DEFAULT_WINDOW_CLOSE_DELAY_MS
  const app = await electron.launch({
    args: [
      resolve('tests/e2e/support/electron-main.cjs'),
      // NSArgumentDomain is process-local: do not persist or change the host's preferences.
      ...(process.platform === 'darwin'
        ? [
            // Baselines were rendered on a Retina display. Set raster density before the
            // first renderer starts; the CSS viewport override below alone is too late.
            '--force-device-scale-factor=2',
            '-AppleShowScrollBars',
            options.macScrollbars ?? 'WhenScrolling'
          ]
        : [])
    ],
    timezoneId: FIXTURE_TIMEZONE,
    env: {
      ...process.env,
      TZ: FIXTURE_TIMEZONE,
      YUYU_E2E_USER_DATA: userData,
      YUYU_E2E_MODE: options.mode || 'connected',
      YUYU_E2E_LARGE_CONTACTS: String(options.largeContacts || 0),
      YUYU_E2E_CORRUPT_CACHE: options.corruptCache ? '1' : '0',
      YUYU_E2E_SELF_ONLY_BOOTSTRAP_CACHE: options.selfOnlyBootstrapCache ? '1' : '0',
      YUYU_E2E_MISSING_IMAGE_KEY: options.missingImageKey ? '1' : '0',
      YUYU_E2E_HISTORY_MESSAGES: String(options.historyMessages || 0),
      YUYU_E2E_AI_FAILURE: options.aiFailure || '',
      YUYU_E2E_UPDATE_SIMULATION: options.updateSimulation ? '1' : '0',
      YUYU_E2E_UNSIGNED_MAC_UPDATE: options.unsignedMacUpdate ? '1' : '0',
      YUYU_E2E_REALTIME_REORDER: options.realtimeReorder ? '1' : '0',
      YUYU_E2E_NOW_MS: options.now ? String(options.now) : '',
      YUYU_E2E_APPEARANCE_THEME: options.appearanceTheme || 'light',
      YUYU_E2E_TEMPLATE_MARKET: options.templateMarket || 'off'
    }
  })
  const page = await app.firstWindow()
  // Native window sizes are clamped by small CI displays; keep the renderer at baseline size.
  await page.setViewportSize({ width: 1400, height: 768 })
  await page.waitForLoadState('domcontentloaded')
  if (options.now) await page.clock.setFixedTime(options.now)
  return {
    app,
    page,
    userData,
    close: async () => {
      if (!page.isClosed() && closeDelayMs > 0) await page.waitForTimeout(closeDelayMs)
      await app.close().catch(() => undefined)
      if (ownsDirectory) rmSync(userData, { recursive: true, force: true })
    }
  }
}
