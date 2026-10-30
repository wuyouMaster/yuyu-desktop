import type { WechatKeyPort, ImageKeyResult } from '../../shared/wechat-key-port'
import { RuntimeRpcError } from '../../shared/runtime-rpc'
import type { OwnedDatabaseTransport } from './wechat-database-runtime'
import { WechatKeyClient } from './wechat-key-client'

const messages: Record<string, string> = {
  IMAGE_KEY_METADATA_INVALID: '所选账号附近未找到有效的图片密钥元数据',
  IMAGE_KEY_SAMPLE_INVALID: '所选账号中没有可用于完整校验的图片样本',
  IMAGE_KEY_NO_VERIFIED_CANDIDATE: '候选图片密钥未通过完整内容校验',
  IMAGE_KEY_METADATA_READ_FAILED: '无法安全读取所选账号的图片密钥元数据',
  IMAGE_KEY_METADATA_LIMIT: '所选目录超过自动校验范围，请检查账号目录',
  KEY_CAPTURE_CANCELLED: '图片密钥检查已取消',
  CAPABILITY_UNAVAILABLE: '已安装的微信运行时不支持图片密钥自动检查',
  INVALID_ARGUMENT: '请先选择有效的账号目录'
}

/** A narrow product adapter. It registers only image-key discovery, never claims
 * process capture, Intel installation or privilege elevation support.
 */
export class WechatImageKeyProvider implements Pick<WechatKeyPort, 'autoGetImageKey'> {
  constructor(private readonly createTransport: () => Promise<OwnedDatabaseTransport>) {}
  async autoGetImageKey(
    accountRoot?: string,
    onStatus?: (message: string) => void,
    wxid?: string
  ): Promise<ImageKeyResult> {
    const status = (message: string) => {
      try {
        onStatus?.(message)
      } catch {
        /* UI progress cannot bypass cleanup. */
      }
    }
    let rpc: OwnedDatabaseTransport | undefined
    let result: ImageKeyResult
    try {
      if (!accountRoot) throw new RuntimeRpcError('INVALID_ARGUMENT')
      status('正在检查所选账号的图片密钥元数据')
      rpc = await this.createTransport()
      result = await new WechatKeyClient(rpc).discoverImage(accountRoot, wxid)
    } catch (error) {
      result = {
        success: false,
        error:
          error instanceof RuntimeRpcError
            ? (messages[error.code] ?? '图片密钥检查失败')
            : '图片密钥检查失败'
      }
    }
    try {
      await rpc?.close()
    } catch {
      result = { success: false, error: '图片密钥运行时未确认正常关闭' }
    }
    status(result.success ? '图片密钥已通过完整内容校验' : '图片密钥检查未完成')
    return result
  }
}
