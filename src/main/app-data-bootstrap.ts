import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { chooseUserDataRoot, getUserDataRoots, YUYU_RUNTIME_NAME } from './app-data-paths'

export const LEGACY_SAFE_STORAGE_HELPER_ENV = 'YUYU_LEGACY_SAFE_STORAGE_HELPER'
export const LEGACY_SAFE_STORAGE_SOURCE_ENV = 'YUYU_LEGACY_SAFE_STORAGE_SOURCE'
export const LEGACY_SAFE_STORAGE_USER_DATA_ENV = 'YUYU_LEGACY_SAFE_STORAGE_USER_DATA'
export const LEGACY_SAFE_STORAGE_RESULT_FD_ENV = 'YUYU_LEGACY_SAFE_STORAGE_RESULT_FD'

const isLegacySafeStorageHelper = process.env[LEGACY_SAFE_STORAGE_HELPER_ENV] === '1'

function runLegacySafeStorageHelper(): void {
  if (!isLegacySafeStorageHelper) return
  const sourceRoot = process.env[LEGACY_SAFE_STORAGE_SOURCE_ENV]?.trim()
  const resultFd = Number(process.env[LEGACY_SAFE_STORAGE_RESULT_FD_ENV] || '3')
  if (!sourceRoot || !Number.isInteger(resultFd) || resultFd < 3) {
    process.exitCode = 1
    return
  }

  app.whenReady().then(() => {
    void (async () => {
      const { safeStorage } = await import('electron')
      const result: { databaseKeys: Record<string, string> } = { databaseKeys: {} }
      const databaseKeysRoot = path.join(path.resolve(sourceRoot), 'database-keys')
      try {
        if (!safeStorage.isEncryptionAvailable()) {
          // The parent marks all discovered legacy files as failed.
        } else if (fs.existsSync(databaseKeysRoot)) {
          for (const entry of fs.readdirSync(databaseKeysRoot, { withFileTypes: true })) {
            if (!entry.isFile() || !/^[0-9a-f]{64}\.bin$/i.test(entry.name)) continue
            try {
              const plain = safeStorage.decryptString(
                fs.readFileSync(path.join(databaseKeysRoot, entry.name))
              )
              const key = plain.trim().replace(/^0x/i, '')
              if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('invalid key')
              result.databaseKeys[entry.name] = key
            } catch {
              // The parent counts entries without a decrypted key as failed.
            }
          }
        }
        fs.writeFileSync(resultFd, JSON.stringify(result), 'utf8')
        app.exit(0)
      } catch {
        try {
          fs.writeFileSync(resultFd, JSON.stringify(result), 'utf8')
        } catch {
          // The parent process will report a helper failure without exposing secrets.
        }
        app.exit(1)
      }
    })()
  })
}

app.setName(YUYU_RUNTIME_NAME)

if (isLegacySafeStorageHelper) app.setName('TraceMemo')

const isolatedUserData = process.env['YUYU_USER_DATA']
const roots = getUserDataRoots(app.getPath('appData'))
const helperUserData = process.env[LEGACY_SAFE_STORAGE_USER_DATA_ENV]
const selectedUserData = isLegacySafeStorageHelper
  ? path.resolve(helperUserData?.trim() || path.join(roots.current, '.legacy-safe-storage-helper'))
  : chooseUserDataRoot({ ...roots, isolated: isolatedUserData })

app.setPath('userData', selectedUserData)
app.setPath('sessionData', selectedUserData)

if (process.platform === 'darwin') {
  app.setPath('logs', path.join(app.getPath('home'), 'Library', 'Logs', 'YUYU'))
} else if (process.platform === 'win32') {
  app.setPath('logs', path.join(selectedUserData, 'logs'))
}

runLegacySafeStorageHelper()
