import { managedResourcePath } from '../runtime-paths'
import { spawn } from 'node:child_process'
import type { TelegramExportDocument } from '../../shared/telegram-export'
import type { TelegramRuntimeReader } from './telegram-runtime-reader'
import { effectiveTelegramHistory } from './telegram-history-state'

export type TelegramHistoryDirection = 'older' | 'newer'

function historyCancelled(): Error {
  return Object.assign(new Error('Telegram 历史补载已取消'), { name: 'AbortError' })
}

function pauseForHistory(signal?: AbortSignal, custom?: () => Promise<void>): Promise<void> {
  if (signal?.aborted) return Promise.reject(historyCancelled())
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: unknown): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    const abort = (): void => finish(historyCancelled())
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) return abort()
    if (custom)
      Promise.resolve()
        .then(custom)
        .then(() => finish(), finish)
    else timer = setTimeout(finish, 700)
  })
}

export class TelegramHistoryService {
  constructor(
    private readonly options: {
      run?: (
        operation: string,
        pid: number,
        payload: Record<string, unknown>,
        signal?: AbortSignal
      ) => Promise<void>
      pause?: () => Promise<void>
      helperPath?: string
    } = {}
  ) {}

  async step(input: {
    slot: number
    account: string
    peerId: string
    direction: TelegramHistoryDirection
    /** Internal, verified message ID for an explicit media reveal. */
    messageId?: string
    reader: Pick<TelegramRuntimeReader, 'read'>
    assertCurrent: () => void
    signal?: AbortSignal
  }): Promise<TelegramExportDocument> {
    const pendingDeadline = Date.now() + 6000
    let pendingReadsLeft = 6
    const assertCurrent = (): void => {
      if (input.signal?.aborted) throw historyCancelled()
      input.assertCurrent()
    }
    const read = async (): Promise<TelegramExportDocument> => {
      assertCurrent()
      let document: TelegramExportDocument | undefined
      for (let attempt = 0; ; attempt++) {
        try {
          document = await input.reader.read(input.slot, input.account)
          break
        } catch (error) {
          assertCurrent()
          if (attempt >= 2 || (error as { code?: string })?.code !== 'layout_or_snapshot_changed')
            throw error
          // Only re-sample; never repeat a navigation/scroll on an uncertain result.
          await pauseForHistory(input.signal, this.options.pause)
        }
      }
      assertCurrent()
      if (!document.runtime || document.runtime.activeSelfId !== document.accountNativeId)
        throw new Error('请在 Telegram Desktop 中切换到所选账号后再补载历史')
      return {
        ...document,
        conversations: document.conversations.map((chat) => ({
          ...chat,
          runtimeHistory: effectiveTelegramHistory(chat.runtimeHistory)
        }))
      }
    }
    const before = await read()
    const pid = before.runtime!.pid
    const run = (
      operation: string,
      pid: number,
      payload: Record<string, unknown>
    ): Promise<void> => {
      assertCurrent()
      if (this.options.run)
        return input.signal
          ? this.options.run(operation, pid, payload, input.signal)
          : this.options.run(operation, pid, payload)
      return runHelper(operation, pid, payload, input.signal, this.options.helperPath)
    }
    if (before.runtime!.activePeerId !== input.peerId) {
      // Desktop's official privatepost route accepts exact channel IDs, including
      // supergroups. Direct/basic-group peers must already be open in the client.
      const native = BigInt(input.peerId)
      if (native >> 48n !== 2n)
        throw new Error('请先在 Telegram Desktop 中打开此私聊或普通群，再补载历史')
      await run('prepare', pid, { peerId: input.peerId, selfId: before.accountNativeId })
    }
    const readTarget = async (): Promise<TelegramExportDocument> => {
      const document = await read()
      if (document.runtime!.pid !== pid || document.runtime!.activePeerId !== input.peerId)
        throw new Error('Telegram 进程或当前会话已变化，已停止补载')
      return document
    }
    const pause = (): Promise<void> => pauseForHistory(input.signal, this.options.pause)
    // A pending first page can temporarily have raw top/bottom=true. Wait for
    // the existing request, without dispatching another wheel or declaring an edge.
    const waitPending = async (
      document: TelegramExportDocument
    ): Promise<TelegramExportDocument> => {
      while (pendingReadsLeft > 0 && Date.now() < pendingDeadline) {
        const history = document.conversations.find(
          (chat) => chat.id === input.peerId
        )?.runtimeHistory
        if (history?.loadState !== 'pending') break
        --pendingReadsLeft
        assertCurrent()
        await pause()
        document = await readTarget()
      }
      return document
    }
    let prepared = await waitPending(await readTarget())
    let history = prepared.conversations.find((chat) => chat.id === input.peerId)?.runtimeHistory
    if (history?.loadState === 'pending') {
      if (input.messageId) throw new Error('Telegram 正在加载历史，请稍后定位附件')
      return prepared
    }
    if (
      !input.messageId &&
      (input.direction === 'older' ? history?.loadedAtTop : history?.loadedAtBottom)
    )
      return prepared
    // A channel's exact message link moves the viewport to a verified block
    // edge. A synthetic wheel alone can leave Qt's viewport in the middle of
    // the loaded window, while newly received messages disguise the stall.
    const blocks = history?.blockMessageIds
    if (input.messageId && BigInt(input.peerId) >> 48n !== 2n) {
      const chat = prepared.conversations.find((value) => value.id === input.peerId)
      if (
        !/^[1-9][0-9]{0,9}$/.test(input.messageId) ||
        BigInt(input.messageId) > 0x7fffffffn ||
        history?.loadState !== 'idle' ||
        !blocks?.includes(input.messageId) ||
        !chat?.messages.some((message) => message.id === input.messageId && message.runtimeMedia)
      )
        throw new Error('附件消息尚未在 Telegram 当前会话中加载，请先补载历史或在客户端打开附件')
      // The helper binds the message ID to native block geometry and a unique
      // AX rectangle. It may scroll to this loaded row; it never clicks media.
      await run('reveal', pid, {
        peerId: input.peerId,
        selfId: before.accountNativeId,
        messageId: input.messageId
      })
      await pause()
      return waitPending(await readTarget())
    }
    const anchor = input.messageId ?? (input.direction === 'older' ? blocks?.[0] : blocks?.at(-1))
    if (BigInt(input.peerId) >> 48n === 2n && anchor) {
      if (!/^[1-9][0-9]{0,9}$/.test(anchor) || BigInt(anchor) > 0x7fffffffn)
        throw new Error('Telegram 历史定位消息无效')
      await run('locate', pid, {
        peerId: input.peerId,
        selfId: before.accountNativeId,
        messageId: anchor
      })
      await pause()
      prepared = await waitPending(await readTarget())
      if (input.messageId) return prepared
      history = prepared.conversations.find((chat) => chat.id === input.peerId)?.runtimeHistory
      if (
        history?.loadState === 'pending' ||
        (input.direction === 'older' ? history?.loadedAtTop : history?.loadedAtBottom)
      )
        return prepared
    }
    assertCurrent()
    await run('step', pid, {
      peerId: input.peerId,
      selfId: before.accountNativeId,
      direction: input.direction
    })
    await pause()
    return waitPending(await readTarget())
  }
}

async function runHelper(
  operation: string,
  pid: number,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
  helperPath?: string
): Promise<void> {
  if (signal?.aborted) throw historyCancelled()
  const helper = helperPath ?? managedResourcePath('telegram/telegram-ax-history')
  if (!helper) throw new Error('请先安装 Telegram 应用运行时')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(helper, [operation, '--pid', String(pid)], {
      stdio: ['pipe', 'pipe', 'ignore']
    })
    let output = ''
    let failure: Error | undefined
    const stop = (error: Error): void => {
      failure ??= error
      // Do not settle here: dispose/the shared operation lock must keep waiting
      // until close confirms that the helper and its stdio have exited.
      child.kill('SIGKILL')
    }
    const abort = (): void => stop(historyCancelled())
    const timer = setTimeout(
      () => stop(new Error('Telegram 历史补载操作超时，请检查客户端')),
      12000
    )
    child.stdout.on('data', (value: Buffer) => {
      if (failure) return
      output += value.toString()
      if (output.length > 65536) stop(new Error('Telegram 历史补载响应过大'))
    })
    child.stdin.on('error', () => stop(new Error('Telegram 历史补载工具运行失败')))
    child.on('error', () => stop(new Error('Telegram 历史补载工具运行失败')))
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (failure) return reject(failure)
      if (code !== 0) return reject(new Error('Telegram 历史补载工具运行失败'))
      try {
        const response = JSON.parse(output)
        if (response.ok === true) return resolve()
        reject(
          new Error(
            response.error === 'accessibility_permission_required'
              ? '请在 macOS 辅助功能设置中允许控制 Telegram'
              : 'Telegram 无法定位或滚动此会话，请在客户端打开目标会话后重试'
          )
        )
      } catch {
        reject(new Error('Telegram 历史补载响应无效'))
      }
    })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) return abort()
    child.stdin.end(JSON.stringify(payload))
  })
}
