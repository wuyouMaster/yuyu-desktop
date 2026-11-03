const { closeSync, existsSync, openSync, readSync, readdirSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const machOMagic = new Set([
  0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe,
  0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca
])

function isMachO(file) {
  const header = Buffer.alloc(4)
  const fd = openSync(file, 'r')
  try {
    return readSync(fd, header, 0, 4, 0) === 4 && machOMagic.has(header.readUInt32BE())
  } finally {
    closeSync(fd)
  }
}

function nestedCode(app) {
  const targets = []
  function visit(directory) {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(target)
        if (/\.(app|framework|xpc)$/.test(entry.name)) targets.push(target)
      } else if (entry.isFile() && isMachO(target)) targets.push(target)
      // Do not traverse framework or other symlinks.
    }
  }
  visit(path.join(app, 'Contents', 'Frameworks'))
  return targets
}

function signMacosBundle(app, run = (args) => execFileSync('/usr/bin/codesign', args, { stdio: 'ignore' })) {
  const valid = (target, deep = false) => {
    try {
      run(['--verify', ...(deep ? ['--deep'] : []), '--strict', target])
      return true
    } catch {
      return false
    }
  }
  if (valid(app, true)) return
  // Sign each invalid nested component from inside out, preserving entitlements.
  // --deep is deliberately used only for verification, never for signing.
  for (const target of nestedCode(app)) {
    if (valid(target)) continue
    run(['--force', '--sign', '-', '--preserve-metadata=entitlements,flags', target])
    if (!valid(target)) throw new Error('macOS nested code signature verification failed')
  }
  run(['--force', '--sign', '-', '--preserve-metadata=entitlements,flags', app])
  if (!valid(app, true)) throw new Error('macOS app bundle signature verification failed')
}

module.exports = { nestedCode, signMacosBundle }
