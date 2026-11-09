import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('stable tags require the fixed version and exact event commit', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'synthetic-stable-tag-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  copyFileSync(resolve('scripts/check-stable-release-tag.mjs'), join(root, 'scripts/check-stable-release-tag.mjs'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }))
  execFileSync('git', ['init', '-q', root])
  execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'])
  const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const run = (env) => spawnSync(process.execPath, [join(root, 'scripts/check-stable-release-tag.mjs')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.0.0', GITHUB_SHA: head, ...env }
  })
  assert.equal(run({}).status, 0)
  assert.notEqual(run({ GITHUB_REF_NAME: 'v1.0.0-rc.1' }).status, 0)
  assert.notEqual(run({ GITHUB_REF_TYPE: 'branch' }).status, 0)
  assert.notEqual(run({ GITHUB_SHA: '0'.repeat(40) }).status, 0)
})

test('stable draft rejects wrong repository before invoking Git or GitHub', () => {
  const result = spawnSync(process.execPath, ['scripts/create-stable-draft.mjs'], {
    cwd: process.cwd(), encoding: 'utf8',
    env: { ...process.env, GITHUB_REPOSITORY: 'fixture/incorrect', GITHUB_REF_NAME: 'v1.0.0', GH_TOKEN: 'fixture' }
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Expected public application repository/)
})

test('stable workflow builds only macOS and creates a draft while preview excludes stable tags', () => {
  const require = createRequire(import.meta.url)
  const yaml = require(require.resolve('js-yaml', { paths: [require.resolve('electron-builder')] }))
  const stable = yaml.load(readFileSync('.github/workflows/stable-release-draft.yml', 'utf8'))
  const preview = yaml.load(readFileSync('.github/workflows/release-draft.yml', 'utf8'))
  assert.deepEqual(stable.on.push.tags, ['v1.0.0'])
  assert.equal(stable.jobs.build['runs-on'], 'macos-15')
  assert.ok(stable.jobs.build.steps.some((step) => step.run === 'corepack pnpm build:stable:candidate --unsigned'))
  assert.ok(stable.jobs.draft.steps.some((step) => step.run === 'node scripts/create-stable-draft.mjs'))
  assert.equal(preview.jobs.build.if, "contains(github.ref_name, '-')")
  assert.equal(preview.jobs.draft.if, "contains(github.ref_name, '-')")
})
