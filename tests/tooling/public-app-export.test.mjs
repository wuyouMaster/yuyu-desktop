import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { auditPublicExport, exportPublicApp } from '../../scripts/public-app-export.mjs'

async function fixture(t, files) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'fixture-public-export-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const source = path.join(directory, 'source')
  await fs.mkdir(source)
  const manifest = { schemaVersion: 1, reviewComplete: true, unresolved: [], files: [] }
  for (const [name, value] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(source, name)), { recursive: true })
    await fs.writeFile(path.join(source, name), value)
    manifest.files.push({ path: name, sha256: createHash('sha256').update(value).digest('hex') })
  }
  return { source, destination: path.join(directory, 'export'), manifest }
}

test('exports only exact approved text files, with no source history or unknown files', async (t) => {
  const { source, destination, manifest } = await fixture(t, {
    'src/main.ts': "import { version } from './protocol'; export { version }\n",
    'src/protocol.ts': 'export const version = 1\n'
  })
  await fs.mkdir(path.join(source, '.git'))
  await fs.writeFile(path.join(source, 'unreviewed.txt'), 'private')
  assert.deepEqual(await exportPublicApp(source, destination, manifest), { files: 2 })
  assert.deepEqual(await fs.readdir(destination), ['src'])
  assert.equal(
    await fs.readFile(path.join(destination, 'src/protocol.ts'), 'utf8'),
    'export const version = 1\n'
  )
  await assert.rejects(exportPublicApp(source, destination, manifest), /already exists/)
})

test('refuses incomplete review, content drift and imports of omitted implementation', async (t) => {
  const { source, manifest } = await fixture(t, {
    'entry.ts': "import './private-implementation'\n"
  })
  await assert.rejects(
    auditPublicExport(source, { ...manifest, reviewComplete: false }),
    /incomplete/
  )
  await assert.rejects(auditPublicExport(source, manifest), /Unclosed public dependency/)
  await fs.writeFile(path.join(source, 'entry.ts'), 'export const changed = true\n')
  await assert.rejects(auditPublicExport(source, manifest), /Unreviewed content change/)
})

for (const name of [
  'tools/helper.ts',
  'docs/reverse-engineering/research.md',
  '.git/config',
  'icon.png',
  'report.log',
  '.github/workflows/test.yml'
]) {
  test(`rejects prohibited delivery path ${name}`, async (t) => {
    const { source, manifest } = await fixture(t, { [name]: 'fixture' })
    await assert.rejects(auditPublicExport(source, manifest), /Forbidden public path/)
  })
}

test('rejects native ABI imports, binary disguise, unsafe names and symlinks', async (t) => {
  for (const content of ["import koffi from 'koffi'\n", Buffer.from([0, 255])]) {
    const { source, manifest } = await fixture(t, { 'entry.ts': content })
    await assert.rejects(auditPublicExport(source, manifest))
  }
  const { source, manifest } = await fixture(t, { 'entry.ts': 'export {}\n' })
  await fs.rename(path.join(source, 'entry.ts'), path.join(source, 'real.ts'))
  await fs.symlink('real.ts', path.join(source, 'entry.ts'))
  await assert.rejects(auditPublicExport(source, manifest), /Symlink/)
  manifest.files[0].path = '../escape.ts'
  await assert.rejects(auditPublicExport(source, manifest), /Forbidden/)
})

test('rejects embedded native patches and private ciphertext implementations', async (t) => {
  for (const value of [
    'Memory.alloc(32)',
    'new NativeFunction(address)',
    'createDecipheriv(key)'
  ]) {
    const { source, manifest } = await fixture(t, { 'src/private.ts': value })
    await assert.rejects(auditPublicExport(source, manifest), /Private implementation/)
  }
})
