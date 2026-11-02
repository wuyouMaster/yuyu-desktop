import { managedResourcePath } from '../runtime-paths'
import { execFile, spawn } from 'node:child_process'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { MessageContent } from '../../shared/domain-entities'
import type { ProviderHealth } from '../../shared/data-source'

const execute = promisify(execFile)
const TERMINAL_STATES = new Set([
  'callback_success',
  'callback_error',
  'outcome_unknown',
  'rejected'
])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg'])
const AUDIO_EXTENSIONS = new Set(['.ogg', '.opus'])

export interface DingtalkNativeStatus {
  state: 'experimental' | 'unavailable' | 'error'
  session?: string
  profileMatched: boolean
  accountUnchanged: boolean
  textEntry: boolean
  imageEntry: boolean
  audioEntry: boolean
  deliveryVerified: false
  error?: string
}

export interface DingtalkNativeResponse {
  state?: string
  error?: string
  session?: string
  sent?: boolean
  [key: string]: unknown
}

export interface DingtalkNativeSendServiceOptions {
  appPath?: string
  buildPath?: string
  clientPath?: string
  discoverPid?: () => Promise<number | undefined>
  runOperation?: (
    operation: string,
    pid: number,
    payload?: Record<string, unknown>
  ) => Promise<DingtalkNativeResponse>
  pollIntervalMs?: number
  resultTimeoutMs?: number
}

function defaultClientPath(): string { return managedResourcePath('dingtalk/dtsend-client')! }

async function defaultDiscoverPid(): Promise<number | undefined> {
  try {
    const { stdout } = await execute('/usr/bin/pgrep', ['-x', 'DingTalk'], {
      timeout: 2000,
      maxBuffer: 16 * 1024
    })
    const pid = Number(stdout.trim().split(/\s+/)[0])
    return Number.isInteger(pid) && pid > 1 ? pid : undefined
  } catch {
    return undefined
  }
}

async function defaultRunOperation(
  operation: string,
  pid: number,
  payload: Record<string, unknown> | undefined,
  options: Required<Pick<DingtalkNativeSendServiceOptions, 'appPath' | 'buildPath' | 'clientPath'>>
): Promise<DingtalkNativeResponse> {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      options.clientPath,
      [operation, '--pid', String(pid), '--app', options.appPath, '--build', options.buildPath],
      { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }
    )
    let stdout = ''
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      callback()
    }
    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
      if (stdout.length > 128 * 1024) finish(() => reject(new Error('native_response_too_large')))
    })
    child.on('error', () => finish(() => reject(new Error('native_process_failed'))))
    child.on('close', () => {
      finish(() => {
        try {
          const parsed = JSON.parse(stdout.trim()) as unknown
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            reject(new Error('native_response_invalid'))
            return
          }
          resolve(parsed as DingtalkNativeResponse)
        } catch {
          reject(new Error('native_response_invalid'))
        }
      })
    })
    if (payload) child.stdin.write(JSON.stringify(payload))
    child.stdin.end()
  })
}

function nativeMessage(response: DingtalkNativeResponse): string {
  switch (response.error) {
    case 'account_changed':
      return '钉钉账号已变化，请重新加载发送能力'
    case 'confirmation_mismatch':
      return '钉钉发送会话已变化，请重新加载发送能力'
    case 'profile_mismatch':
      return '当前钉钉版本未匹配已验证的发送 profile'
    case 'audio_service_unavailable':
      return '当前钉钉语音发送入口不可用'
    case 'invalid_image':
    case 'unsupported_image_format':
      return '图片必须是 PNG 或 JPEG'
    case 'invalid_opus_audio_or_duration':
      return '语音必须是有效的 Ogg/Opus 文件，且不超过 60 秒'
    case 'native_load_failed_no_automatic_retry':
    case 'load_already_attempted_restart_dingtalk':
      return '钉钉发送组件加载失败，请完全退出并重新启动钉钉后再试'
    default:
      return '钉钉发送失败，请检查当前会话后重试'
  }
}

export class DingtalkNativeSendService {
  private readonly options: Required<
    Pick<
      DingtalkNativeSendServiceOptions,
      'appPath' | 'buildPath' | 'clientPath' | 'pollIntervalMs' | 'resultTimeoutMs'
    >
  > &
    Pick<DingtalkNativeSendServiceOptions, 'discoverPid' | 'runOperation'>
  private pid: number | undefined
  private loadAttemptedPid: number | undefined
  private status: DingtalkNativeStatus | undefined
  private failure: string | undefined
  private refreshPromise: Promise<void> | undefined

  constructor(options: DingtalkNativeSendServiceOptions = {}) {
    this.options = {
      appPath: options.appPath ?? '/Applications/DingTalk.app',
      buildPath:
        options.buildPath ??
        (managedResourcePath('dingtalk/dtstore')
          ? join(managedResourcePath('dingtalk/dtstore')!, '..')
          : '/tmp/yuyu-dtsend-build'),
      clientPath: options.clientPath ?? defaultClientPath(),
      pollIntervalMs: options.pollIntervalMs ?? 80,
      resultTimeoutMs: options.resultTimeoutMs ?? 5000,
      discoverPid: options.discoverPid,
      runOperation: options.runOperation
    }
  }

  get currentStatus(): DingtalkNativeStatus | undefined {
    return this.status ? { ...this.status } : undefined
  }

  health(): ProviderHealth {
    if (this.status?.state === 'experimental' && this.status.textEntry) {
      return { state: 'ready', available: true, message: '钉钉原生文字、图片和语音发送已加载' }
    }
    return {
      state: this.failure ? 'offline' : 'degraded',
      available: false,
      message: this.failure || '钉钉发送能力尚未加载'
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

  private async refreshInternal(): Promise<void> {
    const discover = this.options.discoverPid ?? defaultDiscoverPid
    const pid = await discover()
    this.pid = pid
    this.failure = undefined
    if (!pid) {
      this.status = undefined
      this.failure = '未发现正在运行的钉钉进程'
      return
    }

    const run = this.run.bind(this)
    let response: DingtalkNativeResponse | undefined
    try {
      response = await run('status', pid)
    } catch {
      response = undefined
    }
    if (response?.state === 'error' || !response) {
      if (this.loadAttemptedPid !== pid) {
        this.loadAttemptedPid = pid
        try {
          response = await run('load', pid)
        } catch {
          response = undefined
        }
      }
    }
    if (!response) {
      this.status = undefined
      this.failure = '无法连接钉钉原生发送组件'
      return
    }
    this.status = this.toStatus(response)
    if (this.status.state !== 'experimental' || !this.status.textEntry) {
      this.failure = nativeMessage(response)
    }
  }

  async send(cid: string, content: MessageContent): Promise<{ accepted: boolean; error?: string }> {
    await this.refresh()
    const pid = this.pid
    const status = this.status
    if (
      !pid ||
      !status ||
      status.state !== 'experimental' ||
      !status.session ||
      !status.textEntry
    ) {
      return { accepted: false, error: this.health().message || '钉钉发送能力不可用' }
    }
    const requestId = crypto.randomUUID()
    const payload: Record<string, unknown> = {
      id: requestId,
      kind: content.type,
      cid,
      confirmCid: cid,
      session: status.session
    }
    if (content.type === 'text') payload.text = content.text
    else if (content.type === 'image' || content.type === 'audio') {
      if (!content.localPath) return { accepted: false, error: '发送媒体缺少本地文件' }
      const extension = content.localPath.toLowerCase().slice(content.localPath.lastIndexOf('.'))
      const allowed = content.type === 'image' ? IMAGE_EXTENSIONS : AUDIO_EXTENSIONS
      if (!allowed.has(extension))
        return {
          accepted: false,
          error: content.type === 'image' ? '图片必须是 PNG 或 JPEG' : '语音必须是 Ogg/Opus 文件'
        }
      try {
        const file = await lstat(content.localPath)
        if (!file.isFile() || file.isSymbolicLink())
          return { accepted: false, error: '媒体文件必须是本地普通文件' }
      } catch {
        return { accepted: false, error: '媒体文件不存在或无法读取' }
      }
      payload.path = content.localPath
    } else {
      return { accepted: false, error: '钉钉当前只支持文字、图片和语音发送' }
    }

    const validated = await this.run('validate', pid, payload)
    if (validated.state !== 'validated') return { accepted: false, error: nativeMessage(validated) }
    const submitted = await this.run('send', pid, payload)
    if (submitted.state && TERMINAL_STATES.has(submitted.state)) {
      return submitted.state === 'callback_success'
        ? { accepted: true }
        : {
            accepted: false,
            error:
              submitted.state === 'outcome_unknown'
                ? '未能确认发送结果，请先检查目标会话'
                : nativeMessage(submitted)
          }
    }

    const deadline = Date.now() + this.options.resultTimeoutMs
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, this.options.pollIntervalMs))
      const result = await this.run('result', pid, { id: requestId })
      if (!result.state || !TERMINAL_STATES.has(result.state)) continue
      return result.state === 'callback_success'
        ? { accepted: true }
        : {
            accepted: false,
            error:
              result.state === 'outcome_unknown'
                ? '未能确认发送结果，请先检查目标会话'
                : nativeMessage(result)
          }
    }
    return { accepted: false, error: '未能确认发送结果，请先检查目标会话' }
  }

  private async run(
    operation: string,
    pid: number,
    payload?: Record<string, unknown>
  ): Promise<DingtalkNativeResponse> {
    if (this.options.runOperation) return this.options.runOperation(operation, pid, payload)
    return defaultRunOperation(operation, pid, payload, this.options)
  }

  private toStatus(response: DingtalkNativeResponse): DingtalkNativeStatus {
    const state =
      response.state === 'experimental'
        ? 'experimental'
        : response.state === 'unavailable'
          ? 'unavailable'
          : 'error'
    return {
      state,
      ...(typeof response.session === 'string' ? { session: response.session } : {}),
      profileMatched: response.profileMatched === true,
      accountUnchanged: response.accountUnchanged === true,
      textEntry: response.textEntry === true,
      imageEntry: response.imageEntry === true,
      audioEntry: response.audioEntry === true,
      deliveryVerified: false,
      ...(typeof response.error === 'string' ? { error: response.error } : {})
    }
  }
}
