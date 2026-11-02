import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDatabaseKeyController } from '../../src/renderer/src/features/settings/database-key/useDatabaseKeyController'

const originalApi = window.api

afterEach(() => {
  window.api = originalApi
})

describe('database connection refusal', () => {
  it.each(['clearSavedKey', 'returnToLogin'] as const)(
    'keeps the current workspace when %s cannot disconnect an active operation',
    async (action) => {
      const disconnectDb = vi
        .fn()
        .mockResolvedValue({ success: false, error: '合成导出任务正在执行' })
      window.api = {
        getSavedDbKey: vi
          .fn()
          .mockResolvedValue({ success: true, saved: true, encryptionAvailable: true }),
        getDatabaseKeyEnvironment: vi.fn().mockResolvedValue({ encryptionAvailable: true }),
        onDbKeyStatus: vi.fn().mockReturnValue(() => {}),
        clearSavedDbKey: vi.fn().mockResolvedValue({ success: true }),
        disconnectDb
      } as unknown as typeof window.api
      const callbacks = {
        onDbKeyChange: vi.fn(),
        onDatabaseConnectionChange: vi.fn(),
        onSelfInfoChange: vi.fn(),
        onContactsChange: vi.fn(),
        onFilteredContactsChange: vi.fn(),
        onReturnToLogin: vi.fn(),
        onNotice: vi.fn()
      }
      const { result } = renderHook(() =>
        useDatabaseKeyController({
          dbKey: '',
          dbReady: true,
          selfInfo: { wxid: 'wxid_fixture', nickname: '合成账号', accountRoot: '/fixture/account' },
          ...callbacks
        })
      )
      await waitFor(() => expect(result.current.state.saved).toBe(true))
      await act(async () => {
        await result.current[action]()
      })
      expect(disconnectDb).toHaveBeenCalledOnce()
      expect(callbacks.onDatabaseConnectionChange).not.toHaveBeenCalled()
      expect(callbacks.onSelfInfoChange).not.toHaveBeenCalled()
      expect(callbacks.onContactsChange).not.toHaveBeenCalled()
      expect(callbacks.onReturnToLogin).not.toHaveBeenCalled()
      expect(callbacks.onNotice).toHaveBeenCalled()
    }
  )
})
