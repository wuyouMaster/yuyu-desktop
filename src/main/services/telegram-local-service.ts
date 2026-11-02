import { homedir } from 'node:os'
import { join } from 'node:path'
import type { TelegramLocalInspection } from '../../shared/telegram-local'
import { inspectTelegramStorage } from './telegram-storage-runtime'
import { RuntimeRpcError } from '../../shared/runtime-rpc'

export class TelegramLocalService {
  private inFlight?: Promise<TelegramLocalInspection>

  constructor(private readonly options: { platform?: NodeJS.Platform; dataRoot?: string } = {}) {}

  inspect(): Promise<TelegramLocalInspection> {
    this.inFlight ??= this.inspectOnce().finally(() => {
      this.inFlight = undefined
    })
    return this.inFlight
  }

  private async inspectOnce(): Promise<TelegramLocalInspection> {
    const base = { source: 'telegram' as const, accounts: [] }
    if ((this.options.platform ?? process.platform) !== 'darwin') {
      return {
        ...base,
        state: 'unsupported_platform',
        message: '本地存储读取目前仅验证了 macOS Telegram Desktop 7.2.5 和 7.2.9。'
      }
    }
    try {
      const result = await inspectTelegramStorage(
        this.options.dataRoot ??
          join(homedir(), 'Library/Application Support/Telegram Desktop/tdata')
      )
      const decoded = result.accounts.filter((account) => account.state === 'metadata_read').length
      return {
        ...base,
        ...result,
        state: 'detected',
        message: decoded
          ? `已从本地存储读取 ${decoded} 个账号的资料。可尝试连接运行中的客户端，读取已加载的消息快照。`
          : '已读取本地账号索引，但账号资料尚未解码成功，聊天记录未连接。'
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return { ...base, state: 'not_found', message: '未找到 Telegram Desktop 本地数据。' }
      }
      if (error instanceof RuntimeRpcError && error.code === 'locked') {
        return {
          ...base,
          state: 'locked',
          message:
            '无法用空口令解锁本地存储，可能设置了本地密码或文件已损坏。未更改客户端锁定状态。'
        }
      }
      if (error instanceof RuntimeRpcError && error.code === 'unsupported_format') {
        return {
          ...base,
          state: 'unsupported_format',
          message: '当前本地存储格式尚未验证；已验证的版本为 Telegram Desktop 7.2.5 和 7.2.9。'
        }
      }
      return {
        ...base,
        state: 'unreadable',
        message: '本地存储读取或完整性校验失败，请确认目录权限并在客户端停止写入后重试。'
      }
    }
  }
}

export const telegramLocalService = new TelegramLocalService()
