import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const applications = ['wechat', 'dingtalk', 'telegram']

export function isDeveloperIdSignature(status, details) {
  return status === 0 && /^Authority=Developer ID Application: .+$/m.test(details) &&
    /^TeamIdentifier=[A-Z0-9]{10}$/m.test(details)
}

// This is a necessary preflight, not proof of signing, notarization or real use.
export function checkStableReadiness({ platform, arch, version, packages, clean, identityOutput, profile }) {
  const issues = []
  if (platform !== 'darwin' || arch !== 'arm64') issues.push('stable candidate requires macOS arm64')
  if (version !== '1.0.0') issues.push('package version must be 1.0.0')
  if (!clean) issues.push('checkout must be clean and committed')
  if (!/^\s*\d+\)\s+[A-Fa-f0-9]{40}\s+"Developer ID Application: .+"\s*$/m.test(identityOutput))
    issues.push('a valid Developer ID Application signing identity is required')
  if (!profile?.trim()) issues.push('APPLE_KEYCHAIN_PROFILE is required for notarization')
  for (const application of applications) {
    const matches = Array.isArray(packages)
      ? packages.filter((entry) => entry?.application === application && entry?.target === 'darwin-arm64')
      : []
    if (matches.length !== 1 || matches[0].releaseStatus !== 'stable' ||
        !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(matches[0].version ?? ''))
      issues.push(`${application} requires exactly one stable macOS arm64 runtime`)
  }
  return issues
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version
  const { packages } = JSON.parse(readFileSync('runtime.lock.json', 'utf8'))
  const clean = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() === ''
  let identityOutput = ''
  if (process.platform === 'darwin') {
    try {
      identityOutput = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
      })
    } catch { /* Report the missing identity without exposing keychain output. */ }
  }
  const issues = checkStableReadiness({ platform: process.platform, arch: process.arch, version, packages,
    clean, identityOutput, profile: process.env.APPLE_KEYCHAIN_PROFILE })
  if (issues.length) {
    console.error('Stable release preflight failed:\n' + issues.map((issue) => `- ${issue}`).join('\n'))
    process.exitCode = 1
  } else {
    console.log('Stable release preflight passed; signed build, notarization and acceptance still required')
  }
}
