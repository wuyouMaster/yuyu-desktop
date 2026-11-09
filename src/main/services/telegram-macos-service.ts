import { homedir } from 'node:os'
import { join } from 'node:path'
import { RuntimeRpcError } from '../../shared/runtime-rpc'
import type { TelegramMacOSInspection } from '../../shared/telegram-macos'
import { telegramMacOSCandidateSchema } from '../../shared/telegram-macos-protocol'
import { createApplicationRuntime } from '../runtime-rpc/application-runtimes'
import { TelegramMacOSClient } from '../runtime-rpc/telegram-macos-client'
import { TelegramMacOSReadProvider } from './telegram-macos-read-provider'

function createClient(): TelegramMacOSClient {
  const rpc = createApplicationRuntime('telegram')
  return new TelegramMacOSClient({ call: rpc.callAsync.bind(rpc), close: () => rpc.close() })
}

export function telegramMacOSError(error: unknown): Error {
  if (error instanceof RuntimeRpcError) {
    if (['CAPABILITY_UNAVAILABLE', 'INCOMPATIBLE_RUNTIME', 'METHOD_NOT_FOUND'].includes(error.code))
      return new Error('请更新 Telegram 运行时：当前版本不支持 Telegram macOS 本地快照读取。')
    if (error.code === 'SESSION_CLOSED')
      return new Error('Telegram macOS 数据源已断开，请重新连接。')
    return new Error(
      `Telegram macOS 本地读取失败（${error.code}），请确认客户端版本与本地数据可用。`
    )
  }
  return error instanceof Error ? error : new Error('Telegram macOS 本地读取失败')
}

/** Paths are main-process defaults, never supplied through renderer IPC. */
export class TelegramMacOSService {
  private inFlight?: Promise<TelegramMacOSInspection>
  private readonly inspections = new Set<TelegramMacOSClient>()
  constructor(
    private readonly options: {
      platform?: NodeJS.Platform
      dataRoot?: string
      appPath?: string
      createClient?: () => TelegramMacOSClient
    } = {}
  ) {}

  private paths() {
    return {
      root:
        this.options.dataRoot ??
        join(homedir(), 'Library/Group Containers/6N38VWS5BX.ru.keepcoder.Telegram'),
      appPath: this.options.appPath ?? '/Applications/Telegram.app'
    }
  }

  private client(): TelegramMacOSClient {
    return (this.options.createClient ?? createClient)()
  }

  inspect(): Promise<TelegramMacOSInspection> {
    if (this.inFlight) return this.inFlight
    const operation = this.inspectOnce().finally(() => {
      if (this.inFlight === operation) this.inFlight = undefined
    })
    this.inFlight = operation
    return operation
  }

  async cancelInspection(): Promise<void> {
    this.inFlight = undefined
    await Promise.all([...this.inspections].map((client) => client.close()))
  }

  private async inspectOnce(): Promise<TelegramMacOSInspection> {
    const base = { clientType: 'telegram-macos' as const, candidates: [] }
    if ((this.options.platform ?? process.platform) !== 'darwin')
      return {
        ...base,
        state: 'unsupported_platform',
        message: 'Telegram macOS 本地快照仅支持 macOS。'
      }
    let client: TelegramMacOSClient | undefined
    try {
      client = this.client()
      this.inspections.add(client)
      const { root, appPath } = this.paths()
      const result = await client.inspect(root, appPath)
      if (result.state === 'not_found')
        return {
          ...base,
          state: 'not_found',
          message: '未找到 Telegram macOS 本地数据，请先在客户端登录。'
        }
      if (result.state !== 'storage_detected' || !result.candidates.length)
        return {
          ...base,
          state: 'unavailable',
          message: '当前 Telegram macOS 本地存储格式尚不支持。'
        }
      return {
        ...base,
        state: 'detected',
        candidates: result.candidates.map((candidate, index) => ({
          id: candidate.id,
          label: `本地快照 ${index + 1}`
        })),
        message: '发现 Telegram macOS 本地快照，可连接后按需读取；未读取远端历史，也不支持发送。'
      }
    } catch (error) {
      return { ...base, state: 'unavailable', message: telegramMacOSError(error).message }
    } finally {
      try {
        await client?.close()
      } finally {
        if (client) this.inspections.delete(client)
      }
    }
  }

  createProvider(candidateId: string): TelegramMacOSReadProvider {
    if ((this.options.platform ?? process.platform) !== 'darwin')
      throw new Error('Telegram macOS 本地快照仅支持 macOS')
    telegramMacOSCandidateSchema.parse(candidateId)
    return new TelegramMacOSReadProvider({ ...this.paths(), candidateId }, this.client())
  }
}
