import { basename, dirname, extname, isAbsolute } from 'node:path'
import { RuntimeRpcError } from '../../shared/runtime-rpc'
import type {
  WechatConnectorAccount,
  WechatConnectorHost
} from '../../shared/wechat-connector-port'
import { RuntimeWechatConnectorService, type OwnedILinkClient } from './wechat-connector-service'
import type { RuntimeILinkLoginEvent } from './wechat-ilink-client'
import { markdownToPlainText } from './message-formatting'

/** Preserves the product connector interface without importing private HTTP,
 * token stores, CDN keys or platform helpers into the public application. */
export class ApplicationWechatConnector {
  private host: WechatConnectorHost = {}
  private accounts: WechatConnectorAccount[] = []
  private loginRequested = false
  private loginRevision = 0
  private events: Promise<void> = Promise.resolve()
  private readonly core: RuntimeWechatConnectorService
  constructor(
    root: string,
    create: () => Promise<OwnedILinkClient>,
    private readonly encodeQR: (content: string) => Promise<string>
  ) {
    this.core = new RuntimeWechatConnectorService(root, create, {
      onMessages: async (messages) => {
        if (!this.host.onMessages) throw new RuntimeRpcError('ILINK_DELIVERY_HANDLER_MISSING')
        await this.host.onMessages(
          messages.map((m) => ({ ...m, items: m.items.map((i) => ({ ...i })) }))
        )
      },
      onPhaseChange: (phase, code) => this.host.onPhaseChange?.(phase, code),
      onDiagnostic: (code) => this.host.onLog?.('warn', code),
      onLoginEvent: (event) => {
        const revision = this.loginRevision
        this.events = this.events
          .then(() => this.loginEvent(event, revision))
          .catch(() => {
            if (revision === this.loginRevision)
              this.host.onPhaseChange?.('error', 'ILINK_LOGIN_PRESENTATION_FAILED')
          })
      }
    })
  }
  setHost(host: WechatConnectorHost): void {
    const observe = (run: () => void): void => {
      try {
        run()
      } catch {
        /* UI observers cannot change transport ownership. */
      }
    }
    this.host = {
      onMessages: host.onMessages,
      onLog: (level, message) => observe(() => host.onLog?.(level, message)),
      onPhaseChange: (phase, code) => observe(() => host.onPhaseChange?.(phase, code)),
      onLoginEvent: (event) => observe(() => host.onLoginEvent?.(event))
    }
  }
  async refreshAccounts(): Promise<WechatConnectorAccount[]> {
    const accounts = await this.core.listAccounts()
    this.accounts = accounts
    return this.listAccounts()
  }
  listAccounts(): WechatConnectorAccount[] {
    return this.accounts.map((v) => ({ ...v }))
  }
  getPhase() {
    return this.core.getPhase()
  }
  getActiveAccountId() {
    return this.core.getActiveAccountId()
  }
  isRunning() {
    return this.core.isRunning()
  }
  isLoginInProgress() {
    return this.loginRequested || this.core.isLoginInProgress()
  }
  start(accountId: string) {
    return this.core.start(accountId)
  }
  async stop(): Promise<void> {
    this.loginRevision++
    await this.core.stop()
    await this.events
  }
  startLogin(): void {
    if (this.isLoginInProgress()) return
    this.loginRequested = true
    this.loginRevision++
    void this.core
      .startLogin()
      .catch(() => this.host.onPhaseChange?.('error', 'ILINK_LOGIN_FAILED'))
      .finally(() => {
        this.loginRequested = false
      })
  }
  cancelLogin(): void {
    this.loginRevision++
    void this.core
      .cancelLogin()
      .catch(() => this.host.onPhaseChange?.('error', 'ILINK_CLEANUP_FAILED'))
  }
  submitVerifyCode(code: string): void {
    this.core.submitVerifyCode(code)
  }
  private async loginEvent(event: RuntimeILinkLoginEvent, revision: number): Promise<void> {
    if (revision !== this.loginRevision) return
    if (event.status === 'qrcode') {
      const qrCodeDataUrl = await this.encodeQR(event.qrContent)
      if (!qrCodeDataUrl.startsWith('data:image/png;base64,'))
        throw new RuntimeRpcError('INVALID_QR_IMAGE')
      if (revision === this.loginRevision)
        this.host.onLoginEvent?.({ status: 'qrcode', qrCodeDataUrl })
    } else if (event.status === 'confirmed') {
      this.host.onLoginEvent?.({ status: 'confirmed' })
      await this.refreshAccounts()
      if (revision === this.loginRevision)
        this.host.onLoginEvent?.({
          status: 'active',
          accountId: event.accountId,
          wechatUserId: event.wechatUserId ?? ''
        })
    } else if (event.status !== 'scaned_but_redirect')
      this.host.onLoginEvent?.({ status: event.status })
  }
  resolveContextToken(account: string | undefined, to: string): string | undefined {
    if (!this.isRunning()) return undefined
    return this.core.resolveContextToken(account, to)
  }
  async sendText(input: {
    to: string
    text: string
    accountId?: string
    contextToken?: string
    signal?: AbortSignal
  }) {
    const plainText = markdownToPlainText(input.text)
    if (!plainText) throw new RuntimeRpcError('INVALID_ARGUMENT')
    return { ...(await this.core.sendText({ ...input, text: plainText })), plainText }
  }
  sendMediaPath(input: {
    to: string
    filePath: string
    accountId?: string
    contextToken?: string
    signal?: AbortSignal
  }) {
    if (!isAbsolute(input.filePath)) throw new RuntimeRpcError('INVALID_ARGUMENT')
    const extension = extname(input.filePath).toLowerCase()
    const kind = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(extension)
      ? 'image'
      : ['.mp4', '.mov', '.webm', '.mkv', '.avi'].includes(extension)
        ? 'video'
        : 'file'
    return this.core.sendMediaFile({
      ...input,
      root: dirname(input.filePath),
      path: basename(input.filePath),
      kind
    })
  }
  sendMediaUrl(input: {
    to: string
    mediaUrl: string
    accountId?: string
    contextToken?: string
    signal?: AbortSignal
  }) {
    return this.core.sendMediaURL({ ...input, url: input.mediaUrl, kind: 'file' })
  }
  downloadMedia(input: Parameters<RuntimeWechatConnectorService['downloadMedia']>[0]) {
    return this.core.downloadMedia(input)
  }
  async beginTyping(input: {
    to: string
    accountId?: string
    contextToken?: string
    signal?: AbortSignal
  }) {
    const lease = await this.core.beginTyping(input)
    return {
      stop: async () => {
        try {
          await lease.stop()
        } catch {
          this.host.onLog?.('warn', 'ILINK_TYPING_CLEANUP_FAILED')
        }
      }
    }
  }
}
