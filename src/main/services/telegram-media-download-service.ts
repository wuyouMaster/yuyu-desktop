import { managedResourcePath } from '../runtime-paths'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { chmod, lstat, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { telegramRuntimeSendStateSchema } from './telegram-runtime-send-service'
import type { TelegramExportDocument, TelegramRuntimeMedia } from '../../shared/telegram-export'

const execute = promisify(execFile)
function helper(name: string): string { return managedResourcePath('telegram/' + name)! }

export interface TelegramMediaDownloadInput {
  document: TelegramExportDocument
  peerId: string
  messageId: string
  media: TelegramRuntimeMedia
  signal: AbortSignal
  assertCurrent: () => void
}

/** One verified native download request. The caller owns the runtime operation
 * lock and confirms complete bytes independently through TelegramMediaCache. */
export class TelegramMediaDownloadService {
  private reservedBytes = 0
  private readonly requested = new Set<string>()
  constructor(
    private readonly options: {
      outputRoot?: string
      readerPath?: string
      bridgePath?: string
      platform?: NodeJS.Platform
      /** Interpreter for synthetic helpers; native production helpers execute directly. */
      helperRuntime?: string
    } = {}
  ) {}
  reset(): void {
    this.reservedBytes = 0
    this.requested.clear()
  }

  async request(input: TelegramMediaDownloadInput): Promise<void> {
    const { media, signal } = input
    const assertCurrent = (): void => {
      signal.throwIfAborted()
      input.assertCurrent()
    }
    assertCurrent()
    if (
      (this.options.platform ?? process.platform) !== 'darwin' ||
      !media.cacheRefs.some((r) => r.role === 'full') ||
      !media.sizeBytes ||
      media.sizeBytes > 128 * 1024 * 1024
    )
      throw new Error('此附件暂不支持自动下载，请在 Telegram 中下载后重试')
    const readerPath = this.options.readerPath ?? helper('telegram-runtime-read')
    const { stdout } = await execute(
      this.options.helperRuntime ?? readerPath,
      [...(this.options.helperRuntime ? [readerPath] : []), '--active-media-state'],
      {
        timeout: 15000,
        maxBuffer: 16384,
        signal
      }
    )
    assertCurrent()
    const response = JSON.parse(stdout)
    const binding = telegramRuntimeSendStateSchema.parse(response.state)
    if (
      response.ok !== true ||
      binding.process.version !== '7.2.9' ||
      binding.process.pid !== input.document.runtime?.pid ||
      binding.selfId !== input.document.accountNativeId ||
      binding.peerId !== input.peerId ||
      Date.now() - binding.capturedAt > 2000 ||
      binding.capturedAt > Date.now()
    )
      throw new Error('Telegram 账号、会话或版本已变化，请重新连接后加载附件')
    const key = JSON.stringify([
      binding.process,
      binding.selfId,
      binding.peerId,
      input.messageId,
      media.id,
      media.sizeBytes
    ])
    // Never resubmit an ambiguous native call; a second click only rereads bytes.
    if (this.requested.has(key)) return
    if (this.requested.size >= 32 || this.reservedBytes + media.sizeBytes > 256 * 1024 * 1024)
      throw new Error('本次连接的附件下载已达 256 MiB 或 32 个限制，请重新连接后继续')
    let path: string | undefined
    if (media.kind !== 'photo') {
      const root =
        this.options.outputRoot ?? join(homedir(), 'Library/Caches/YUYU/telegram-downloads')
      await mkdir(root, { recursive: true, mode: 0o700 })
      if ((await realpath(root)) !== root || !(await lstat(root)).isDirectory())
        throw new Error('附件缓存目录不可用')
      await chmod(root, 0o700)
      const directory = await mkdtemp(join(root, 'download-'))
      await chmod(directory, 0o700)
      path = join(directory, 'attachment')
      await writeFile(path, Buffer.alloc(0), { flag: 'wx', mode: 0o600 })
    }
    assertCurrent()
    this.reservedBytes += media.sizeBytes
    this.requested.add(key)
    await new Promise<void>((resolve, reject) => {
      const bridgePath = this.options.bridgePath ?? helper('telegram-runtime-bridge')
      const child = spawn(
        this.options.helperRuntime ?? bridgePath,
        this.options.helperRuntime ? [bridgePath] : [],
        { stdio: ['pipe', 'pipe', 'ignore'] }
      )
      let failed = false,
        size = 0
      let force: ReturnType<typeof setTimeout> | undefined
      const chunks: Buffer[] = []
      const stop = (): void => {
        if (failed) return
        failed = true
        child.kill('SIGTERM')
        force = setTimeout(() => child.kill('SIGKILL'), 8000)
      }
      const timer = setTimeout(stop, 25000)
      child.stdout.on('data', (bytes: Buffer) => {
        size += bytes.length
        if (size > 16384) stop()
        else chunks.push(bytes)
      })
      child.on('error', stop)
      child.stdin.on('error', stop)
      signal.addEventListener('abort', stop, { once: true })
      child.once('close', (code) => {
        clearTimeout(timer)
        clearTimeout(force)
        signal.removeEventListener('abort', stop)
        try {
          assertCurrent()
          if (
            failed ||
            code !== 0 ||
            JSON.parse(Buffer.concat(chunks).toString()).state !== 'submitted'
          )
            throw new Error()
          resolve()
        } catch {
          reject(new Error('未能确认附件下载请求，请检查 Telegram 后重新加载；不会重复提交'))
        }
      })
      if (signal.aborted) stop()
      else
        child.stdin.end(
          JSON.stringify({
            operation: 'download',
            binding,
            download: {
              id: media.id,
              kind: media.kind,
              sizeBytes: media.sizeBytes,
              dataCenterId: media.dataCenterId,
              messageId: input.messageId,
              path
            }
          })
        )
    })
    // Keep the private download file: Telegram owns asynchronous completion and
    // stores its location. Removing it on cancellation would break the client.
    assertCurrent()
  }
}
