import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const repo = process.env.GITHUB_REPOSITORY
const tag = process.env.GITHUB_REF_NAME
if (repo !== 'wuyouMaster/yuyu-desktop' || !tag || !process.env.GH_TOKEN)
  throw new Error('Public application destination, tag and scoped GitHub token are required')
execFileSync(process.execPath, ['scripts/check-release-tag.mjs'], { stdio: 'inherit' })
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const refs = execFileSync('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`], { encoding: 'utf8' }).trim().split('\n')
const peeled = refs.find((line) => line.endsWith(`refs/tags/${tag}^{}`))
const direct = refs.find((line) => line.endsWith(`refs/tags/${tag}`))
if ((peeled || direct || '').split(/\s+/)[0] !== head) throw new Error('Remote tag does not resolve to the reviewed commit')
const directory = resolve(process.argv[2] || 'dist/release-upload')
for (const target of ['mac-arm64', 'win-x64'])
  execFileSync(process.execPath, ['scripts/release-artifacts.mjs', 'check', target, directory], { stdio: 'inherit' })
const names = []
for (const target of ['mac-arm64', 'win-x64']) {
  const manifestName = `release-manifest-${target}.json`
  const manifest = JSON.parse(readFileSync(join(directory, manifestName), 'utf8'))
  names.push(...manifest.files.map((item) => item.name), manifestName)
}
if (new Set(names).size !== names.length || names.some((name) => basename(name) !== name))
  throw new Error('Duplicate or unsafe asset names')
const existing = execFileSync('gh', ['api', '--paginate', `repos/${repo}/releases?per_page=100`, '--jq', '.[].tag_name'], { encoding: 'utf8' })
if (existing.split(/\r?\n/).includes(tag)) throw new Error('Release already exists; inspect it rather than overwrite')
const temp = mkdtempSync(join(tmpdir(), 'yuyu-draft-verification-'))
try {
  const notes = join(temp, 'notes.md')
  writeFileSync(notes, `Development preview for macOS arm64 and Windows x64.\n\nSource commit: ${head}\n\nThese builds are unsigned or ad-hoc signed; macOS Developer ID signing/notarization, Windows execution, real-account behavior and upgrades have not been verified by this workflow. Runtime packages are installed separately; availability and capabilities vary by platform.\n`)
  execFileSync('gh', ['release', 'create', tag, ...names.map((name) => join(directory, name)),
    '--repo', repo, '--verify-tag', '--draft', '--prerelease', '--title', `YUYU ${tag} preview`, '--notes-file', notes], { stdio: 'inherit' })
  const downloaded = join(temp, 'downloaded')
  execFileSync('gh', ['release', 'download', tag, '--repo', repo, '--dir', downloaded], { stdio: 'inherit' })
  const received = readdirSync(downloaded).sort()
  if (JSON.stringify(received) !== JSON.stringify([...names].sort())) throw new Error('Downloaded draft asset set differs')
  for (const name of names) {
    const hash = (dir) => createHash('sha256').update(readFileSync(join(dir, name))).digest('hex')
    if (hash(directory) !== hash(downloaded)) throw new Error('Downloaded draft asset mismatch: ' + name)
  }
  console.log(`Verified draft: https://github.com/${repo}/releases/tag/${tag}`)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
