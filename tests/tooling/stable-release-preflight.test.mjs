import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checkStableReadiness, isDeveloperIdSignature } from '../../scripts/stable-release-preflight.mjs'

const valid = () => ({
  platform: 'darwin', arch: 'arm64', version: '1.0.0', clean: true,
  identityOutput: '  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Developer ID Application: Synthetic (1234567890)"',
  profile: 'synthetic-profile',
  packages: ['wechat', 'dingtalk', 'telegram'].map((application) => ({
    application, target: 'darwin-arm64', releaseStatus: 'stable', version: '1.0.0'
  }))
})

test('accepts a complete synthetic stable preflight without claiming acceptance', () => {
  assert.deepEqual(checkStableReadiness(valid()), [])
})

test('reports all missing prerequisites and rejects preview, duplicate, and wrong-target runtimes', () => {
  const input = valid()
  input.platform = 'win32'; input.version = '0.0.0-migration.6'; input.clean = false
  input.identityOutput = '0 valid identities found'; input.profile = ''
  input.packages[0].releaseStatus = 'development-only'
  input.packages[1].version = '1.0.0-rc.1'
  input.packages.push({ ...input.packages[2] })
  const issues = checkStableReadiness(input)
  assert.equal(issues.length, 8)
  for (const application of ['wechat', 'dingtalk', 'telegram'])
    assert.ok(issues.some((issue) => issue.startsWith(application)))
  input.packages = valid().packages.map((item) => ({ ...item, target: 'win-x64' }))
  assert.equal(checkStableReadiness(input).filter((issue) => issue.includes('runtime')).length, 3)
})

test('rejects developer and revoked signing identities', () => {
  const input = valid()
  for (const identityOutput of [
    '  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Apple Development: Synthetic"',
    '  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Developer ID Application: Synthetic" (CSSMERR_TP_CERT_REVOKED)'
  ]) {
    input.identityOutput = identityOutput
    assert.ok(checkStableReadiness(input).some((issue) => issue.includes('signing identity')))
  }
})

test('unsigned mode waives only identity and notarization profile requirements', () => {
  const input = valid()
  input.identityOutput = ''; input.profile = ''; input.unsigned = true
  assert.deepEqual(checkStableReadiness(input), [])
  input.packages[0].releaseStatus = 'development-only'
  input.version = '0.0.0-migration.10'
  input.clean = false
  assert.deepEqual(checkStableReadiness(input), [
    'package version must be 1.0.0',
    'checkout must be clean and committed',
    'wechat requires exactly one stable macOS arm64 runtime'
  ])
  input.unsigned = false
  assert.ok(checkStableReadiness(input).some((issue) => issue.includes('signing identity')))
  assert.ok(checkStableReadiness(input).some((issue) => issue.includes('APPLE_KEYCHAIN_PROFILE')))
})

test('experimental runtimes require an explicit choice and keep their original catalog status', () => {
  const input = valid()
  input.packages = input.packages.map((runtime) => ({ ...runtime, releaseStatus: 'development-only', version: '0.1.0-dev.5' }))
  const before = JSON.stringify(input.packages)
  assert.equal(checkStableReadiness(input).length, 3)
  input.allowExperimentalRuntimes = true
  assert.deepEqual(checkStableReadiness(input), [])
  assert.equal(JSON.stringify(input.packages), before)
  input.identityOutput = ''; input.profile = ''
  assert.equal(checkStableReadiness(input).length, 2)
  input.unsigned = true
  assert.deepEqual(checkStableReadiness(input), [])
})

test('experimental mode still rejects missing, duplicated, mismatched and malformed runtimes', () => {
  const input = { ...valid(), unsigned: true, allowExperimentalRuntimes: true }
  for (const runtime of [
    { releaseStatus: 'unknown', version: '0.1.0-dev.5' },
    { releaseStatus: 'stable', version: '0.1.0-dev.5' },
    { releaseStatus: 'development-only', version: '1.0.0' },
    { releaseStatus: 'development-only', version: '0.1.0-dev.05' },
    { releaseStatus: 'development-only', version: '0.1.0-dev.5/unsafe' },
    { releaseStatus: 'development-only', version: '0.1.0-' }
  ]) {
    input.packages = valid().packages
    Object.assign(input.packages[0], runtime)
    assert.equal(checkStableReadiness(input).length, 1, JSON.stringify(runtime))
  }
  for (const packages of [[], [...valid().packages, valid().packages[0]], valid().packages.map((p) => ({ ...p, target: 'win-x64' }))]) {
    assert.ok(checkStableReadiness({ ...input, packages }).some((issue) => issue.includes('runtime')))
  }
  assert.deepEqual(checkStableReadiness({ ...input, packages: valid().packages, version: '1.0.0-rc.1', clean: false, arch: 'x64' }), [
    'stable candidate requires macOS arm64', 'package version must be 1.0.0', 'checkout must be clean and committed'
  ])
})

test('requires a Developer ID authority and a team identifier on the built application', () => {
  const details = 'Authority=Developer ID Application: Synthetic (1234567890)\nTeamIdentifier=1234567890\n'
  assert.equal(isDeveloperIdSignature(0, details), true)
  assert.equal(isDeveloperIdSignature(1, details), false)
  assert.equal(isDeveloperIdSignature(0, 'Signature=adhoc\nTeamIdentifier=not set\n'), false)
  assert.equal(isDeveloperIdSignature(0, details.replace('1234567890\n', 'not set\n')), false)
})

test('merged stable configuration requires distribution signing and notarization', async () => {
  const require = createRequire(import.meta.url)
  const { getConfig } = require(require.resolve('app-builder-lib/out/util/config/config', {
    paths: [require.resolve('electron-builder')]
  }))
  const config = await getConfig(process.cwd(), 'electron-builder.stable.yml', null)
  assert.equal(config.forceCodeSigning, true)
  assert.equal(config.mac.identity, '')
  assert.equal(config.mac.type, 'distribution')
  assert.equal(config.mac.hardenedRuntime, true)
  assert.equal(config.mac.notarize, true)
  const unsignedConfig = await getConfig(process.cwd(), 'electron-builder.release.yml', null)
  assert.equal(unsignedConfig.mac.identity, null)
  assert.equal(unsignedConfig.mac.notarize, false)
})

test('stable build stops before generating output when preflight fails', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'synthetic-stable-release-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  for (const name of ['build-stable-candidate.mjs', 'stable-release-preflight.mjs'])
    copyFileSync(resolve('scripts', name), join(root, 'scripts', name))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.0.0-migration.6' }))
  writeFileSync(join(root, 'runtime.lock.json'), JSON.stringify({ packages: [] }))
  execFileSync('git', ['init', '-q', root])
  const output = join(root, 'candidate')
  const result = spawnSync(process.execPath, [join(root, 'scripts/build-stable-candidate.mjs'), output], {
    cwd: root, encoding: 'utf8', env: { ...process.env, APPLE_KEYCHAIN_PROFILE: '' }
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Stable release preflight failed/)
  assert.equal(existsSync(output), false)
  const unsigned = spawnSync(process.execPath, [join(root, 'scripts/build-stable-candidate.mjs'), '--unsigned', output], {
    cwd: root, encoding: 'utf8', env: { ...process.env, APPLE_KEYCHAIN_PROFILE: '' }
  })
  assert.notEqual(unsigned.status, 0)
  assert.match(unsigned.stderr, /wechat requires exactly one stable macOS arm64 runtime/)
  assert.match(unsigned.stderr, /package version must be 1\.0\.0/)
  assert.equal(existsSync(output), false)
  const experimental = spawnSync(process.execPath, [join(root, 'scripts/build-stable-candidate.mjs'), '--unsigned', '--allow-experimental-runtimes', output], {
    cwd: root, encoding: 'utf8'
  })
  assert.notEqual(experimental.status, 0)
  assert.match(experimental.stderr, /wechat requires exactly one stable or explicitly experimental macOS arm64 runtime/)
  assert.match(experimental.stderr, /package version must be 1\.0\.0/)
  assert.equal(existsSync(output), false)
  for (const script of ['build-stable-candidate.mjs', 'stable-release-preflight.mjs']) {
    for (const flags of [['--allow-experimental-runtime'], ['--unsigned', '--unsigned'], ['--allow-experimental-runtimes', '--allow-experimental-runtimes']]) {
      const invalid = spawnSync(process.execPath, [join(root, 'scripts', script), ...flags], { cwd: root, encoding: 'utf8' })
      assert.notEqual(invalid.status, 0)
      assert.match(invalid.stderr, /Usage:/)
    }
  }
})
