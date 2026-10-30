import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.worker.json'], { cwd: root, stdio: 'inherit' })
const output = new URL('../out/worker/', import.meta.url)
mkdirSync(output, { recursive: true })
writeFileSync(new URL('package.json', output), JSON.stringify({type: 'commonjs'})+'\n')
