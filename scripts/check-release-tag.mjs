import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const tag = process.env.GITHUB_REF_NAME || ''
if (process.env.GITHUB_REF_TYPE !== 'tag' || tag !== `v${version}` ||
    !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(tag))
  throw new Error('Release tag must exactly match the checked-out package version')
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (!/^[a-f0-9]{40}$/.test(head) || head !== process.env.GITHUB_SHA)
  throw new Error('Release checkout does not match the tag event commit')
console.log(JSON.stringify({ tag, sourceCommit: head }))
