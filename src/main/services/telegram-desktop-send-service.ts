import { managedResourcePath } from '../runtime-paths'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { ProviderHealth } from '../../shared/data-source'

const execute = promisify(execFile)

export interface TelegramDesktopTarget {
  nativeId: string
  title: string
  kind: 'direct' | 'group' | 'channel'
  username?: string
}

export interface TelegramDesktopStatus {
  state: 'ready' | 'unavailable' | 'error'
  appRunning: boolean
  bundleMatched: boolean
  accessibilityTrusted: boolean
  textEntry: boolean
  error?: string
}

export interface TelegramDesktopResponse {
  state?: string
  error?: string
  appRunning?: boolean
  bundleMatched?: boolean
  accessibilityTrusted?: boolean
  textEntry?: boolean
  [key: string]: unknown
}

export interface TelegramDesktopSendServiceOptions {
  helperPath?: string
  discoverPid?: () => Promise<number | undefined>
  runOperation?: (
    operation: string,
    pid: number,
    payload?: Record<string, unknown>
  ) => Promise<TelegramDesktopResponse>
  resultTimeoutMs?: number
}

function defaultHelperPath(): string { return managedResourcePath('telegram/telegram-ax-send')! }

async function defaultDiscoverPid(): Promise<number | undefined> {
  if (process.platform !== 'darwin') return undefined
  try {
    const { stdout } = await execute('/usr/bin/pgrep', ['-x', 'Telegram'], {
      timeout: 2000,
      maxBuffer: 16 * 1024
    })
    const pid = Number(stdout.trim().split(/\s+/)[0])
    return Number.isInteger(pid) && pid > 1 ? pid : undefined
  } catch {
    return undefined
  }
}

function nativeMessage(error: string | undefined): string {
  switch (error) {
    case 'telegram_not_running':
      return '未发现正在运行的 Telegram Desktop'
    case 'bundle_mismatch':
      return '当前进程不是受支持的 Telegram Desktop'
    case 'accessibility_permission_required':
      return '需要在 macOS 系统设置中允许语屿控制 Telegram Desktop'
    case 'conversation_not_found':
      return '未找到对应的 Telegram 会话'
    case 'conversation_not_unique':
      return 'Telegram 中存在多个同名会话，无法安全定位'
    case 'compose_box_missing':
      return '当前 Telegram 会话没有可用的文字输入框'
    case 'channel_not_writable':
      return 'Telegram 频道不支持从这里发送消息'
    case 'echo_not_confirmed':
    case 'timeout':
    case 'native_process_failed':
    case 'native_response_invalid':
      return '未能确认发送结果，请检查 Telegram 目标会话'
    default:
      return 'Telegram 发送失败，请检查当前会话'
  }
}

export class TelegramDesktopSendService {
  private readonly options: Required<
    Pick<TelegramDesktopSendServiceOptions, 'helperPath' | 'resultTimeoutMs'>
  > &
    Pick<TelegramDesktopSendServiceOptions, 'discoverPid' | 'runOperation'>
  private pid: number | undefined
  private status: TelegramDesktopStatus | undefined
  private failure: string | undefined
  private refreshPromise: Promise<void> | undefined

  constructor(options: TelegramDesktopSendServiceOptions = {}) {
    this.options = {
      helperPath: options.helperPath ?? defaultHelperPath(),
      resultTimeoutMs: options.resultTimeoutMs ?? 4500,
      discoverPid: options.discoverPid,
      runOperation: options.runOperation
    }
  }

  get currentStatus(): TelegramDesktopStatus | undefined {
    return this.status ? { ...this.status } : undefined
  }

  health(): ProviderHealth {
    if (this.status?.state === 'ready' && this.status.textEntry) {
      return { state: 'ready', available: true, message: 'Telegram Desktop 文字发送已就绪' }
    }
    return {
      state: this.failure ? 'offline' : 'degraded',
      available: false,
      message: this.failure || 'Telegram Desktop 发送能力尚未加载'
    }
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise
    const refreshPromise = this.refreshInternal()
    this.refreshPromise = refreshPromise
    void refreshPromise.then(
      () => {
        if (this.refreshPromise === refreshPromise) this.refreshPromise = undefined
      },
      () => {
        if (this.refreshPromise === refreshPromise) this.refreshPromise = undefined
      }
    )
    return refreshPromise
  }

  async send(
    target: TelegramDesktopTarget,
    text: string
  ): Promise<{ accepted: boolean; error?: string }> {
    await this.refresh()
    const pid = this.pid
    const status = this.status
    if (!pid || !status || status.state !== 'ready' || !status.textEntry) {
      return { accepted: false, error: this.health().message || 'Telegram Desktop 发送能力不可用' }
    }
    const payload = { target, text }
    let submitted: TelegramDesktopResponse
    try {
      submitted = await this.run('send', pid, payload)
    } catch {
      return { accepted: false, error: nativeMessage('native_process_failed') }
    }
    if (submitted.state === 'echo_confirmed') return { accepted: true }
    if (submitted.state === 'outcome_unknown' || submitted.state === 'echo_not_confirmed') {
      return { accepted: false, error: nativeMessage('echo_not_confirmed') }
    }
    return { accepted: false, error: nativeMessage(submitted.error) }
  }

  private async refreshInternal(): Promise<void> {
    if (process.platform !== 'darwin') {
      this.pid = undefined
      this.status = undefined
      this.failure = 'Telegram Desktop 发送目前仅支持 macOS'
      return
    }
    const discover = this.options.discoverPid ?? defaultDiscoverPid
    const pid = await discover()
    this.pid = pid
    this.failure = undefined
    if (!pid) {
      this.status = undefined
      this.failure = nativeMessage('telegram_not_running')
      return
    }
    let response: TelegramDesktopResponse | undefined
    try {
      response = await this.run('status', pid)
    } catch {
      response = undefined
    }
    if (!response) {
      this.status = undefined
      this.failure = nativeMessage('native_response_invalid')
      return
    }
    this.status = this.toStatus(response)
    if (this.status.state !== 'ready' || !this.status.textEntry) {
      this.failure = nativeMessage(response.error)
    }
  }

  private async run(
    operation: string,
    pid: number,
    payload?: Record<string, unknown>
  ): Promise<TelegramDesktopResponse> {
    if (this.options.runOperation) return this.options.runOperation(operation, pid, payload)
    return await new Promise((resolve, reject) => {
      const child = spawn(this.options.helperPath, [operation, '--pid', String(pid)], {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true
      })
      let stdout = ''
      let settled = false
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        callback()
      }
      const timer = setTimeout(
        () =>
          finish(() => {
            child.kill()
            reject(new Error('native_timeout'))
          }),
        this.options.resultTimeoutMs
      )
      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString()
        if (stdout.length > 128 * 1024) {
          clearTimeout(timer)
          finish(() => reject(new Error('native_response_too_large')))
        }
      })
      child.on('error', () => {
        clearTimeout(timer)
        finish(() => reject(new Error('native_process_failed')))
      })
      child.on('close', () => {
        clearTimeout(timer)
        finish(() => {
          try {
            const parsed = JSON.parse(stdout.trim()) as unknown
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              reject(new Error('native_response_invalid'))
              return
            }
            resolve(parsed as TelegramDesktopResponse)
          } catch {
            reject(new Error('native_response_invalid'))
          }
        })
      })
      if (payload) child.stdin.write(JSON.stringify(payload))
      child.stdin.end()
    })
  }

  private toStatus(response: TelegramDesktopResponse): TelegramDesktopStatus {
    const state =
      response.state === 'ready'
        ? 'ready'
        : response.state === 'unavailable'
          ? 'unavailable'
          : 'error'
    return {
      state,
      appRunning: response.appRunning === true,
      bundleMatched: response.bundleMatched === true,
      accessibilityTrusted: response.accessibilityTrusted === true,
      textEntry: response.textEntry === true,
      ...(typeof response.error === 'string' ? { error: response.error } : {})
    }
  }
}
