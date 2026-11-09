import type { RuntimeRpcClient } from './client'
import { RuntimeRpcError, type RuntimeJson } from '../../shared/runtime-rpc'
import { telegramStorageDescriptionSchema } from '../../shared/telegram-storage-protocol'
import {
  telegramMacOSInspectionSchema,
  telegramMacOSConversationsRequestSchema,
  telegramMacOSConversationsSchema,
  telegramMacOSMessagesRequestSchema,
  telegramMacOSMessagesSchema,
  type TelegramMacOSConversationsRequest,
  type TelegramMacOSMessagesRequest
} from '../../shared/telegram-macos-protocol'

const dto = (value: unknown): RuntimeJson => JSON.parse(JSON.stringify(value)) as RuntimeJson
// The protocol orders serialized peer identifiers, not signed numbers or time.
const peerOrder = (peer: string): bigint => BigInt.asUintN(64, BigInt(peer))

/** Owns one native-reader RPC process. Never starts Desktop bridges or send helpers. */
export class TelegramMacOSClient {
  private ready?: Promise<void>
  private methods = new Set<string>()
  private closed = false
  private closing?: Promise<void>

  constructor(private readonly rpc: Pick<RuntimeRpcClient, 'call' | 'close'>) {}

  private assertOpen(): void {
    if (this.closed) throw new RuntimeRpcError('SESSION_CLOSED')
  }

  private async requireMethods(methods: string[]): Promise<void> {
    this.assertOpen()
    this.ready ??= this.rpc.call('runtime.describe', {}).then((value) => {
      const parsed = telegramStorageDescriptionSchema.safeParse(value)
      if (!parsed.success) throw new RuntimeRpcError('INCOMPATIBLE_RUNTIME')
      if (!parsed.data.clientTypes?.includes('telegram-macos'))
        throw new RuntimeRpcError('CAPABILITY_UNAVAILABLE')
      this.methods = new Set(parsed.data.methods)
    })
    await this.ready
    this.assertOpen()
    if (methods.some((method) => !this.methods.has(method)))
      throw new RuntimeRpcError('CAPABILITY_UNAVAILABLE')
  }

  async inspect(root: string, appPath: string) {
    await this.requireMethods(['client.inspect', 'macos.conversations', 'macos.messages'])
    const value = await this.rpc.call('client.inspect', {
      clientType: 'telegram-macos',
      root,
      appPath
    })
    this.assertOpen()
    const parsed = telegramMacOSInspectionSchema.safeParse(value)
    if (!parsed.success) throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
    return parsed.data
  }

  async conversations(options: TelegramMacOSConversationsRequest) {
    const params = telegramMacOSConversationsRequestSchema.parse(options)
    await this.requireMethods(['macos.conversations', 'macos.messages'])
    const value = await this.rpc.call('macos.conversations', dto(params))
    this.assertOpen()
    const parsed = telegramMacOSConversationsSchema.safeParse(value)
    if (!parsed.success) throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
    const page = parsed.data
    if (
      page.candidateId !== params.candidateId ||
      page.items.length > params.limit ||
      page.items.some(
        (item, index) =>
          (params.beforePeer !== undefined &&
            peerOrder(item.peerId) >= peerOrder(params.beforePeer)) ||
          (index > 0 && peerOrder(item.peerId) >= peerOrder(page.items[index - 1].peerId))
      ) ||
      (page.nextPeer !== undefined &&
        (page.nextPeer === params.beforePeer || page.nextPeer !== page.items.at(-1)?.peerId))
    )
      throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
    return page
  }

  async messages(options: TelegramMacOSMessagesRequest) {
    const params = telegramMacOSMessagesRequestSchema.parse(options)
    await this.requireMethods(['macos.messages'])
    const value = await this.rpc.call('macos.messages', dto(params))
    this.assertOpen()
    const parsed = telegramMacOSMessagesSchema.safeParse(value)
    if (!parsed.success) throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
    const page = parsed.data
    if (
      page.candidateId !== params.candidateId ||
      page.items.length > params.limit ||
      page.items.some(
        (item, index) =>
          (params.peerId && item.peerId !== params.peerId) ||
          (params.beforeKey && item.key >= params.beforeKey) ||
          (index > 0 && item.key >= page.items[index - 1].key)
      ) ||
      (page.nextKey !== undefined && page.nextKey !== page.items.at(-1)?.key)
    )
      throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
    return page
  }

  close(): Promise<void> {
    this.closed = true
    return (this.closing ??= this.rpc.close())
  }
}
