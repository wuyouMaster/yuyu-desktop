import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, isAbsolute } from 'node:path'
const executable = process.argv[2]
const fresh = process.argv[3] === '--fresh'
const restrictedParent = process.argv[4] === '--restricted-parent'
if (!executable || !isAbsolute(executable)) throw new Error('Absolute packaged executable required')
if (process.argv[3] && !fresh) throw new Error('Expected --fresh or no additional argument')
if (process.argv[4] && (!fresh || !restrictedParent)) throw new Error('Expected --restricted-parent after --fresh')
// macOS cannot nest Chromium's sandbox within the read-deny profile used by
// this synthetic-account test. The outer profile remains the access boundary.
const appArgs = restrictedParent ? ['--no-sandbox'] : []
const home = await mkdtemp(join(tmpdir(), 'synthetic-packaged-app-'))
if (!fresh)
  await writeFile(
    join(home, 'settings.json'),
    JSON.stringify({
      dbRoot: join(home, 'synthetic-account'),
      imageKeyRoot: join(home, 'synthetic-account'),
      autoLogin: false,
      apiEnabled: false
    })
  )
const env = {
  ...process.env,
  YUYU_USER_DATA: home,
  WE_SETTINGS_DIR: home,
  YUYU_RUNTIME_HOME: join(home, 'runtimes')
}
for (const key of [
  'ELECTRON_RENDERER_URL',
  'YUYU_RUNTIME_TEST_CATALOG',
  'YUYU_RUNTIME_TEST_BASE_URL',
  'YUYU_RUNTIME_ALLOW_LOOPBACK',
  'YUYU_RUNTIME_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN'
])
  delete env[key]
let app
try {
  app = await electron.launch({ executablePath: executable, args: appArgs, env, timeout: 30000 })
  app.process().stderr.on('data', (b) => process.stderr.write(b))
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('button', { name: '暂不连接，进入主界面' })).toBeVisible()
  await page.getByRole('button', { name: '暂不连接，进入主界面' }).click()
  await expect(page.getByRole('heading', { name: '从一个数据源开始' })).toBeVisible()
  // The disabled API must not require keychain access before the first window.
  expect(existsSync(join(home, 'local-api-token.bin'))).toBe(false)
  const api = await page.evaluate(async () => ({
    enabled: (await window.api.getSettings()).settings.apiEnabled,
    status: await window.api.apiStatus()
  }))
  expect(api.enabled).toBe(false)
  expect(api.status.running).toBe(false)
  const identity = await app.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    path: app.getAppPath()
  }))
  expect(identity.packaged).toBe(true)
  expect(identity.path.endsWith('app.asar')).toBe(true)
  const skill = await page.evaluate(() => window.api.getReaderSkillStatus())
  expect(skill.available).toBe(true)
  expect(skill.source).toBe('bundled')
  const skillRead = await page.evaluate(() => window.api.readReaderSkill())
  expect(skillRead.success).toBe(true)
  expect(skillRead.content).toContain('# YUYU Reader')
  const network = await app.evaluateHandle(() => {
    const state = { requests: 0 }
    globalThis.fetch = async () => { state.requests += 1; throw new Error('unexpected request') }
    return state
  })
  const market = await page.evaluate(async () => ({
    catalog: await window.api.listReportTemplateCatalog(),
    install: await window.api.installReportTemplateFromCatalog('community.github.fixture.example', '1.0.0')
  }))
  expect(market.catalog).toMatchObject({ success: false, code: 'market_unavailable' })
  expect(market.install).toMatchObject({ success: false, code: 'market_unavailable' })
  expect(await network.evaluate((state) => state.requests)).toBe(0)
  await network.dispose()
  const update = await page.evaluate(() => window.api.checkAppUpdate())
  expect(update).toMatchObject({ success: false, state: { status: 'unsupported' } })
  const runtime = await page.evaluate(() => window.api.listRuntimeInstallations())
  expect(runtime.some((r) => r.status === 'installed')).toBe(false)
  expect(runtime.find((r) => r.application === 'wechat')).toMatchObject({
    version: '0.1.0-dev.13',
    status: 'not-installed'
  })
  if (fresh) {
    await app.close()
    app = undefined
    app = await electron.launch({ executablePath: executable, args: appArgs, env, timeout: 30000 })
    const reopened = await app.firstWindow()
    await reopened.waitForLoadState('domcontentloaded')
    await expect(reopened.getByRole('heading', { name: '从一个数据源开始' })).toBeVisible()
    const afterRestart = await reopened.evaluate(async () => ({
      enabled: (await window.api.getSettings()).settings.apiEnabled,
      status: await window.api.apiStatus()
    }))
    expect(afterRestart.enabled).toBe(false)
    expect(afterRestart.status.running).toBe(false)
    expect(existsSync(join(home, 'local-api-token.bin'))).toBe(false)
  }
  console.log(
    JSON.stringify({
      packaged: identity.packaged,
      freshProfile: fresh,
      restrictedParent,
      archive: true,
      workspace: true,
      readerSkill: true,
      runtimes: runtime.map((r) => ({ application: r.application, status: r.status }))
    })
  )
} finally {
  if (app) {
    let closed = false
    await Promise.race([
      app.close().finally(() => {
        closed = true
      }),
      new Promise((done) => setTimeout(done, 5000))
    ])
    if (!closed) app.process().kill('SIGTERM')
  }
  await rm(home, { recursive: true, force: true })
}
