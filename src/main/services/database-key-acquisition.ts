import type {
  DatabaseKeyStorageResult,
  DatabaseKeyValidationResult
} from '../../shared/database-key'
import type { DatabaseKeyResult, WechatKeyPort } from '../../shared/wechat-key-port'

interface AcquisitionDependencies {
  capture: WechatKeyPort['autoGetDbKey']
  validate: (
    key: string,
    accountRoot: string
  ) => DatabaseKeyValidationResult | Promise<DatabaseKeyValidationResult>
  save: (accountRoot: string, key: string) => Promise<DatabaseKeyStorageResult>
}

interface AcquisitionResult extends DatabaseKeyResult {
  saved?: boolean
  warning?: string
}

/** One debugger at a time; validate the selected account before persisting. */
export function createDatabaseKeyAcquirer(dependencies: AcquisitionDependencies) {
  let inFlight = false
  return async (
    accountRoot: string,
    options?: { save?: boolean },
    onStatus?: (message: string) => void
  ): Promise<AcquisitionResult> => {
    const selectedRoot = String(accountRoot || '').trim()
    if (!selectedRoot)
      return { success: false, code: 'ACCOUNT_REQUIRED', error: '请先选择微信账号' }
    if (inFlight) {
      return {
        success: false,
        code: 'KEY_CAPTURE_IN_PROGRESS',
        error: '正在获取密钥，请等待当前操作完成'
      }
    }
    inFlight = true
    try {
      const result = await dependencies.capture(onStatus, selectedRoot)
      if (!result.success || !result.key) {
        return { success: false, code: result.code, error: result.error || '未获取到有效密钥' }
      }
      onStatus?.('正在验证所选账号的数据库...')
      const validation = await dependencies.validate(result.key, selectedRoot)
      if (!validation.success) {
        return {
          success: false,
          code: validation.code || 'ACCOUNT_MISMATCH',
          error: validation.error || '密钥与所选账号数据库不匹配，请确认账号和数据目录'
        }
      }
      if (options?.save === false) return result
      const saved = await dependencies.save(selectedRoot, result.key)
      return {
        ...result,
        saved: saved.success,
        warning: saved.success ? undefined : saved.error
      }
    } catch {
      return {
        success: false,
        code: 'KEY_ACQUISITION_FAILED',
        error: '密钥获取或验证未完成，请重试'
      }
    } finally {
      inFlight = false
    }
  }
}
