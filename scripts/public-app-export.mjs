import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const privatePath =
  /(^|\/)(?:\.git|\.env(?:\..*)?|tools|node_modules|reverse-engineering|test-results|playwright-report|logs?|dist|out)(\/|$)|^services\/wechat-connector\//i
const binaryExtension =
  /\.(?:node|wasm|dylib|dll|exe|a|o|so|png|jpe?g|gif|webp|icns|ico|pdf|zip|tgz|gz|7z|db|sqlite3?|onnx|bin|log)$/i
const forbiddenModule = /^(?:koffi|@koromix\/koffi)(?:\/|$)/
const safe = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  !value.includes('\\') &&
  !value.includes('\0') &&
  !path.posix.isAbsolute(value) &&
  value.split('/').every((part) => part && part !== '.' && part !== '..')
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const fail = (message) => {
  throw new Error(message)
}

/** Exact, reviewed, content-addressed allowlist; unknown files never enter an export. */
export async function auditPublicExport(source, manifest) {
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length ||
    manifest.reviewComplete !== true ||
    manifest.unresolved?.length
  )
    fail('Public boundary review is incomplete')
  const root = await fs.realpath(source)
  const approved = new Map()
  const names = new Set()
  for (const item of manifest.files) {
    if (
      !safe(item.path) ||
      privatePath.test(item.path) ||
      binaryExtension.test(item.path) ||
      item.path.startsWith('.github/workflows/')
    )
      fail(`Forbidden public path: ${item.path}`)
    if (!/^[a-f0-9]{64}$/.test(item.sha256) || names.has(item.path.toLowerCase()))
      fail('Invalid or duplicate allowlist entry')
    names.add(item.path.toLowerCase())
    const file = path.join(root, item.path)
    for (let current = file; current !== root; current = path.dirname(current)) {
      if ((await fs.lstat(current)).isSymbolicLink()) fail(`Symlink in public path: ${item.path}`)
    }
    const stat = await fs.lstat(file)
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      !(await fs.realpath(file)).startsWith(root + path.sep)
    )
      fail('Unsafe public file')
    const bytes = await fs.readFile(file)
    if (digest(bytes) !== item.sha256) fail(`Unreviewed content change: ${item.path}`)
    let text
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      fail(`Non-text public file: ${item.path}`)
    }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))
      fail(`Binary content in public file: ${item.path}`)
    if (
      /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/.test(
        text
      )
    )
      fail(`Credential-like content: ${item.path}`)
    if (/(?:\/Users\/[^/\s]+\/|[A-Z]:\\Users\\[^\\\s]+\\)/.test(text))
      fail(`Local personal path in public file: ${item.path}`)
    if (
      item.path.startsWith('src/') &&
      /(?:Memory\.alloc\s*\(|new NativeFunction\s*\(|Interceptor\.attach\s*\(|createDecipheriv\s*\(|NATIVE_MODULE_TOOL_REGISTRY)/.test(
        text
      )
    )
      fail(`Private implementation in public source: ${item.path}`)
    approved.set(item.path, { bytes, text, mode: stat.mode & 0o111 ? 0o755 : 0o644 })
  }
  for (const [name, { text }] of approved) {
    if (!/\.[cm]?[jt]sx?$/.test(name)) continue
    const imports = ts.preProcessFile(text, true, true).importedFiles
    for (const dependency of imports) {
      const specifier = dependency.fileName
      if (forbiddenModule.test(specifier)) fail(`Native ABI dependency in public source: ${name}`)
      if (!specifier.startsWith('.') && !specifier.startsWith('@renderer/')) continue
      const base = specifier.startsWith('@renderer/')
        ? 'src/renderer/src/' + specifier.slice('@renderer/'.length)
        : path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier))
      const candidates = [
        base,
        ...[
          '.ts',
          '.tsx',
          '.js',
          '.mjs',
          '.cjs',
          '.json',
          '/index.ts',
          '/index.tsx',
          '/index.js'
        ].map((ext) => base + ext)
      ]
      if (!candidates.some((candidate) => approved.has(candidate)))
        fail(`Unclosed public dependency: ${name} -> ${specifier}`)
    }
  }
  return approved
}

/** Never copy .git/history or overwrite a checkout. Caller initializes fresh history after review. */
export async function exportPublicApp(source, destination, manifest) {
  const approved = await auditPublicExport(source, manifest)
  const target = path.resolve(destination)
  try {
    await fs.lstat(target)
    fail('Destination already exists')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const stage = path.join(path.dirname(target), `.public-export-${randomUUID()}`)
  await fs.mkdir(stage, { mode: 0o700 })
  try {
    for (const [name, { bytes, mode }] of approved) {
      const file = path.join(stage, name)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, bytes, { flag: 'wx', mode })
    }
    // mkdir is the exclusive reservation. A racing destination is never overwritten.
    await fs.mkdir(target)
    for (const name of await fs.readdir(stage))
      await fs.rename(path.join(stage, name), path.join(target, name))
  } finally {
    await fs.rm(stage, { recursive: true, force: true })
  }
  return { files: approved.size }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [manifestPath, destination] = process.argv.slice(2)
  if (!manifestPath)
    fail('Usage: node scripts/public-app-export.mjs <reviewed-manifest.json> [new-destination]')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  console.log(
    destination
      ? await exportPublicApp(process.cwd(), destination, manifest)
      : { approvedFiles: (await auditPublicExport(process.cwd(), manifest)).size }
  )
}
