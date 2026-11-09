// Offline inventory of license files beside packages shipped in an Electron ASAR.
// This is a partial evidence check: it does not inventory bundled JS, native
// transitive dependencies, or establish license compliance.
const { createRequire } = require('node:module')
const { resolve, sep } = require('node:path')

const builderRequire = createRequire(require.resolve('electron-builder'))
const asar = createRequire(builderRequire.resolve('app-builder-lib'))('@electron/asar')
const manifestPattern = /(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/
const licensePattern = /^(?:license|licence|copying|notice)(?:\..*)?$/i

function normalizeArchivePath(entry) {
  return entry.replaceAll('\\', '/').replace(/^\/+/, '')
}

function auditPackageLicenseFiles(archive, { archiveApi = asar, separator = sep } = {}) {
  const entries = archiveApi.listPackage(archive).map(normalizeArchivePath)
  const nativePath = (entry) => entry.replaceAll('/', separator)
  const manifests = entries.filter((entry) => manifestPattern.test(entry)).sort()
  const packages = manifests.map((manifest) => {
    const root = manifest.slice(0, -'package.json'.length)
    const licenseFiles = entries.filter((entry) => {
      if (!entry.startsWith(root)) return false
      const relative = entry.slice(root.length)
      return !relative.includes('/') && licensePattern.test(relative) &&
        archiveApi.statFile(archive, nativePath(entry)).size > 0
    }).sort()
    let metadata
    try {
      metadata = JSON.parse(archiveApi.extractFile(archive, nativePath(manifest)).toString('utf8'))
    } catch {
      return { path: root.slice(0, -1), error: 'unreadable package metadata', licenseFiles }
    }
    return {
      path: root.slice(0, -1), name: metadata.name ?? null, version: metadata.version ?? null,
      declaredLicense: metadata.license ?? null, licenseFiles
    }
  })
  const unresolved = packages.filter((entry) => entry.error || !entry.licenseFiles.length)
  return { packageCount: packages.length, unresolved, packages }
}

if (require.main === module) {
  if (process.argv.length !== 3) {
    console.error('Usage: node scripts/audit-packaged-license-files.cjs <app.asar>')
    process.exitCode = 2
  } else {
    try {
      const result = auditPackageLicenseFiles(resolve(process.argv[2]))
      console.log(JSON.stringify({ packageCount: result.packageCount, unresolved: result.unresolved }, null, 2))
      if (!result.packageCount || result.unresolved.length) process.exitCode = 1
    } catch (error) {
      console.error(`Package license inventory failed: ${error.message}`)
      process.exitCode = 1
    }
  }
}

module.exports = { auditPackageLicenseFiles, normalizeArchivePath }
