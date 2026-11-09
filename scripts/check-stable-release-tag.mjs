import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const version = JSON.parse(readFileSync('package.json', 'utf8')).version
if (version !== '1.0.0' || process.env.GITHUB_REF_TYPE !== 'tag' ||
    process.env.GITHUB_REF_NAME !== `v${version}`)
  throw new Error('Stable release requires the matching v1.0.0 tag')
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (!/^[a-f0-9]{40}$/.test(head) || head !== process.env.GITHUB_SHA)
  throw new Error('Stable release checkout does not match the tag event commit')
console.log(JSON.stringify({ tag: `v${version}`, sourceCommit: head }))
