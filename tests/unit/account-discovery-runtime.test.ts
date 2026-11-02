import fs from 'fs-extra'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RuntimeRpcError } from '../../src/shared/runtime-rpc'
const state = vi.hoisted(() => ({ code: 'RUNTIME_NOT_INSTALLED' }))
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))
vi.mock('../../src/main/services/local-account-identity', () => ({
  readLocalAccountIdentity: () => {
    throw new RuntimeRpcError(state.code)
  },
  deriveAccountWxid: vi.fn(),
  accountDirectoryBelongsToIdentity: vi.fn()
}))
import { discoverAccounts } from '../../src/main/services/account-discovery'
let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'synthetic-runtime-discovery-'))
  await fs.ensureDir(path.join(root, 'account', 'db_storage'))
})
afterEach(async () => {
  await fs.remove(root)
})
it.each([
  ['RUNTIME_NOT_INSTALLED', '请先安装微信应用运行时，重启后再选择账号'],
  ['CAPABILITY_UNAVAILABLE', '当前微信运行时不支持账号识别，请安装兼容版本'],
  ['RUNTIME_INTEGRITY_FAILED', '微信运行时无法完成账号识别，请重新校验或安装运行时']
])(
  'returns an explicit %s failure so startup can show runtime management',
  async (code, message) => {
    state.code = code
    const store = { getStatus: vi.fn() }
    await expect(discoverAccounts(root, store as never)).resolves.toEqual({
      success: false,
      accounts: [],
      error: message
    })
    expect(store.getStatus).not.toHaveBeenCalled()
  }
)
