import { RuntimeRpcError } from '../../shared/runtime-rpc'
import {
  WechatILinkClient,
  type RuntimeILinkLoginEvent,
  type RuntimeILinkMessage
} from './wechat-ilink-client'

export type RuntimeConnectorPhase = 'stopped' | 'starting' | 'polling' | 'stale_token' | 'error'
export interface RuntimeConnectorHost {
  /** Must durably accept the entire batch before resolving. Redelivery is possible. */
  onMessages(messages: readonly RuntimeILinkMessage[], signal: AbortSignal): Promise<void>
  onPhaseChange?(phase: RuntimeConnectorPhase, code?: string): void
  onLoginEvent?(event: RuntimeILinkLoginEvent): void
  onDiagnostic?(code: string): void
}
export interface OwnedILinkClient {
  client: WechatILinkClient
  close(): Promise<void>
}
type Connection = OwnedILinkClient & {
  owner: string
  account: string
  abort: AbortController
  task?: Promise<void>
  cleanup?: Promise<void>
}
const cancelled = () => new RuntimeRpcError('CANCELLED')
const errorCode = (e: unknown) =>
  e instanceof RuntimeRpcError ? e.code : 'ILINK_APPLICATION_FAILED'
const fatal = new Set([
  'INCOMPATIBLE_RUNTIME',
  'CAPABILITY_UNAVAILABLE',
  'INVALID_RUNTIME_RESPONSE',
  'ILINK_SESSION_CLOSED',
  'ILINK_OWNER_NOT_FOUND',
  'TRANSPORT_CLOSED',
  'PROCESS_EXITED'
])
function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(cancelled())
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(cancelled())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** Application orchestration only. Native runtime owns all wire requests, credentials,
 * cursor/context persistence, CDN encryption, typing tickets and heartbeat timers.
 * A client factory returns an owned, verified runtime transport, never a shared singleton.
 */
export class RuntimeWechatConnectorService {
  private phase: RuntimeConnectorPhase = 'stopped'
  private connection?: Connection
  private login?: { abort: AbortController; task: Promise<void>; submit?: (code: string) => void }
  private queue: Promise<unknown> = Promise.resolve()
  private revision = 0
  private pending?: AbortController
  private cleanupFailure?: unknown
  constructor(
    private readonly root: string,
    private readonly create: () => Promise<OwnedILinkClient>,
    private readonly host: RuntimeConnectorHost,
    private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void> = delay
  ) {}
  getPhase() {
    return this.phase
  }
  getActiveAccountId() {
    return this.connection?.account
  }
  isRunning() {
    return this.phase === 'polling'
  }
  isLoginInProgress() {
    return this.login !== undefined
  }
  private setPhase(phase: RuntimeConnectorPhase, code?: string) {
    this.phase = phase
    // Observer failures must never change acknowledgement or native cleanup behavior.
    try {
      this.host.onPhaseChange?.(phase, code)
    } catch {
      /* notification only */
    }
  }
  private report(code: string) {
    try {
      this.host.onDiagnostic?.(code)
    } catch {
      /* notification only */
    }
  }
  private transition<T>(work: (revision: number, signal: AbortSignal) => Promise<T>): Promise<T> {
    const revision = ++this.revision
    this.pending?.abort()
    this.connection?.abort.abort()
    this.login?.abort.abort()
    const abort = new AbortController()
    this.pending = abort
    const result = this.queue.then(async () => {
      if (revision !== this.revision) throw cancelled()
      return work(revision, abort.signal)
    })
    this.queue = result.catch(() => undefined)
    return result
  }
  async listAccounts() {
    const owned = await this.create()
    try {
      return await owned.client.accounts(this.root)
    } finally {
      await owned.close()
    }
  }
  start(account: string): Promise<void> {
    return this.transition(async (_revision, signal) => {
      await this.stopCurrent()
      if (signal.aborted) throw cancelled()
      this.setPhase('starting')
      const owned = await this.create()
      let owner: string | undefined
      try {
        if (signal.aborted) throw cancelled()
        owner = await owned.client.open(this.root, account, signal)
        if (signal.aborted) throw cancelled()
        const abort = new AbortController()
        const connection: Connection = { ...owned, owner, account, abort }
        this.connection = connection
        // Notification is best-effort; connection/poll failures remain visible.
        try {
          await owned.client.notify(owner, 'start', signal)
        } catch {
          this.report('ILINK_START_NOTICE_FAILED')
        }
        if (signal.aborted) {
          abort.abort()
          throw cancelled()
        }
        this.setPhase('polling')
        connection.task = this.poll(connection)
      } catch (error) {
        this.connection = undefined
        try {
          if (owner) await owned.client.close(owner)
        } finally {
          await owned.close()
        }
        this.setPhase(signal.aborted ? 'stopped' : 'error', errorCode(error))
        throw error
      }
    })
  }
  private async poll(connection: Connection) {
    const { client, owner, abort } = connection
    let failures = 0
    try {
      while (!abort.signal.aborted) {
        try {
          const count = await client.consumeOnce(
            owner,
            (messages) => {
              if (abort.signal.aborted) throw cancelled()
              return this.host.onMessages(messages, abort.signal)
            },
            abort.signal
          )
          if (failures) this.report('ILINK_POLL_RECOVERED')
          failures = 0
          // Some servers can return an immediate empty batch; avoid a busy loop.
          if (!count) await this.sleep(50, abort.signal)
        } catch (error) {
          if (abort.signal.aborted) return
          const code = errorCode(error)
          if (code === 'ILINK_STALE_TOKEN') {
            this.setPhase('stale_token', code)
            return
          }
          if (fatal.has(code)) {
            this.setPhase('error', code)
            return
          }
          if (code === 'ILINK_TIMEOUT') continue
          this.report(
            code === 'ILINK_APPLICATION_FAILED' ? 'ILINK_DELIVERY_FAILED' : 'ILINK_POLL_FAILED'
          )
          await this.sleep(++failures >= 3 ? 30000 : 2000, abort.signal)
        }
      }
    } catch (error) {
      if (!abort.signal.aborted) this.setPhase('error', errorCode(error))
    } finally {
      if (!abort.signal.aborted) {
        try {
          await this.releaseConnection(connection)
        } catch (error) {
          this.cleanupFailure = error
          this.setPhase('error', 'ILINK_CLEANUP_FAILED')
        }
        if (this.connection === connection) this.connection = undefined
      }
    }
  }
  private releaseConnection(c: Connection): Promise<void> {
    c.cleanup ??= (async () => {
      let failure: unknown
      try {
        await c.client.notify(c.owner, 'stop')
      } catch {
        this.report('ILINK_STOP_NOTICE_FAILED')
      }
      try {
        await c.client.close(c.owner)
      } catch (error) {
        failure = error
      }
      try {
        await c.close()
      } catch (error) {
        failure ??= error
      }
      if (failure) throw failure
    })()
    return c.cleanup
  }
  private requireConnection(account?: string) {
    const value = this.connection
    if (this.phase === 'stale_token') throw new RuntimeRpcError('ILINK_STALE_TOKEN')
    if (!value || this.phase !== 'polling' || value.abort.signal.aborted)
      throw new RuntimeRpcError('ILINK_NOT_CONNECTED')
    if (account && account !== value.account) throw new RuntimeRpcError('ILINK_ACCOUNT_MISMATCH')
    return value
  }
  sendText(input: {
    to: string
    text: string
    contextToken?: string
    accountId?: string
    signal?: AbortSignal
  }) {
    const c = this.requireConnection(input.accountId)
    return c.client.sendPlainText(c.owner, input.to, input.text, input.signal, input.contextToken)
  }
  sendMediaFile(input: {
    root: string
    path: string
    to: string
    kind: 'image' | 'video' | 'file'
    contextToken?: string
    accountId?: string
    signal?: AbortSignal
  }) {
    const c = this.requireConnection(input.accountId)
    return c.client.sendMediaFile(
      c.owner,
      {
        root: input.root,
        path: input.path,
        to: input.to,
        kind: input.kind,
        ...(input.contextToken ? { contextToken: input.contextToken } : {})
      },
      input.signal
    )
  }
  resolveContextToken(accountId: string | undefined, to: string) {
    const c = this.requireConnection(accountId)
    return c.client.resolveContextToken(c.owner, to)
  }
  sendMediaURL(input: {
    url: string
    to: string
    kind: 'image' | 'video' | 'file'
    contextToken?: string
    accountId?: string
    signal?: AbortSignal
  }) {
    const c = this.requireConnection(input.accountId)
    return c.client.sendMediaURL(
      c.owner,
      {
        url: input.url,
        to: input.to,
        kind: input.kind,
        ...(input.contextToken ? { contextToken: input.contextToken } : {})
      },
      input.signal
    )
  }
  downloadMedia(input: {
    mediaId: string
    root: string
    path: string
    accountId?: string
    signal?: AbortSignal
  }) {
    const c = this.requireConnection(input.accountId)
    return c.client.downloadMedia(c.owner, input.mediaId, input.root, input.path, input.signal)
  }
  async beginTyping(input: {
    to: string
    accountId?: string
    signal?: AbortSignal
    contextToken?: string
  }) {
    const c = this.requireConnection(input.accountId)
    try {
      return await c.client.beginTyping(c.owner, input.to, input.signal, input.contextToken)
    } catch (error) {
      if (input.signal?.aborted || c.abort.signal.aborted) throw cancelled()
      this.report('ILINK_TYPING_UNAVAILABLE')
      // Typing is optional presentation; report failure instead of claiming activation.
      return { stop: async () => undefined }
    }
  }
  startLogin(): Promise<void> {
    return this.transition(async (_revision, signal) => {
      await this.stopCurrent()
      if (signal.aborted) throw cancelled()
      this.setPhase('starting')
      const abort = new AbortController()
      const login = {
        abort,
        task: Promise.resolve(),
        submit: undefined as ((code: string) => void) | undefined
      }
      this.login = login
      let timedOut = false
      const deadline = setTimeout(() => {
        timedOut = true
        abort.abort()
      }, 480000)
      const forward = () => abort.abort()
      signal.addEventListener('abort', forward, { once: true })
      login.task = (async () => {
        let owned: OwnedILinkClient | undefined
        let owner: string | undefined
        try {
          owned = await this.create()
          if (abort.signal.aborted) throw cancelled()
          const first = await owned.client.beginLogin(this.root, abort.signal)
          owner = first.ownerId
          let event = first.event
          while (!abort.signal.aborted) {
            // Install the resolver before notifying observers, allowing immediate input.
            let verification: Promise<string> | undefined
            if (event.status === 'need_verifycode') {
              verification = new Promise<string>((resolve, reject) => {
                const cancel = () => {
                  login.submit = undefined
                  reject(cancelled())
                }
                if (abort.signal.aborted) {
                  cancel()
                  return
                }
                abort.signal.addEventListener('abort', cancel, { once: true })
                login.submit = (value) => {
                  abort.signal.removeEventListener('abort', cancel)
                  login.submit = undefined
                  resolve(value)
                }
              })
            }
            try {
              this.host.onLoginEvent?.(event)
            } catch {
              this.report('ILINK_LOGIN_OBSERVER_FAILED')
            }
            if (event.status === 'confirmed') {
              this.setPhase('stopped')
              return
            }
            const code = verification ? await verification : ''
            event = await owned.client.pollLogin(owner, code, abort.signal)
          }
        } catch (error) {
          if (timedOut) this.setPhase('error', 'ILINK_LOGIN_TIMEOUT')
          else if (!abort.signal.aborted) this.setPhase('error', errorCode(error))
        } finally {
          clearTimeout(deadline)
          let failure: unknown
          try {
            if (owned && owner) await owned.client.close(owner)
          } catch (error) {
            failure = error
          }
          try {
            await owned?.close()
          } catch (error) {
            failure ??= error
          }
          signal.removeEventListener('abort', forward)
          if (this.login === login) this.login = undefined
          if (failure) {
            this.cleanupFailure = failure
            this.setPhase('error', 'ILINK_CLEANUP_FAILED')
            throw failure
          }
        }
      })()
      // Retain the original task for stop(), but mark rejection handled during normal operation.
      void login.task.catch(() => undefined)
    })
  }
  submitVerifyCode(code: string) {
    if (!/^\d{1,64}$/.test(code) || !this.login?.submit)
      throw new RuntimeRpcError('ILINK_VERIFY_CODE_NOT_REQUESTED')
    this.login.submit(code)
  }
  private async stopCurrent() {
    const login = this.login
    login?.abort.abort()
    let failure: unknown = this.cleanupFailure
    this.cleanupFailure = undefined
    try {
      await login?.task
    } catch (error) {
      failure = error
    }
    const c = this.connection
    this.connection = undefined
    if (c) {
      c.abort.abort()
      try {
        await c.task
      } catch (error) {
        failure ??= error
      }
      try {
        await this.releaseConnection(c)
      } catch (error) {
        failure ??= error
      }
    }
    if (failure) {
      this.setPhase('error', 'ILINK_CLEANUP_FAILED')
      throw failure
    }
    this.setPhase('stopped')
  }
  stop(): Promise<void> {
    return this.transition(async () => this.stopCurrent())
  }
  cancelLogin(): Promise<void> {
    return this.stop()
  }
}
