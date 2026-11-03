import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { isPackaged: false } }))
import { runtimeCompatibilityError } from '../../src/main/runtime-catalog'
import type { RuntimePackage } from '../../scripts/runtime-store.mjs'
const item = (application: string, target: string, files: string[]) =>
  ({ application, target, files }) as RuntimePackage
describe('runtime compatibility before download', () => {
  it('does not call a valid legacy archive ready for the new storage protocol', () => {
    expect(runtimeCompatibilityError(item('wechat', 'darwin-arm64', ['xkey_helper']))).toContain(
      '所需接口'
    )
    expect(
      runtimeCompatibilityError(item('telegram', 'darwin-arm64', ['telegram/telegram-ax-send']))
    ).toContain('所需接口')
  })
  it('requires the platform host name and preserves the independent DingTalk CLI contract', () => {
    expect(
      runtimeCompatibilityError(item('wechat', 'darwin-arm64', ['wechat-storage-host']))
    ).toBeUndefined()
    expect(
      runtimeCompatibilityError(item('wechat', 'win32-x64', ['wechat-storage-host']))
    ).toBeDefined()
    expect(
      runtimeCompatibilityError(item('wechat', 'win32-x64', ['wechat-storage-host.exe']))
    ).toBeUndefined()
    expect(
      runtimeCompatibilityError(item('telegram', 'darwin-arm64', ['telegram/telegram-storage-host']))
    ).toBeUndefined()
    expect(
      runtimeCompatibilityError(item('telegram', 'darwin-arm64', ['telegram-storage-host']))
    ).toBeDefined()
    expect(
      runtimeCompatibilityError(item('telegram', 'win32-x64', ['telegram/telegram-storage-host.exe']))
    ).toBeUndefined()
    expect(
      runtimeCompatibilityError(item('dingtalk', 'darwin-arm64', ['dingtalk/dtstore']))
    ).toBeUndefined()
  })
})
