const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { nestedCode, signMacosBundle } = require('../../scripts/sign-macos-bundle.cjs')

test('seals invalid nested code inside out before verifying the app', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic-signing-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const app = path.join(root, 'Fixture.app')
  const framework = path.join(app, 'Contents', 'Frameworks', 'Fixture.framework')
  const executable = path.join(framework, 'Versions', 'A', 'Fixture')
  fs.mkdirSync(path.dirname(executable), { recursive: true })
  fs.writeFileSync(executable, Buffer.from([0xfe, 0xed, 0xfa, 0xcf]))
  fs.symlinkSync('A', path.join(framework, 'Versions', 'Current'))
  assert.deepEqual(nestedCode(app), [executable, framework])

  const valid = new Set(), signed = []
  const run = (args) => {
    const target = args.at(-1)
    if (args.includes('--sign')) {
      assert.equal(args.includes('--deep'), false)
      assert.ok(args.includes('--preserve-metadata=entitlements,flags'))
      signed.push(target)
      valid.add(target)
    } else if (!valid.has(target)) throw new Error('invalid signature')
  }
  signMacosBundle(app, run)
  assert.deepEqual(signed, [executable, framework, app])
  signMacosBundle(app, run)
  assert.equal(signed.length, 3)
})

test('fails packaging when deep verification still fails', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic-signing-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  assert.throws(() => signMacosBundle(root, (args) => {
    if (args.includes('--verify')) throw new Error('invalid signature')
  }), /app bundle signature verification failed/)
})
