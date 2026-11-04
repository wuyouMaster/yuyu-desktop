import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const target = process.platform === 'darwin' && process.arch === 'arm64'
  ? 'mac-arm64'
  : process.platform === 'win32' && process.arch === 'x64'
    ? 'win-x64'
    : undefined
if (!target) throw new Error('Release candidates require macOS arm64 or Windows x64')
const output = resolve(process.argv[2] || 'dist/release-candidate')
if (existsSync(output)) throw new Error('Release candidate output already exists; use a new directory')
const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
if (status.trim()) throw new Error('Release candidates require a clean, committed checkout')

// electron-builder invokes bare pnpm. Isolate the repository's Corepack shim
// so global pnpm cannot silently misread the lockfile or omit dependencies.
const shims = mkdtempSync(join(tmpdir(), 'yuyu-release-tools-'))
try {
  const windows = process.platform === 'win32'
  execFileSync(windows ? 'corepack.cmd' : 'corepack', ['enable', '--install-directory', shims], {
    stdio: 'inherit', shell: windows
  })
  const env = { ...process.env, PATH: shims + delimiter + (process.env.PATH || '') }
  delete env.GH_TOKEN
  delete env.GITHUB_TOKEN
  const version = execFileSync(windows ? 'pnpm.cmd' : 'pnpm', ['--version'], {
    env, encoding: 'utf8', shell: windows
  }).trim()
  if (version !== '7.33.7') throw new Error('Release packaging requires pnpm 7.33.7')
  execFileSync(process.execPath, [
    require.resolve('electron-builder/cli.js'), '--config', 'electron-builder.release.yml',
    ...(target === 'mac-arm64' ? ['--mac', 'dmg', 'zip', '--arm64'] : ['--win', 'nsis', '--x64']),
    '--publish', 'never', '--config.directories.output=' + output
  ], { env, stdio: 'inherit' })
  execFileSync(process.execPath, ['scripts/release-artifacts.mjs', 'prepare', target, output], {
    env, stdio: 'inherit'
  })
} finally {
  rmSync(shims, { recursive: true, force: true })
}
