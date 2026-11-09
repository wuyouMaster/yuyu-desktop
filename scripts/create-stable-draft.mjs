import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const repo = process.env.GITHUB_REPOSITORY
const tag = process.env.GITHUB_REF_NAME
if (repo !== 'wuyouMaster/yuyu-desktop' || tag !== 'v1.0.0' || !process.env.GH_TOKEN)
  throw new Error('Expected public application repository, stable tag and scoped token')
execFileSync(process.execPath, ['scripts/check-stable-release-tag.mjs'], { stdio: 'inherit' })
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const refs = execFileSync('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`], { encoding: 'utf8' }).trim().split('\n')
const peeled = refs.find((line) => line.endsWith(`refs/tags/${tag}^{}`))
const direct = refs.find((line) => line.endsWith(`refs/tags/${tag}`))
if ((peeled || direct || '').split(/\s+/)[0] !== head) throw new Error('Remote stable tag differs from the reviewed commit')
const directory = resolve(process.argv[2] || 'dist/release-upload')
execFileSync(process.execPath, ['scripts/release-artifacts.mjs', 'check', 'mac-arm64', directory], { stdio: 'inherit' })
const manifestName = 'release-manifest-mac-arm64.json'
const manifest = JSON.parse(readFileSync(join(directory, manifestName), 'utf8'))
const names = [...manifest.files.map((item) => item.name), manifestName]
if (new Set(names).size !== names.length || names.some((name) => basename(name) !== name))
  throw new Error('Duplicate or unsafe asset names')
const existing = execFileSync('gh', ['api', '--paginate', `repos/${repo}/releases?per_page=100`, '--jq', '.[].tag_name'], { encoding: 'utf8' })
if (existing.split(/\r?\n/).includes(tag)) throw new Error('Release already exists; inspect it rather than overwrite')
const temp = mkdtempSync(join(tmpdir(), 'yuyu-stable-draft-'))
try {
  const notes = join(temp, 'notes.md')
  writeFileSync(notes, `YUYU 1.0.0 for macOS arm64.\n\nSource commit: ${head}\n\nThis build is not signed with Apple Developer ID and is not notarized. macOS Gatekeeper may block it. Application runtimes are installed separately. Installation, upgrade, real-account compatibility and third-party license obligations require separate acceptance.\n`)
  execFileSync('gh', ['release', 'create', tag, ...names.map((name) => join(directory, name)),
    '--repo', repo, '--verify-tag', '--draft', '--title', 'YUYU 1.0.0', '--notes-file', notes], { stdio: 'inherit' })
  const downloaded = join(temp, 'downloaded')
  execFileSync('gh', ['release', 'download', tag, '--repo', repo, '--dir', downloaded], { stdio: 'inherit' })
  if (JSON.stringify(readdirSync(downloaded).sort()) !== JSON.stringify([...names].sort()))
    throw new Error('Downloaded stable draft asset set differs')
  for (const name of names) {
    const hash = (dir) => createHash('sha256').update(readFileSync(join(dir, name))).digest('hex')
    if (hash(directory) !== hash(downloaded)) throw new Error('Downloaded stable draft asset mismatch: ' + name)
  }
  console.log(`Verified stable draft: https://github.com/${repo}/releases/tag/${tag}`)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
