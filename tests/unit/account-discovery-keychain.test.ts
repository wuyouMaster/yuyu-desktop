import fs from 'fs-extra'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  root: '',
  isEncryptionAvailable: vi.fn(() => true),
  decryptString: vi.fn(() => 'a'.repeat(64))
}))
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic-key-discovery-'))
vi.mock('electron', () => ({ app: { getPath: () => storage.root || os.tmpdir() }, safeStorage: storage }))
vi.mock('../../src/main/services/local-account-identity', () => ({
  readLocalAccountIdentity: () => null,
  deriveAccountWxid: () => 'wxid_fixture',
  accountDirectoryBelongsToIdentity: () => false
}))
vi.mock('../../src/main/services/bootstrap-cache', () => ({ getBootstrapCache: () => null }))

import { DatabaseKeyStore } from '../../src/main/database-key-store'
import { discoverAccounts } from '../../src/main/services/account-discovery'

beforeEach(() => {
  storage.root = root
  storage.isEncryptionAvailable.mockClear()
  storage.isEncryptionAvailable.mockReturnValue(true)
  storage.decryptString.mockClear()
})
afterAll(() => fs.removeSync(root))

it('discovers accounts and saved key presence without querying the keychain', async () => {
  const account = path.join(root, 'fixture-account')
  await fs.ensureDir(path.join(account, 'db_storage'))
  const store = new DatabaseKeyStore()
  const before = await discoverAccounts(account, store)
  expect(before.success).toBe(true)
  expect(before.accounts[0].hasSavedDbKey).toBe(false)
  expect(storage.isEncryptionAvailable).not.toHaveBeenCalled()

  const keyName = (await import('node:crypto')).createHash('sha256')
    .update(path.resolve(account).toLowerCase()).digest('hex') + '.bin'
  await fs.ensureDir(path.join(root, 'database-keys'))
  await fs.writeFile(path.join(root, 'database-keys', keyName), 'synthetic encrypted key')
  const after = await discoverAccounts(account, store)
  expect(after.accounts[0].hasSavedDbKey).toBe(true)
  expect(storage.isEncryptionAvailable).not.toHaveBeenCalled()
  expect(await store.getStatus(account)).toEqual({ saved: true, encryptionAvailable: true })
  expect(storage.isEncryptionAvailable).toHaveBeenCalledOnce()

  storage.isEncryptionAvailable.mockReturnValue(false)
  expect(await store.load(account)).toMatchObject({ success: false, saved: true, encryptionAvailable: false })
  expect(storage.decryptString).not.toHaveBeenCalled()
  storage.isEncryptionAvailable.mockReturnValue(true)
  expect(await store.load(account)).toMatchObject({ success: true, saved: true, key: 'a'.repeat(64) })
  expect(storage.decryptString).toHaveBeenCalledOnce()
})
