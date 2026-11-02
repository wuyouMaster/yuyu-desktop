import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { app } from 'electron'
import {
  LEGACY_SAFE_STORAGE_HELPER_ENV,
  LEGACY_SAFE_STORAGE_RESULT_FD_ENV,
  LEGACY_SAFE_STORAGE_SOURCE_ENV,
  LEGACY_SAFE_STORAGE_USER_DATA_ENV
} from './app-data-bootstrap'
import { DatabaseKeyStore } from './database-key-store'

interface LegacyKeyBundle {
  databaseKeys: Record<string, string>
}

async function decryptLegacyDatabaseKeys(sourceRoot: string): Promise<LegacyKeyBundle> {
  const helperUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'yuyu-legacy-safe-storage-'))
  try {
    return await new Promise<LegacyKeyBundle>((resolve, reject) => {
      const child = spawn(process.execPath, process.argv.slice(1), {
        env: {
          ...process.env,
          [LEGACY_SAFE_STORAGE_HELPER_ENV]: '1',
          [LEGACY_SAFE_STORAGE_SOURCE_ENV]: sourceRoot,
          [LEGACY_SAFE_STORAGE_USER_DATA_ENV]: helperUserData,
          [LEGACY_SAFE_STORAGE_RESULT_FD_ENV]: '3'
        },
        stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
      const chunks: Buffer[] = []
      const resultPipe = child.stdio[3]
      resultPipe?.on('data', (chunk: Buffer) => chunks.push(chunk))
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('legacy safe storage helper timed out'))
      }, 30_000)
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        if (code !== 0) {
          reject(new Error('legacy safe storage helper exited with code ' + code))
          return
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as LegacyKeyBundle)
        } catch {
          reject(new Error('legacy safe storage helper returned invalid data'))
        }
      })
    })
  } finally {
    await fs.remove(helperUserData).catch(() => undefined)
  }
}

export async function migrateLegacyTraceMemoDatabaseKeys(
  keyStore = new DatabaseKeyStore()
): Promise<{ migrated: number; failed: number; sourceFound: boolean }> {
  const sourceRoot = path.join(app.getPath('appData'), 'TraceMemo')
  const sourceDirectory = path.join(sourceRoot, 'database-keys')
  if (!(await fs.pathExists(sourceDirectory))) {
    return { migrated: 0, failed: 0, sourceFound: false }
  }
  const entries = (await fs.readdir(sourceDirectory, { withFileTypes: true })).filter(
    (entry) => entry.isFile() && /^[0-9a-f]{64}\.bin$/i.test(entry.name)
  )
  if (entries.length === 0) return { migrated: 0, failed: 0, sourceFound: false }

  let bundle: LegacyKeyBundle
  try {
    bundle = await decryptLegacyDatabaseKeys(sourceRoot)
  } catch {
    return { migrated: 0, failed: entries.length, sourceFound: true }
  }

  let migrated = 0
  let failed = 0
  for (const entry of entries) {
    const key = bundle.databaseKeys[entry.name]
    if (!key) {
      failed += 1
      continue
    }

    // A key already saved by the current YUYU identity is authoritative. This
    // avoids replacing a usable current key with an older TraceMemo copy.
    const existing = await keyStore.loadMigratedFile(entry.name)
    if (!existing && !(await keyStore.saveMigratedFile(entry.name, key))) {
      failed += 1
      continue
    }

    const verified = await keyStore.loadMigratedFile(entry.name)
    if (!verified) {
      failed += 1
      continue
    }
    await fs.remove(path.join(sourceDirectory, entry.name))
    migrated += 1
  }
  return { migrated, failed, sourceFound: true }
}
