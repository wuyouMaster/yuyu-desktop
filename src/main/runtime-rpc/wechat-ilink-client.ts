import { z } from 'zod'
import { isAbsolute } from 'node:path'
import { mediaRelativePathSchema } from '../../shared/wechat-media-files-protocol'
import { RuntimeRpcError, type RuntimeJson } from '../../shared/runtime-rpc'
import { wechatStorageDescriptionSchema } from '../../shared/wechat-storage-protocol'
import type { DatabaseRpcTransport } from './wechat-database-client'

const ownerId = z.string().regex(/^[a-f0-9]{48}$/)
const accountId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const account = z.object({ accountId, wechatUserId: z.string() }).strict()
const message = z
  .object({
    accountId,
    fromUserId: z.string().min(1),
    messageId: z.string(),
    messageType: z.number().int(),
    items: z.array(z.object({ type: z.number().int(), text: z.string().optional() }).strict()),
    receivedAt: z.number().int().nonnegative(),
    seq: z
      .string()
      .regex(/^-?\d+$/)
      .optional(),
    sessionId: z.string().optional(),
    groupId: z.string().optional(),
    contextToken: z.string().optional()
  })
  .strict()
const batch = z
  .object({ batchId: z.string().regex(/^[a-f0-9]{32}$/), messages: z.array(message) })
  .strict()
const loginEvent = z.discriminatedUnion('status', [
  z.object({ status: z.literal('qrcode'), qrContent: z.string().min(1) }).strict(),
  z
    .object({ status: z.literal('confirmed'), accountId, wechatUserId: z.string().optional() })
    .strict(),
  z
    .object({
      status: z.enum([
        'wait',
        'scaned',
        'need_verifycode',
        'verify_code_blocked',
        'expired',
        'scaned_but_redirect'
      ])
    })
    .strict()
])
export type RuntimeILinkMessage = z.infer<typeof message>
export type RuntimeILinkLoginEvent = z.infer<typeof loginEvent>
function check<T>(schema: z.ZodType<T>, value: unknown, code = 'INVALID_RUNTIME_RESPONSE'): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new RuntimeRpcError(code)
  return result.data
}

/** Main-process protocol consumer. Credentials and upstream HTTP stay in the runtime. */
export class WechatILinkClient {
  private methods?: Set<string>
  constructor(private readonly rpc: DatabaseRpcTransport) {}
  private async call(
    method: string,
    params: RuntimeJson,
    signal?: AbortSignal,
    timeoutMs = 30000,
    sideEffect = false
  ) {
    if (!this.methods)
      this.methods = new Set(
        check(
          wechatStorageDescriptionSchema,
          await this.rpc.callAsync('runtime.describe', {}, { signal }),
          'INCOMPATIBLE_RUNTIME'
        ).methods
      )
    if (!this.methods.has(method)) throw new RuntimeRpcError('CAPABILITY_UNAVAILABLE')
    return this.rpc.callAsync(method, params, { signal, timeoutMs, sideEffect })
  }
  async accounts(root: string) {
    check(z.string().min(1), root, 'INVALID_ARGUMENT')
    return check(z.array(account), await this.call('ilink.accounts', { root }))
  }
  async open(root: string, id: string, signal?: AbortSignal) {
    check(z.string().min(1), root, 'INVALID_ARGUMENT')
    check(accountId, id, 'INVALID_ARGUMENT')
    const value = check(
      z.object({ ownerId }).strict(),
      await this.call('ilink.open', { root, accountId: id }, signal)
    )
    return value.ownerId
  }
  async close(owner: string) {
    check(ownerId, owner, 'INVALID_ARGUMENT')
    check(z.literal(true), await this.call('ilink.close', { ownerId: owner }))
  }
  async poll(owner: string, signal?: AbortSignal) {
    check(ownerId, owner, 'INVALID_ARGUMENT')
    return check(batch, await this.call('ilink.poll', { ownerId: owner }, signal, 125000))
  }
  async acknowledge(owner: string, id: string, signal?: AbortSignal) {
    check(ownerId, owner, 'INVALID_ARGUMENT')
    check(batch.shape.batchId, id, 'INVALID_ARGUMENT')
    check(
      z.literal(true),
      await this.call('ilink.ack', { ownerId: owner, batchId: id }, signal, 30000, true)
    )
  }
  /** A failing handler leaves the entire batch pending. Consumers must deduplicate by messageId. */
  async consumeOnce(
    owner: string,
    deliver: (messages: readonly RuntimeILinkMessage[]) => Promise<void>,
    signal?: AbortSignal
  ) {
    const value = await this.poll(owner, signal)
    await deliver(value.messages)
    if (signal?.aborted) throw new RuntimeRpcError('CANCELLED')
    await this.acknowledge(owner, value.batchId, signal)
    return value.messages.length
  }
  async sendPlainText(owner: string, to: string, text: string, signal?: AbortSignal) {
    check(ownerId, owner, 'INVALID_ARGUMENT')
    check(z.string().trim().min(1), to, 'INVALID_ARGUMENT')
    check(z.string().trim().min(1), text, 'INVALID_ARGUMENT')
    return check(
      z.object({ clientId: z.string().regex(/^yuyu-[a-f0-9]{32}$/) }).strict(),
      await this.call('ilink.sendPlainText', { ownerId: owner, to, text }, signal, 20000, true)
    )
  }
  async sendMediaFile(
    owner: string,
    input: { root: string; path: string; to: string; kind: 'image' | 'video' | 'file' },
    signal?: AbortSignal
  ) {
    check(ownerId, owner, 'INVALID_ARGUMENT')
    const value = check(
      z
        .object({
          root: z.string().refine(isAbsolute),
          path: mediaRelativePathSchema,
          to: z.string().trim().min(1),
          kind: z.enum(['image', 'video', 'file'])
        })
        .strict(),
      input,
      'INVALID_ARGUMENT'
    )
    return check(
      z
        .object({
          clientId: z.string().regex(/^yuyu-[a-f0-9]{32}$/),
          itemType: z.union([z.literal(2), z.literal(4), z.literal(5)])
        })
        .strict(),
      await this.call('ilink.sendMediaFile', { ownerId: owner, ...value }, signal, 95000, true)
    )
  }
  async notify(owner: string, action: 'start' | 'stop', signal?: AbortSignal) {
    check(ownerId, owner, 'INVALID_ARGUMENT')
    check(z.enum(['start', 'stop']), action, 'INVALID_ARGUMENT')
    check(
      z.literal(true),
      await this.call('ilink.notify', { ownerId: owner, action }, signal, 5000, true)
    )
  }
  async beginTyping(owner: string, to: string, signal?: AbortSignal) {
    check(ownerId, owner, 'INVALID_ARGUMENT')
    check(z.string().trim().min(1).max(1024), to, 'INVALID_ARGUMENT')
    const value = check(
      z.object({ leaseId: z.string().regex(/^[a-f0-9]{32}$/) }).strict(),
      await this.call('ilink.typingBegin', { ownerId: owner, to }, signal, 25000, true)
    )
    let stopping: Promise<void> | undefined
    return {
      stop: (): Promise<void> => {
        stopping ??= (async () => {
          check(
            z.literal(true),
            await this.call(
              'ilink.typingEnd',
              { ownerId: owner, leaseId: value.leaseId },
              undefined,
              5000,
              true
            )
          )
        })()
        return stopping
      }
    }
  }
  async beginLogin(root: string, signal?: AbortSignal) {
    check(z.string().min(1), root, 'INVALID_ARGUMENT')
    return check(
      z.object({ ownerId, event: loginEvent }).strict(),
      await this.call('ilink.loginBegin', { root }, signal, 25000, true)
    )
  }
  async pollLogin(
    owner: string,
    verifyCode = '',
    signal?: AbortSignal
  ): Promise<RuntimeILinkLoginEvent> {
    check(ownerId, owner, 'INVALID_ARGUMENT')
    check(z.string().max(64), verifyCode, 'INVALID_ARGUMENT')
    return check(
      loginEvent,
      await this.call('ilink.loginPoll', { ownerId: owner, verifyCode }, signal, 40000, true)
    )
  }
}
