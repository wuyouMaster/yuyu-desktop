import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const [action, target, directoryArg] = process.argv.slice(2)
if (!['prepare', 'check'].includes(action) || !['mac-arm64', 'win-x64'].includes(target) || !directoryArg)
  throw new Error('Usage: release-artifacts.mjs prepare|check mac-arm64|win-x64 <directory>')
const directory = resolve(directoryArg)
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(version)) throw new Error('Invalid fixed version')
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Invalid source commit')
const lockHash = createHash('sha256').update(readFileSync('runtime.lock.json')).digest('hex')
const prefix = `yuyu-desktop-${version}`
const primary = target === 'mac-arm64' ? `${prefix}-arm64.zip` : `${prefix}-x64-setup.exe`
const binaries = target === 'mac-arm64' ? [primary, `${prefix}-arm64.dmg`] : [primary]
const updateName = target === 'mac-arm64' ? 'latest-mac.yml' : 'latest.yml'
const assets = [updateName, ...binaries, ...binaries.map((file) => `${file}.blockmap`)]
if (action === 'prepare') {
  const yaml = require(require.resolve('js-yaml', { paths: [require.resolve('electron-builder')] }))
  const update = yaml.load(readFileSync(join(directory, updateName), 'utf8'))
  if (!update || update.version !== version || update.path !== primary || !Array.isArray(update.files))
    throw new Error('Update metadata does not identify the expected version and primary artifact')
  if (update.files.length !== binaries.length) throw new Error('Unexpected update metadata file count')
  for (const name of binaries) {
    const entry = update.files.find((item) => item.url === name)
    const data = readFileSync(join(directory, name))
    const sha512 = createHash('sha512').update(data).digest('base64')
    if (!entry || entry.sha512 !== sha512 || entry.size !== data.length || data.length === 0)
      throw new Error('Update metadata size or SHA-512 mismatch: ' + name)
    if (name === primary && update.sha512 !== sha512) throw new Error('Primary update SHA-512 mismatch')
  }
}
const files = assets.map((name) => {
  if (basename(name) !== name) throw new Error('Invalid asset name')
  const file = join(directory, name)
  const stat = statSync(file)
  if (!stat.isFile() || stat.size === 0) throw new Error('Release asset missing or empty: ' + name)
  return { name, size: stat.size, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') }
})
const manifest = { schemaVersion: 1, version, target, sourceCommit, runtimeLockSha256: lockHash, files }
const manifestPath = join(directory, `release-manifest-${target}.json`)
if (action === 'prepare') {
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
} else {
  const actual = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (JSON.stringify(actual) !== JSON.stringify(manifest)) throw new Error('Release manifest mismatch')
}
console.log(JSON.stringify({ version, target, sourceCommit, assets: files.length, status: 'verified' }))
