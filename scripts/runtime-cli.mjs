import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installRuntime, readActive, selectRuntime, verifyRuntime } from './runtime-store.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const catalog = JSON.parse(await readFile(path.join(root, 'runtime.lock.json'), 'utf8'))
const args = process.argv.slice(2)
const option = (name) => {
  const i = args.indexOf(name)
  return i < 0 ? undefined : args[i + 1]
}
const home = path.resolve(
  option('--home') || process.env.YUYU_RUNTIME_HOME || path.join(root, '.runtime')
)
const target = process.platform + '-' + process.arch
try {
  if (args[0] === 'install') {
    const item = selectRuntime(catalog, option('--application'), option('--version'), target)
    console.log(
      JSON.stringify(
        await installRuntime({
          home,
          item,
          archive: option('--archive'),
          downloadUrl: option('--url'),
          baseUrl: option('--base-url'),
          token: process.env.YUYU_RUNTIME_TOKEN,
          allowLoopback: args.includes('--allow-loopback')
        })
      )
    )
  } else if (args[0] === 'verify' || args[0] === 'list') {
    const active = await readActive(home)
    for (const item of catalog.packages.filter((p) => p.target === target)) {
      let status = active[item.application]?.sha256 === item.sha256 ? 'installed' : 'not-installed'
      if (status === 'installed' && args[0] === 'verify') {
        await verifyRuntime(home, item)
        status = 'verified'
      }
      console.log(JSON.stringify({ application: item.application, version: item.version, status }))
    }
  } else
    throw new Error(
      'Usage: runtime-cli.mjs list|verify|install --application NAME --version VERSION [--archive ZIP | --url HTTPS_URL]'
    )
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
