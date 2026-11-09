import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { isDeveloperIdSignature } from './stable-release-preflight.mjs'

// Signing and experimental-runtime exceptions are separate explicit choices.
const args = process.argv.slice(2)
const flags = args.filter((arg) => arg.startsWith('--'))
const unsigned = flags.includes('--unsigned')
const remaining = args.filter((arg) => !arg.startsWith('--'))
if (remaining.length > 1 || new Set(flags).size !== flags.length ||
    flags.some((flag) => !['--unsigned', '--allow-experimental-runtimes'].includes(flag)))
  throw new Error('Usage: build-stable-candidate.mjs [--unsigned] [--allow-experimental-runtimes] [output-directory]')
execFileSync(process.execPath, ['scripts/stable-release-preflight.mjs', ...flags], { stdio: 'inherit' })
const output = resolve(remaining[0] || 'dist/stable-candidate')
if (existsSync(output)) throw new Error('Stable candidate output already exists; use a new directory')
const require = createRequire(import.meta.url)
const shims = mkdtempSync(join(tmpdir(), 'yuyu-stable-tools-'))
try {
  execFileSync('corepack', ['enable', '--install-directory', shims], { stdio: 'inherit' })
  const env = { ...process.env, PATH: shims + delimiter + (process.env.PATH || ''), CSC_IDENTITY_AUTO_DISCOVERY: unsigned ? 'false' : 'true' }
  // Use only the reviewed local keychain identity and notarytool profile.
  // Electron-builder v26 otherwise prioritizes Apple ID/API env credentials.
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_NAME',
    'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_API_KEY',
    'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) delete env[key]
  if (unsigned) delete env.APPLE_KEYCHAIN_PROFILE
  if (execFileSync('pnpm', ['--version'], { env, encoding: 'utf8' }).trim() !== '7.33.7')
    throw new Error('Stable packaging requires pnpm 7.33.7')
  execFileSync('pnpm', ['build'], { env, stdio: 'inherit' })
  execFileSync(process.execPath, [require.resolve('electron-builder/cli.js'),
    '--config', unsigned ? 'electron-builder.release.yml' : 'electron-builder.stable.yml', '--mac', 'dmg', 'zip', '--arm64',
    '--publish', 'never', '--config.directories.output=' + output], { env, stdio: 'inherit' })
  const app = join(output, 'mac-arm64', '语屿 YUYU.app')
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  if (!unsigned) {
    const details = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', app], { encoding: 'utf8' })
    if (!isDeveloperIdSignature(details.status, details.stderr))
      throw new Error('Stable candidate is not signed with a Developer ID Application identity')
    execFileSync('/usr/bin/xcrun', ['stapler', 'validate', app], { stdio: 'inherit' })
  }
  execFileSync(process.execPath, ['scripts/release-artifacts.mjs', 'prepare', 'mac-arm64', output], { env, stdio: 'inherit' })
  console.log(`${unsigned ? 'Unsigned stable' : 'Stable'} candidate prepared locally; installation and real-account acceptance are still required`)
} finally {
  rmSync(shims, { recursive: true, force: true })
}
