import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
// electron-builder invokes bare pnpm; isolate Corepack shims so a global pnpm 10
// cannot silently read the pnpm 7 lockfile as an empty dependency tree.
const shims = mkdtempSync(join(tmpdir(), 'yuyu-build-tools-'))
try {
  const windows = process.platform === 'win32'
  execFileSync(windows ? 'corepack.cmd' : 'corepack', ['enable', '--install-directory', shims], {
    stdio: 'inherit',
    shell: windows
  })
  const env = { ...process.env, PATH: shims + delimiter + (process.env.PATH || '') }
  const version = execFileSync(windows ? 'pnpm.cmd' : 'pnpm', ['--version'], {
    env,
    encoding: 'utf8',
    shell: windows
  }).trim()
  if (version !== '7.33.7') throw new Error('Packaging requires pnpm 7.33.7')
  execFileSync(
    process.execPath,
    [
      require.resolve('electron-builder/cli.js'),
      '--config',
      'electron-builder.yml',
      '--dir',
      '--publish',
      'never'
    ],
    { env, stdio: 'inherit' }
  )
} finally {
  rmSync(shims, { recursive: true, force: true })
}
