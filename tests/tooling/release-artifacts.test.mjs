import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const checker = resolve('scripts/release-artifacts.mjs')
const tagChecker = resolve('scripts/check-release-tag.mjs')
const digest = (data) => createHash('sha512').update(data).digest('base64')

function fixture(t, target) {
  const root = mkdtempSync(join(tmpdir(), 'synthetic-release-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q', root])
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.1.0-preview.1' }))
  writeFileSync(join(root, 'runtime.lock.json'), '{\n  "packages": []\n}\n')
  execFileSync('git', ['-C', root, 'add', 'package.json', 'runtime.lock.json'])
  execFileSync('git', ['-C', root, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'])
  const directory = join(root, 'candidate')
  mkdirSync(directory)
  const primary = target === 'mac-arm64' ? 'yuyu-desktop-0.1.0-preview.1-arm64.zip' : 'yuyu-desktop-0.1.0-preview.1-x64-setup.exe'
  const binaries = target === 'mac-arm64' ? [primary, 'yuyu-desktop-0.1.0-preview.1-arm64.dmg'] : [primary]
  for (const file of binaries) {
    writeFileSync(join(directory, file), `synthetic-${file}`)
    writeFileSync(join(directory, file + '.blockmap'), 'synthetic-blockmap')
  }
  const fields = binaries.map((file) => {
    const data = readFileSync(join(directory, file))
    return `  - url: ${file}\n    sha512: ${digest(data)}\n    size: ${data.length}\n`
  }).join('')
  const update = `version: 0.1.0-preview.1\nfiles:\n${fields}path: ${primary}\nsha512: ${digest(readFileSync(join(directory, primary)))}\n`
  writeFileSync(join(directory, target === 'mac-arm64' ? 'latest-mac.yml' : 'latest.yml'), update)
  const run = (action) => spawnSync(process.execPath, [checker, action, target, directory], { cwd: root, encoding: 'utf8' })
  return { root, directory, primary, run }
}

for (const target of ['mac-arm64', 'win-x64']) {
  test(`${target} verifies artifact bytes, metadata and source identity`, (t) => {
    const f = fixture(t, target)
    assert.equal(f.run('prepare').status, 0)
    assert.equal(f.run('check').status, 0)
    writeFileSync(join(f.directory, f.primary + '.blockmap'), 'modified-blockmap')
    assert.notEqual(f.run('check').status, 0)
  })
  test(`${target} rejects changed binary before preparing a manifest`, (t) => {
    const f = fixture(t, target)
    writeFileSync(join(f.directory, f.primary), 'tampered')
    assert.notEqual(f.run('prepare').status, 0)
  })
}

test('release tag must match both the package version and event commit', (t) => {
  const f = fixture(t, 'mac-arm64')
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.root, encoding: 'utf8' }).trim()
  const env = { ...process.env, GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.1.0-preview.1', GITHUB_SHA: head }
  const run = (overrides) => spawnSync(process.execPath, [tagChecker], {
    cwd: f.root, env: { ...env, ...overrides }, encoding: 'utf8'
  })
  assert.equal(run({}).status, 0)
  assert.notEqual(run({ GITHUB_REF_NAME: 'v0.1.0-preview.2' }).status, 0)
  assert.notEqual(run({ GITHUB_REF_TYPE: 'branch' }).status, 0)
  assert.notEqual(run({ GITHUB_SHA: '0'.repeat(40) }).status, 0)
})

test('development-preview workflow rejects a matching stable tag', (t) => {
  const f = fixture(t, 'mac-arm64')
  writeFileSync(join(f.root, 'package.json'), JSON.stringify({ version: '1.0.0' }))
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.root, encoding: 'utf8' }).trim()
  const result = spawnSync(process.execPath, [tagChecker], {
    cwd: f.root,
    env: { ...process.env, GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.0.0', GITHUB_SHA: head },
    encoding: 'utf8'
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Stable tags cannot use the development-preview release workflow/)
})

test('runtime lock source hash is stable across LF and CRLF checkouts', (t) => {
  const f = fixture(t, 'win-x64')
  const lock = join(f.root, 'runtime.lock.json')
  writeFileSync(lock, readFileSync(lock, 'utf8').replaceAll('\n', '\r\n'))
  assert.equal(f.run('prepare').status, 0)
  writeFileSync(lock, readFileSync(lock, 'utf8').replaceAll('\r\n', '\n'))
  assert.equal(f.run('check').status, 0)
})
