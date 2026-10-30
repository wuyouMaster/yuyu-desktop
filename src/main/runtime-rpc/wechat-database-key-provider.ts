import { isAbsolute } from 'node:path'
import type { WechatKeyPort, DatabaseKeyResult } from '../../shared/wechat-key-port'
import { RuntimeRpcError } from '../../shared/runtime-rpc'
import type { OwnedDatabaseTransport } from './wechat-database-runtime'
import { WechatKeyClient, KEY_RUNTIME_SHUTDOWN_GRACE_MS } from './wechat-key-client'

const messages: Record<string, string> = {
  KEY_AUTHORIZATION_CANCELLED: '已取消系统授权',
  KEY_AUTHORIZATION_FAILED: '系统授权未完成，请重试',
  KEY_AUTHORIZATION_TIMEOUT: '等待系统授权超时',
  KEY_AUTHORIZATION_PEER_INVALID: '无法确认授权进程身份',
  KEY_CAPTURE_CANCELLED: '数据库密钥获取已取消',
  CANCELLED: '数据库密钥获取已取消',
  KEY_CAPTURE_TIMEOUT: '本次未捕获到数据库密钥',
  KEY_CAPTURE_BUSY: '另一次密钥获取尚未结束',
  KEY_CAPTURE_PROCESS_NOT_FOUND: '请先启动支持的微信客户端',
  KEY_CAPTURE_TARGET_AMBIGUOUS: '检测到多个微信进程，请保留一个后重试',
  KEY_CAPTURE_UNSUPPORTED_IDENTITY: '当前微信版本或平台尚不支持自动获取',
  KEY_HELPER_INTEGRITY_FAILED: '微信运行时文件校验失败，请重新安装',
  KEY_HELPER_CLEANUP_UNCONFIRMED: '未确认密钥工具已安全结束，请先检查微信状态',
  RUNTIME_CLEANUP_UNCONFIRMED: '未确认密钥工具已安全结束，请先检查微信状态',
  CAPABILITY_UNAVAILABLE: '已安装的微信运行时不支持授权获取数据库密钥',
  INVALID_ARGUMENT: '请先选择有效的账号目录'
}

/** Only explicit user initiation invokes this adapter. It owns one process per
 * attempt, never changes SIP/signing/login state, and never retries capture. */
export class WechatDatabaseKeyProvider implements Pick<WechatKeyPort, 'autoGetDbKey'> {
  private active?: AbortController
  constructor(
    private readonly createTransport: (options: {
      shutdownGraceMs: number
    }) => Promise<OwnedDatabaseTransport>
  ) {}
  cancel(): void {
    this.active?.abort()
  }
  async autoGetDbKey(
    onStatus?: (message: string) => void,
    accountRoot?: string
  ): Promise<DatabaseKeyResult> {
    const failure = (code: string): DatabaseKeyResult => ({
      success: false,
      code,
      error: messages[code] ?? '数据库密钥获取或验证失败'
    })
    if (this.active) return failure('KEY_CAPTURE_BUSY')
    if (!accountRoot || !isAbsolute(accountRoot)) return failure('INVALID_ARGUMENT')
    const controller = new AbortController()
    this.active = controller
    const status = (message: string): void => {
      try {
        onStatus?.(message)
      } catch {
        /* Observer errors cannot prevent cleanup. */
      }
    }
    let rpc: OwnedDatabaseTransport | undefined
    let result: DatabaseKeyResult
    try {
      status('准备微信运行时；随后请在系统弹窗中授权')
      rpc = await this.createTransport({ shutdownGraceMs: KEY_RUNTIME_SHUTDOWN_GRACE_MS })
      if (controller.signal.aborted) throw new RuntimeRpcError('CANCELLED')
      const value = await new WechatKeyClient(rpc).captureDatabaseAuthorized(
        accountRoot,
        60_000,
        controller.signal
      )
      result = { success: true, key: value.key }
    } catch (error) {
      result = failure(error instanceof RuntimeRpcError ? error.code : 'KEY_OPERATION_FAILED')
    }
    try {
      await rpc?.close()
    } catch {
      result = failure('RUNTIME_CLEANUP_UNCONFIRMED')
    }
    if (controller.signal.aborted && result.success) result = failure('CANCELLED')
    this.active = undefined
    status(result.success ? '数据库密钥已通过所选账号验证' : '数据库密钥获取未完成')
    return result
  }
}
