import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Electron-vite exits with its Electron child's exit code. A runtime-requested
// restart must restart the dev server too, before the replacement window opens.
const RESTART_EXIT_CODE = 75
const entry = fileURLToPath(
  new URL('../node_modules/electron-vite/bin/electron-vite.js', import.meta.url)
)
let child
let stopping = false
function launch() {
  child = spawn(process.execPath, [entry, 'dev', '--watch', ...process.argv.slice(2)], {
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    env: { ...process.env, YUYU_MANAGED_RUNTIMES: '1', YUYU_DEV_SUPERVISED: '1' }
  })
  child.once('error', (error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  child.once('exit', (code) => {
    if (!stopping && code === RESTART_EXIT_CODE) launch()
    else process.exitCode = code ?? 0
  })
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true
    if (!child?.pid) return
    try {
      if (process.platform === 'win32') child.kill(signal)
      else process.kill(-child.pid, signal)
    } catch {
      /* Child may have completed its shutdown already. */
    }
  })
}
launch()
