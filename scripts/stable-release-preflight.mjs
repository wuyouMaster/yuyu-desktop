import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const applications = ['wechat', 'dingtalk', 'telegram']
const stableVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/
const previewVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*$/

export function isDeveloperIdSignature(status, details) {
  return status === 0 && /^Authority=Developer ID Application: .+$/m.test(details) &&
    /^TeamIdentifier=[A-Z0-9]{10}$/m.test(details)
}

// This is a necessary preflight, not proof of signing, notarization or real use.
export function checkStableReadiness({ platform, arch, version, packages, clean, identityOutput, profile, unsigned = false, allowExperimentalRuntimes = false }) {
  const issues = []
  if (platform !== 'darwin' || arch !== 'arm64') issues.push('stable candidate requires macOS arm64')
  if (version !== '1.0.0') issues.push('package version must be 1.0.0')
  if (!clean) issues.push('checkout must be clean and committed')
  if (!unsigned && !/^\s*\d+\)\s+[A-Fa-f0-9]{40}\s+"Developer ID Application: .+"\s*$/m.test(identityOutput))
    issues.push('a valid Developer ID Application signing identity is required')
  if (!unsigned && !profile?.trim()) issues.push('APPLE_KEYCHAIN_PROFILE is required for notarization')
  for (const application of applications) {
    const matches = Array.isArray(packages)
      ? packages.filter((entry) => entry?.application === application && entry?.target === 'darwin-arm64')
      : []
    const runtime = matches.length === 1 ? matches[0] : undefined
    const stable = runtime?.releaseStatus === 'stable' && stableVersion.test(runtime.version ?? '')
    const experimental = allowExperimentalRuntimes && runtime?.releaseStatus === 'development-only' &&
      previewVersion.test(runtime.version ?? '')
    if (!stable && !experimental)
      issues.push(allowExperimentalRuntimes
        ? `${application} requires exactly one stable or explicitly experimental macOS arm64 runtime`
        : `${application} requires exactly one stable macOS arm64 runtime`)
  }
  return issues
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (new Set(args).size !== args.length || args.some((arg) => !['--unsigned', '--allow-experimental-runtimes'].includes(arg)))
    throw new Error('Usage: stable-release-preflight.mjs [--unsigned] [--allow-experimental-runtimes]')
  const unsigned = args.includes('--unsigned')
  const allowExperimentalRuntimes = args.includes('--allow-experimental-runtimes')
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version
  const { packages } = JSON.parse(readFileSync('runtime.lock.json', 'utf8'))
  const clean = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() === ''
  let identityOutput = ''
  if (!unsigned && process.platform === 'darwin') {
    try {
      identityOutput = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
      })
    } catch { /* Report the missing identity without exposing keychain output. */ }
  }
  const issues = checkStableReadiness({ platform: process.platform, arch: process.arch, version, packages,
    clean, identityOutput, profile: process.env.APPLE_KEYCHAIN_PROFILE, unsigned, allowExperimentalRuntimes })
  if (issues.length) {
    console.error('Stable release preflight failed:\n' + issues.map((issue) => `- ${issue}`).join('\n'))
    process.exitCode = 1
  } else {
    if (allowExperimentalRuntimes)
      console.log('Experimental runtimes are permitted; their development-only status and limitations must remain disclosed')
    console.log(unsigned
      ? 'Unsigned stable preflight passed; installation and runtime acceptance still required'
      : 'Stable release preflight passed; signed build, notarization and acceptance still required')
  }
}
