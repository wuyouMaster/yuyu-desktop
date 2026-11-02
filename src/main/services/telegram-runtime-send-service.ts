import { managedResourcePath } from '../runtime-paths'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { ProviderHealth } from '../../shared/data-source'
import type {
  TelegramExportDocument,
  TelegramExportConversation
} from '../../shared/telegram-export'
import { TelegramRuntimeReader } from './telegram-runtime-reader'
import { prepareTelegramSendImage, type TelegramSendImage } from './telegram-send-image'
import { prepareTelegramSendVoice } from './telegram-send-voice'
import {
  prepareTelegramSendFile,
  prepareTelegramSendSticker,
  type TelegramSendFile
} from './telegram-send-file'
import {
  withTelegramRuntimeOperation,
  TelegramRuntimeBusyError,
  type TelegramRuntimeOperationOwner
} from './telegram-runtime-operation'

const execute = promisify(execFile)
const positiveId = z.string().regex(/^[1-9][0-9]{0,19}$/)

/** Send-only contract. Native must bind this state to Telegram's unique visible window and composer,
 * not a disk active slot, selected background history, title or AX label.
 * Missing/unknown/locked state must return { ok: false }, never guessed fields.
 */
export const telegramRuntimeSendStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    capturedAt: z.number().int().positive(),
    process: z
      .object({
        pid: z.number().int().min(2),
        // Process birth time from the OS, in microseconds, as a decimal string.
        startedAt: positiveId,
        bundleId: z.literal('com.tdesktop.Telegram'),
        arch: z.literal('arm64')
      })
      .extend({
        version: z.enum(['7.2.5', '7.2.9']),
        build: z.enum(['7.2.5', '7.2.9']),
        executableSha256: z.string(),
        loadedImageUuid: z.string()
      })
      .strict()
      .refine((process) => {
        const builds = {
          '7.2.5': [
            '1e713a7dde8bd3fb459705e1b7b6cac5ecdf6388c45b20b9be0d5064dc95b892',
            '65241564-DD2D-363B-8486-203E8476981E'
          ],
          '7.2.9': [
            '4693a25e73540f3cefd72323708b9b5fddcb22c810d01b27d746150bbe425b50',
            '95F83BFB-7DD1-3DEC-ADD1-2D9CE9B52130'
          ]
        }
        const [hash, uuid] = builds[process.version]
        return (
          process.build === process.version &&
          process.executableSha256 === hash &&
          process.loadedImageUuid === uuid
        )
      }),
    activeSlot: z.number().int().min(0).max(5),
    selfId: positiveId.refine((value) => BigInt(value) < 1n << 48n),
    peerId: positiveId.refine((value) => BigInt(value) < 1n << 64n),
    // Opaque generation token, stable across text entry. Changes with account,
    // session, Telegram window, peer, topic, or compose/edit/reply mode.
    composerToken: z.string().regex(/^[a-f0-9]{64}$/),
    composerMode: z.enum(['new', 'edit', 'reply', 'unknown']),
    canSendText: z.boolean()
  })
  .strict()

export type TelegramRuntimeSendState = z.infer<typeof telegramRuntimeSendStateSchema>

export interface TelegramRuntimeSendBinding {
  account: string
  slot: number
}

export interface TelegramRuntimeSendResult {
  accepted: boolean
  nativeMessageId?: string
  nativeMessageIds?: string[]
  error?: string
}

export interface TelegramRuntimeSendServiceOptions extends TelegramRuntimeSendBinding {
  /** Bound to the unified connection generation, checked after every await. */
  isCurrent: () => boolean
  operationOwner?: TelegramRuntimeOperationOwner
  platform?: NodeJS.Platform
  readerPath?: string
  helperPath?: string
  bridgePath?: string
  /** Return a NEW observation on every call; never a cached UI/provider snapshot. */
  readActiveState?: () => Promise<unknown>
  probeTransport?: (pid: number) => Promise<boolean>
  probeVoiceTransport?: () => Promise<boolean>
  readSnapshot?: (slot: number, account: string) => Promise<TelegramExportDocument>
  /** Pure synthetic test seam; MUST NOT launch native/UI work. Production uses the close-bound child below. */
  submit?: (
    binding: TelegramRuntimeSendState,
    text: string,
    signal: AbortSignal,
    image?: TelegramSendImage,
    file?: TelegramSendFile,
    album?: TelegramSendImage[]
  ) => Promise<unknown>
  operationTimeoutMs?: number
  confirmationTimeoutMs?: number
  pollIntervalMs?: number
}

const unavailable = 'Telegram runtime 发送需要原生前台账号及输入框身份校验'
const unknownOutcome = '未能确认发送结果，请检查 Telegram 目标会话；不会自动重试'
const changed = 'Telegram 当前账号、进程或输入会话已变化，请重新选择目标会话'

// Only fixed helper codes may cross the provider boundary. Never forward an
// arbitrary native error string, stdout, request, or exception message.
const nativeFailureCodes = new Set([
  'bridge_preflight_failed',
  'runtime_request_invalid',
  'runtime_text_clipboard_unavailable',
  'runtime_text_clipboard_changed',
  'runtime_text_cancelled',
  'runtime_text_paste_timeout',
  'runtime_modal_ui_present',
  'runtime_image_invalid',
  'runtime_file_invalid',
  'runtime_sticker_mode_required',
  'runtime_album_mode_required',
  'runtime_file_mode_required',
  'runtime_file_mode_focus',
  'runtime_file_mode_timeout',
  'runtime_image_timeout',
  'runtime_image_timeout_caption',
  'runtime_image_ui_changed',
  'runtime_image_cancelled',
  'runtime_image_photo_mode_required',
  'runtime_image_clipboard_changed',
  'runtime_image_clipboard_unavailable',
  'runtime_activation_failed',
  'runtime_read_state_unavailable',
  'runtime_binding_mismatch',
  'runtime_draft_value_unavailable',
  'runtime_draft_nonempty',
  'runtime_preflight_failed',
  'runtime_identity_or_composer_changed',
  'runtime_input_unavailable',
  'native_response_invalid',
  'compose_box_missing',
  'telegram_not_running',
  'bundle_mismatch',
  'accessibility_permission_required',
  ...[
    'not_frontmost',
    'window_missing',
    'node_limit',
    'composer_missing',
    'composer_not_unique'
  ].map((reason) => 'runtime_prepare_failed:' + reason),
  ...[
    'application_not_ready',
    'window_missing',
    'focused_element_missing',
    'composer_identity_mismatch',
    'not_enabled',
    'not_focused',
    'value_not_settable'
  ].map((reason) => 'runtime_focused_input_missing:' + reason),
  // Public AXError values kAXErrorFailure through kAXErrorNotEnoughPrecision.
  ...Array.from({ length: 15 }, (_, index) => -25200 - index).flatMap((code) => [
    'runtime_prepare_failed:focus_set_' + code,
    'runtime_focused_input_missing:value_settable_' + code
  ])
])

function sanitizedNativeFailure(value: unknown): string {
  return typeof value === 'string' && value.length <= 128 && nativeFailureCodes.has(value)
    ? value
    : 'native_error_unrecognized'
}

function helperPath(name: string): string { return managedResourcePath('telegram/' + name)! }

function accountFor(selfId: string): string {
  return (
    'telegram-local:' +
    createHash('sha256')
      .update((BigInt(selfId) | (0x80n << 48n)).toString())
      .digest('hex')
      .slice(0, 24)
  )
}

function sameBinding(a: TelegramRuntimeSendState, b: TelegramRuntimeSendState): boolean {
  return (
    a.process.pid === b.process.pid &&
    a.process.startedAt === b.process.startedAt &&
    a.activeSlot === b.activeSlot &&
    a.selfId === b.selfId &&
    a.peerId === b.peerId &&
    a.composerToken === b.composerToken
  )
}

function validDuration(value: number | undefined, fallback: number, maximum: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.min(value, maximum)
    : fallback
}

async function bounded<T>(operation: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(unavailable)), ms)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

export class TelegramRuntimeSendService {
  readonly account: string
  readonly slot: number
  private available = false
  private failure = unavailable
  private readonly operationTimeoutMs: number
  private readonly confirmationTimeoutMs: number
  private readonly pollIntervalMs: number
  private readonly readerPath: string
  private readonly senderPath: string
  private readonly reader = new TelegramRuntimeReader()
  private refreshPromise?: Promise<void>

  constructor(private readonly options: TelegramRuntimeSendServiceOptions) {
    this.account = options.account
    this.slot = options.slot
    this.readerPath = options.readerPath ?? helperPath('telegram-runtime-read')
    this.senderPath = options.helperPath ?? helperPath('telegram-ax-send')
    this.operationTimeoutMs = validDuration(options.operationTimeoutMs, 15000, 30000)
    this.confirmationTimeoutMs = validDuration(options.confirmationTimeoutMs, 20000, 60000)
    this.pollIntervalMs = validDuration(options.pollIntervalMs, 250, 5000)
  }

  health(): ProviderHealth {
    return this.available && this.options.isCurrent()
      ? {
          state: 'ready',
          available: true,
          message: 'Telegram 文字发送已就绪，请确保客户端设置为 Enter 发送'
        }
      : { state: 'degraded', available: false, message: this.failure }
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = (async () => {
      try {
        await withTelegramRuntimeOperation(async () => {
          const state = await this.activeState()
          await this.transportReady(state.process.pid)
          this.assertCurrent()
          this.available = true
        }, this.options.operationOwner)
      } catch {
        this.available = false
        this.failure = unavailable
      }
    })()
    try {
      await this.refreshPromise
    } finally {
      this.refreshPromise = undefined
    }
  }

  async send(peerId: string, text: string): Promise<TelegramRuntimeSendResult> {
    if (!positiveId.safeParse(peerId).success || BigInt(peerId) >= 1n << 64n)
      return { accepted: false, error: 'Telegram 会话标识无效' }
    // Preserve exact whitespace and case. The native helper and echo check use the same text.
    if (
      typeof text !== 'string' ||
      !text.trim() ||
      Array.from(text).length > 4096 ||
      text.includes('\r') ||
      text.includes('\0')
    )
      return { accepted: false, error: 'Telegram 文字须为 1–4096 个字符且不含回车或空字符' }
    try {
      return await withTelegramRuntimeOperation(
        (signal) => this.sendExclusive(peerId, text, signal),
        this.options.operationOwner
      )
    } catch (error) {
      return {
        accepted: false,
        error: error instanceof TelegramRuntimeBusyError ? error.message : changed
      }
    }
  }

  async sendImage(
    peerId: string,
    path: string,
    caption: string
  ): Promise<TelegramRuntimeSendResult> {
    if (
      !positiveId.safeParse(peerId).success ||
      typeof caption !== 'string' ||
      !caption.trim() ||
      Array.from(caption).length > 1024 ||
      caption.includes('\r') ||
      caption.includes('\0')
    )
      return { accepted: false, error: '图片须有 1–1024 字的说明文字' }
    let prepared: Awaited<ReturnType<typeof prepareTelegramSendImage>> | undefined
    try {
      return await withTelegramRuntimeOperation(async (signal) => {
        this.assertCurrent()
        const binding = await this.activeState()
        if (binding.peerId !== peerId || binding.peerId !== binding.selfId)
          return {
            accepted: false,
            error: '当前图片发送仅支持 Telegram Saved Messages，请先在客户端打开收藏夹'
          }
        prepared = await prepareTelegramSendImage(path)
        signal.throwIfAborted()
        return this.sendExclusive(peerId, caption, signal, prepared.image)
      }, this.options.operationOwner)
    } catch (error) {
      return {
        accepted: false,
        error:
          error instanceof TelegramRuntimeBusyError
            ? error.message
            : '图片发送未完成，请确认 PNG 格式、大小及 Telegram 当前会话'
      }
    } finally {
      await prepared?.dispose()
    }
  }

  async sendFile(
    peerId: string,
    path: string,
    caption: string
  ): Promise<TelegramRuntimeSendResult> {
    if (
      !positiveId.safeParse(peerId).success ||
      typeof caption !== 'string' ||
      !caption.trim() ||
      Array.from(caption).length > 1024 ||
      caption.includes('\r') ||
      caption.includes('\0')
    )
      return { accepted: false, error: '文件须有 1–1024 字的说明文字' }
    try {
      return await withTelegramRuntimeOperation(async (signal) => {
        this.assertCurrent()
        const binding = await this.activeState()
        if (binding.peerId !== peerId || binding.peerId !== binding.selfId)
          return {
            accepted: false,
            error: '当前文件发送仅支持 Telegram Saved Messages，请先在客户端打开收藏夹'
          }
        const prepared = await prepareTelegramSendFile(path)
        try {
          signal.throwIfAborted()
          return await this.sendExclusive(peerId, caption, signal, undefined, prepared.file)
        } finally {
          await prepared.dispose()
        }
      }, this.options.operationOwner)
    } catch (error) {
      return {
        accepted: false,
        error:
          error instanceof TelegramRuntimeBusyError
            ? error.message
            : '文件发送未完成，请确认文件非空、不超过 32 MiB，且 Telegram 当前会话正确'
      }
    }
  }

  async sendSticker(peerId: string, path: string): Promise<TelegramRuntimeSendResult> {
    if (!positiveId.safeParse(peerId).success)
      return { accepted: false, error: 'Telegram 会话标识无效' }
    try {
      return await withTelegramRuntimeOperation(async (signal) => {
        this.assertCurrent()
        const binding = await this.activeState()
        if (binding.peerId !== peerId || peerId !== binding.selfId)
          return { accepted: false, error: '请先在 Telegram 打开 Saved Messages' }
        const prepared = await prepareTelegramSendSticker(path)
        try {
          signal.throwIfAborted()
          return await this.sendExclusive(peerId, '', signal, undefined, prepared.file)
        } finally {
          await prepared.dispose()
        }
      }, this.options.operationOwner)
    } catch (error) {
      return {
        accepted: false,
        error:
          error instanceof TelegramRuntimeBusyError
            ? error.message
            : '贴纸发送未完成，请选择 512 KiB 以内、宽高不超过 512 像素的静态 WebP'
      }
    }
  }

  async sendVoice(peerId: string, path: string): Promise<TelegramRuntimeSendResult> {
    if (!positiveId.safeParse(peerId).success)
      return { accepted: false, error: 'Telegram 会话标识无效' }
    try {
      return await withTelegramRuntimeOperation(async (signal) => {
        this.assertCurrent()
        const binding = await this.activeState()
        if (
          binding.process.version !== '7.2.9' ||
          binding.peerId !== peerId ||
          peerId !== binding.selfId
        )
          return {
            accepted: false,
            error: '语音发送需 Telegram 7.2.9，并在客户端打开 Saved Messages'
          }
        const prepared = await prepareTelegramSendVoice(path, signal)
        try {
          return await this.sendExclusive(peerId, '', signal, undefined, prepared.file)
        } finally {
          await prepared.dispose()
        }
      }, this.options.operationOwner)
    } catch (error) {
      return {
        accepted: false,
        error:
          error instanceof TelegramRuntimeBusyError
            ? error.message
            : '语音发送未完成，请检查本地音频、FFmpeg 和 Telegram 当前会话'
      }
    }
  }

  async sendAlbum(
    peerId: string,
    paths: string[],
    caption: string
  ): Promise<TelegramRuntimeSendResult> {
    if (
      !positiveId.safeParse(peerId).success ||
      !Array.isArray(paths) ||
      paths.length < 2 ||
      paths.length > 10 ||
      new Set(paths).size !== paths.length ||
      typeof caption !== 'string' ||
      !caption.trim() ||
      Array.from(caption).length > 1024 ||
      /[\r\0]/.test(caption)
    )
      return { accepted: false, error: '相册须为 2–10 张不同的 PNG 图片，并填写 1–1024 字说明' }
    try {
      return await withTelegramRuntimeOperation(async (signal) => {
        this.assertCurrent()
        const binding = await this.activeState()
        if (binding.peerId !== peerId || peerId !== binding.selfId)
          return { accepted: false, error: '请先在 Telegram 打开 Saved Messages' }
        const prepared: Awaited<ReturnType<typeof prepareTelegramSendImage>>[] = []
        try {
          for (const path of paths) {
            signal.throwIfAborted()
            this.assertCurrent()
            prepared.push(await prepareTelegramSendImage(path))
          }
          return await this.sendExclusive(
            peerId,
            caption,
            signal,
            undefined,
            undefined,
            prepared.map((p) => p.image)
          )
        } finally {
          await Promise.all(prepared.map((p) => p.dispose()))
        }
      }, this.options.operationOwner)
    } catch (error) {
      return {
        accepted: false,
        error:
          error instanceof TelegramRuntimeBusyError
            ? error.message
            : '相册发送未完成，请确认每张 PNG 不超过 5 MiB、1280 像素，且当前 Telegram 会话正确'
      }
    }
  }

  private async sendExclusive(
    peerId: string,
    text: string,
    signal: AbortSignal,
    image?: TelegramSendImage,
    file?: TelegramSendFile,
    album?: TelegramSendImage[]
  ): Promise<TelegramRuntimeSendResult> {
    this.available = false
    let dispatched = false
    try {
      this.assertCurrent()
      signal.throwIfAborted()
      const binding = await this.activeState()
      if (
        binding.peerId !== peerId ||
        ((image || file || album) && binding.peerId !== binding.selfId)
      )
        throw new Error(changed)
      await this.transportReady(
        binding.process.pid,
        Boolean(image),
        Boolean(file),
        file?.kind === 'sticker',
        Boolean(album)
      )
      if (file?.kind === 'voice') {
        if (binding.process.version !== '7.2.9') throw new Error(unavailable)
        const ready = this.options.probeVoiceTransport
          ? await this.options.probeVoiceTransport()
          : JSON.parse(
              (
                await execute(
                  this.options.bridgePath ?? helperPath('telegram-runtime-bridge'),
                  ['--self-test'],
                  {
                    timeout: this.operationTimeoutMs,
                    maxBuffer: 16384
                  }
                )
              ).stdout
            ).runtimeVoiceProtocol === 1
        if (!ready) throw new Error(unavailable)
      }
      const baseline = await this.snapshot(binding, peerId)
      const seen = new Set(baseline.messages.map((message) => message.id))
      const highWater = baseline.messages.reduce(
        (max, message) => (BigInt(message.id) > max ? BigInt(message.id) : max),
        0n
      )
      await this.activeState(binding)
      const startedAt = Date.now()
      this.assertCurrent()
      signal.throwIfAborted()
      dispatched = true
      // Callback/AX echo is never delivery evidence. After an attempted dispatch,
      // even a process failure is reconciled using read-only runtime snapshots.
      try {
        const response = await this.submit(binding, text, signal, image, file, album)
        if (
          response &&
          typeof response === 'object' &&
          (response as { state?: unknown }).state === 'failed'
        ) {
          const code = sanitizedNativeFailure((response as { error?: unknown }).error)
          this.failure = `Telegram 原生发送未提交，请检查前台账号、目标输入框及草稿（native: ${code}）`
          return { accepted: false, error: this.failure }
        }
      } catch {
        /* Ambiguous submission: observe once or until the bounded deadline. */
      }
      this.assertCurrent()
      signal.throwIfAborted()
      const deadline = Date.now() + this.confirmationTimeoutMs
      do {
        signal.throwIfAborted()
        const remaining = (): number => Math.max(1, deadline - Date.now())
        await bounded(() => this.activeState(binding), remaining())
        signal.throwIfAborted()
        const current = await bounded(() => this.snapshot(binding, peerId), remaining())
        signal.throwIfAborted()
        await bounded(() => this.activeState(binding), remaining())
        signal.throwIfAborted()
        if (Date.now() > deadline) break
        if (album) {
          const candidates = current.messages.filter(
            (message) =>
              !seen.has(message.id) &&
              BigInt(message.id) > highWater &&
              message.senderId === binding.selfId &&
              message.outgoing === true &&
              message.type === 'message' &&
              message.runtimeMedia?.kind === 'photo' &&
              message.groupedId &&
              typeof message.dateMs === 'number' &&
              message.dateMs >= Math.floor(startedAt / 1000) * 1000 &&
              message.dateMs <= Date.now() + 1000
          )
          const groups = [...new Set(candidates.map((m) => m.groupedId))].map((id) =>
            candidates.filter((m) => m.groupedId === id)
          )
          const expected = album
            .map((i) => `${i.width}x${i.height}`)
            .sort()
            .join(',')
          const confirmed = groups.filter(
            (group) =>
              group.length === album.length &&
              current.messages.filter((m) => m.groupedId === group[0].groupedId).length ===
                album.length &&
              group.filter((m) => m.text === text).length === 1 &&
              group.every((m) => !m.text || m.text === text) &&
              group
                .map((m) => `${m.runtimeMedia!.width}x${m.runtimeMedia!.height}`)
                .sort()
                .join(',') === expected
          )
          if (confirmed.length > 1) break
          if (confirmed.length === 1) {
            this.available = true
            const ids = confirmed[0].map((m) => m.id)
            return { accepted: true, nativeMessageId: ids[0], nativeMessageIds: ids }
          }
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(this.pollIntervalMs, remaining()))
          )
          continue
        }
        const matches = current.messages.filter(
          (message) =>
            !seen.has(message.id) &&
            BigInt(message.id) > highWater &&
            message.senderId === binding.selfId &&
            message.outgoing === true &&
            (message.text ?? '') === text &&
            message.type === 'message' &&
            (file
              ? Boolean(
                  message.runtimeMedia &&
                  (file.kind === 'sticker'
                    ? message.runtimeMedia.kind === 'sticker'
                    : file.kind === 'voice'
                      ? message.runtimeMedia.kind === 'voice' &&
                        Math.abs(
                          (message.runtimeMedia.durationMs ?? -10000) - (file.durationMs ?? 0)
                        ) < 1000
                      : message.runtimeMedia.kind !== 'photo') &&
                  (file.kind === 'voice' || message.runtimeMedia.fileName === file.name) &&
                  message.runtimeMedia.sizeBytes === file.sizeBytes
                )
              : image
                ? message.runtimeMedia?.kind === 'photo' &&
                  message.runtimeMedia.width === image.width &&
                  message.runtimeMedia.height === image.height
                : !message.mediaType &&
                  (message.extensions?.telegram as { media?: unknown } | undefined)?.media ===
                    '') &&
            typeof message.dateMs === 'number' &&
            message.dateMs >= Math.floor(startedAt / 1000) * 1000 &&
            message.dateMs <= Date.now() + 1000
        )
        if (matches.length > 1) break // Concurrent identical sends are ambiguous.
        if (matches.length === 1) {
          this.available = true
          return { accepted: true, nativeMessageId: matches[0].id }
        }
        if (Date.now() >= deadline) break
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(this.pollIntervalMs, remaining()))
        )
      } while (Date.now() < deadline)
      this.failure = unknownOutcome
      return { accepted: false, error: unknownOutcome }
    } catch {
      this.failure = dispatched ? unknownOutcome : changed
      return { accepted: false, error: this.failure }
    }
  }

  private async activeState(
    expected?: TelegramRuntimeSendState
  ): Promise<TelegramRuntimeSendState> {
    this.assertCurrent()
    if (
      (this.options.platform ?? process.platform) !== 'darwin' ||
      !Number.isInteger(this.slot) ||
      this.slot < 0 ||
      this.slot > 5 ||
      !/^telegram-local:[a-f0-9]{24}$/.test(this.account)
    )
      throw new Error(unavailable)
    const started = Date.now()
    const response = await bounded(async () => {
      if (this.options.readActiveState) return this.options.readActiveState()
      const { stdout } = await execute(this.readerPath, ['--active-send-state'], {
        timeout: this.operationTimeoutMs,
        maxBuffer: 16 * 1024
      })
      return JSON.parse(stdout) as unknown
    }, this.operationTimeoutMs)
    this.assertCurrent()
    const envelope = z
      .object({ ok: z.literal(true), state: telegramRuntimeSendStateSchema })
      .strict()
      .safeParse(response)
    if (!envelope.success) throw new Error(unavailable)
    const state = envelope.data.state
    if (
      state.capturedAt < started ||
      state.capturedAt > Date.now() ||
      Date.now() - state.capturedAt > 2000 ||
      state.activeSlot !== this.slot ||
      state.composerMode !== 'new' ||
      !state.canSendText ||
      accountFor(state.selfId) !== this.account ||
      (expected && !sameBinding(state, expected))
    )
      throw new Error(changed)
    return state
  }

  private async snapshot(
    binding: TelegramRuntimeSendState,
    peerId: string
  ): Promise<TelegramExportConversation> {
    this.assertCurrent()
    const started = Date.now()
    const document = await bounded(
      () =>
        this.options.readSnapshot
          ? this.options.readSnapshot(this.slot, this.account)
          : this.reader.read(this.slot, this.account),
      this.operationTimeoutMs
    )
    this.assertCurrent()
    if (
      document.origin !== 'runtime' ||
      document.accountKey !== this.account ||
      document.accountNativeId !== binding.selfId ||
      document.runtime?.pid !== binding.process.pid ||
      document.runtime?.activeSelfId !== binding.selfId ||
      document.runtime?.activePeerId !== peerId ||
      !document.capturedAt ||
      document.capturedAt < started ||
      document.capturedAt > Date.now()
    )
      throw new Error(changed)
    const peers = document.conversations.filter((conversation) => conversation.id === peerId)
    if (peers.length !== 1 || !['direct', 'group'].includes(peers[0].kind)) throw new Error(changed)
    const peer = peers[0]
    const ids = new Set<string>()
    for (const message of peer.messages) {
      if (
        !positiveId.safeParse(message.id).success ||
        BigInt(message.id) >= 1n << 31n ||
        ids.has(message.id)
      )
        throw new Error(changed)
      ids.add(message.id)
    }
    return peer
  }

  private async transportReady(
    pid: number,
    image = false,
    file = false,
    sticker = false,
    album = false
  ): Promise<void> {
    const ready = await bounded(async () => {
      if (this.options.probeTransport) return this.options.probeTransport(pid)
      const { stdout } = await execute(this.senderPath, ['status', '--pid', String(pid)], {
        timeout: this.operationTimeoutMs,
        maxBuffer: 16 * 1024
      })
      const status = JSON.parse(stdout) as Record<string, unknown>
      return (
        status.runtimeSendProtocol === 1 &&
        (!image || status.runtimeImageProtocol === 1) &&
        (!file || status.runtimeFileProtocol === 1) &&
        (!sticker || status.runtimeStickerProtocol === 1) &&
        (!album || status.runtimeAlbumProtocol === 1) &&
        status.state === 'ready' &&
        status.appRunning === true &&
        status.bundleMatched === true &&
        status.accessibilityTrusted === true &&
        status.textEntry === true
      )
    }, this.operationTimeoutMs)
    this.assertCurrent()
    if (!ready) throw new Error(unavailable)
  }

  private assertCurrent(): void {
    if (!this.options.isCurrent()) throw new Error(changed)
  }

  private async submit(
    binding: TelegramRuntimeSendState,
    text: string,
    signal: AbortSignal,
    image?: TelegramSendImage,
    file?: TelegramSendFile,
    album?: TelegramSendImage[]
  ): Promise<unknown> {
    this.assertCurrent()
    signal.throwIfAborted()
    if (this.options.submit) {
      // Bound synthetic adapters too; real UI children must never use this seam
      // because a timeout race cannot prove that native work has stopped.
      return bounded(
        () =>
          album
            ? this.options.submit!(binding, text, signal, undefined, undefined, album)
            : file
              ? this.options.submit!(binding, text, signal, undefined, file)
              : image
                ? this.options.submit!(binding, text, signal, image)
                : this.options.submit!(binding, text, signal),
        this.operationTimeoutMs
      )
    }
    // No secrets/text in argv or forwarded child errors. This operation never
    // invokes the legacy title-based `send` operation.
    return new Promise((resolve, reject) => {
      const child = spawn(
        file?.kind === 'voice'
          ? (this.options.bridgePath ?? helperPath('telegram-runtime-bridge'))
          : this.senderPath,
        file?.kind === 'voice'
          ? []
          : [
              album
                ? 'runtime-album'
                : file?.kind === 'sticker'
                  ? 'runtime-sticker'
                  : file
                    ? 'runtime-file'
                    : image
                      ? 'runtime-image'
                      : 'runtime-send',
              '--pid',
              String(binding.process.pid),
              '--runtime-reader',
              this.readerPath
            ],
        { stdio: ['pipe', 'pipe', 'ignore'] }
      )
      let failed = false
      let size = 0
      const chunks: Buffer[] = []
      let forceStop: ReturnType<typeof setTimeout> | undefined
      const stop = (): void => {
        if (failed) return
        failed = true
        // Abort dispatch is synchronous. Keep the lock until `close`, including
        // spawn/stream errors and timeout; `exit` alone does not close stdio.
        if (image || file || album || binding.process.version === '7.2.9') {
          // Let any clipboard-using helper restore its temporary contents.
          child.kill('SIGTERM')
          forceStop = setTimeout(() => child.kill('SIGKILL'), 8000)
        } else child.kill('SIGKILL')
      }
      const collect = (chunk: Buffer): void => {
        size += chunk.length
        if (size > 16 * 1024) stop()
        else chunks.push(chunk)
      }
      const timer = setTimeout(stop, image || file || album ? 30000 : this.operationTimeoutMs)
      child.stdout.on('data', collect)
      child.on('error', stop)
      child.stdin.on('error', stop)
      signal.addEventListener('abort', stop, { once: true })
      child.once('close', (code) => {
        clearTimeout(timer)
        clearTimeout(forceStop)
        signal.removeEventListener('abort', stop)
        child.stdout.removeListener('data', collect)
        child.removeListener('error', stop)
        child.stdin.removeListener('error', stop)
        if (failed || signal.aborted || code !== 0) {
          reject(new Error(unknownOutcome))
          return
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
        } catch {
          reject(new Error(unknownOutcome))
        }
      })
      if (signal.aborted) stop()
      else
        child.stdin.end(
          JSON.stringify({
            ...(file?.kind === 'voice' ? { operation: 'voice', voice: file } : {}),
            binding,
            text,
            ...(image ? { image } : {}),
            ...(file ? { file } : {}),
            ...(album ? { album } : {})
          })
        )
    })
  }
}
