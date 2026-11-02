import { app, safeStorage } from 'electron'
import fs from 'fs-extra'
import path from 'path'
import crypto from 'crypto'
import type { DatabaseKeyStorageResult } from '../shared/database-key'

const normalizeDatabaseKey = (value: string): string => value.trim().replace(/^0x/i, '')

export const isValidDatabaseKey = (value: string): boolean =>
  /^[0-9a-f]{64}$/i.test(normalizeDatabaseKey(value))

export class DatabaseKeyStore {
  private get directoryPath(): string {
    return path.join(app.getPath('userData'), 'database-keys')
  }

  private filePath(accountRoot: string): string {
    const normalized = path.resolve(accountRoot).toLowerCase()
    const id = crypto.createHash('sha256').update(normalized).digest('hex')
    return path.join(this.directoryPath, `${id}.bin`)
  }

  private filePathForId(id: string): string {
    return path.join(this.directoryPath, id + '.bin')
  }

  async saveMigratedFile(fileName: string, rawKey: string): Promise<boolean> {
    const key = normalizeDatabaseKey(rawKey)
    if (!/^[0-9a-f]{64}\.bin$/i.test(fileName) || !isValidDatabaseKey(key)) return false
    if (!safeStorage.isEncryptionAvailable()) return false
    const targetPath = this.filePathForId(fileName.slice(0, -4).toLowerCase())
    const tempPath = targetPath + '.tmp-' + process.pid
    try {
      await fs.ensureDir(this.directoryPath)
      await fs.writeFile(tempPath, safeStorage.encryptString(key), { mode: 0o600 })
      await fs.chmod(tempPath, 0o600)
      const verified = normalizeDatabaseKey(safeStorage.decryptString(await fs.readFile(tempPath)))
      if (!isValidDatabaseKey(verified) || verified.toLowerCase() !== key.toLowerCase()) {
        return false
      }
      await fs.move(tempPath, targetPath, { overwrite: true })
      return true
    } finally {
      await fs.remove(tempPath).catch(() => undefined)
    }
  }

  async loadMigratedFile(fileName: string): Promise<string | undefined> {
    if (!/^[0-9a-f]{64}\.bin$/i.test(fileName)) return undefined
    const filePath = this.filePathForId(fileName.slice(0, -4).toLowerCase())
    if (!(await fs.pathExists(filePath)) || !safeStorage.isEncryptionAvailable()) return undefined
    try {
      const key = normalizeDatabaseKey(safeStorage.decryptString(await fs.readFile(filePath)))
      return isValidDatabaseKey(key) ? key : undefined
    } catch {
      return undefined
    }
  }

  async getStatus(accountRoot: string): Promise<{ saved: boolean; encryptionAvailable: boolean }> {
    return {
      saved: Boolean(accountRoot) && (await fs.pathExists(this.filePath(accountRoot))),
      encryptionAvailable: safeStorage.isEncryptionAvailable()
    }
  }

  async load(accountRoot: string): Promise<DatabaseKeyStorageResult> {
    try {
      const status = await this.getStatus(accountRoot)
      if (!status.saved) return { success: true, ...status }
      if (!status.encryptionAvailable) {
        return { success: false, error: '系统安全存储不可用', ...status }
      }
      const encrypted = await fs.readFile(this.filePath(accountRoot))
      const key = normalizeDatabaseKey(safeStorage.decryptString(encrypted))
      if (!isValidDatabaseKey(key)) {
        return { success: false, error: '已保存的密钥格式无效', ...status }
      }
      return { success: true, key, ...status }
    } catch (error) {
      const status = await this.getStatus(accountRoot)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        ...status
      }
    }
  }

  async save(accountRoot: string, rawKey: string): Promise<DatabaseKeyStorageResult> {
    const key = normalizeDatabaseKey(rawKey)
    if (!accountRoot.trim()) {
      return {
        success: false,
        error: '请先选择微信账号',
        saved: false,
        encryptionAvailable: safeStorage.isEncryptionAvailable()
      }
    }
    if (!isValidDatabaseKey(key)) {
      return {
        success: false,
        error: '密钥必须是 64 位十六进制字符',
        saved: await fs.pathExists(this.filePath(accountRoot)),
        encryptionAvailable: safeStorage.isEncryptionAvailable()
      }
    }
    if (!safeStorage.isEncryptionAvailable()) {
      return {
        success: false,
        error: '系统安全存储不可用',
        saved: await fs.pathExists(this.filePath(accountRoot)),
        encryptionAvailable: false
      }
    }

    try {
      const filePath = this.filePath(accountRoot)
      await fs.ensureDir(this.directoryPath)
      await fs.writeFile(filePath, safeStorage.encryptString(key), { mode: 0o600 })
      await fs.chmod(filePath, 0o600)
      return { success: true, key, saved: true, encryptionAvailable: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        saved: await fs.pathExists(this.filePath(accountRoot)),
        encryptionAvailable: true
      }
    }
  }

  async clear(accountRoot: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (accountRoot) await fs.remove(this.filePath(accountRoot))
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
