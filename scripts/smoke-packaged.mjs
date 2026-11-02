import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, isAbsolute } from 'node:path'
const executable = process.argv[2]
if (!executable || !isAbsolute(executable)) throw new Error('Absolute packaged executable required')
const home = await mkdtemp(join(tmpdir(), 'synthetic-packaged-app-'))
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
  app = await electron.launch({ executablePath: executable, args: [], env, timeout: 30000 })
  app.process().stderr.on('data', (b) => process.stderr.write(b))
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('button', { name: '暂不连接，进入主界面' })).toBeVisible()
  await page.getByRole('button', { name: '暂不连接，进入主界面' }).click()
  await expect(page.getByRole('heading', { name: '从一个数据源开始' })).toBeVisible()
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
  const update = await page.evaluate(() => window.api.checkAppUpdate())
  expect(update).toMatchObject({ success: false, state: { status: 'unsupported' } })
  const runtime = await page.evaluate(() => window.api.listRuntimeInstallations())
  expect(runtime.some((r) => r.status === 'installed')).toBe(false)
  expect(runtime.find((r) => r.application === 'wechat')).toMatchObject({
    version: '0.1.0-dev.13',
    status: 'not-installed'
  })
  console.log(
    JSON.stringify({
      packaged: identity.packaged,
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
