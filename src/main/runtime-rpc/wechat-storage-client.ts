import { z } from 'zod'
import type { AccountIdentityPort, LocalAccountIdentity } from '../../shared/account-identity-port'
import type { MessageParserPort, ParsedContent } from '../../shared/message-parser-port'
import { RuntimeRpcError, type RuntimeJson } from '../../shared/runtime-rpc'
import {
  wechatStorageDescriptionSchema,
  localAccountIdentitySchema,
  parsedMessageSchema,
  derivedImageKeysSchema
} from '../../shared/wechat-storage-protocol'

interface SyncTransport {
  call(method: string, params: RuntimeJson): RuntimeJson
}
const dto = (value: unknown): RuntimeJson => {
  try {
    return JSON.parse(JSON.stringify(value)) as RuntimeJson
  } catch {
    throw new RuntimeRpcError('INVALID_ARGUMENT')
  }
}

/** Public protocol adapter, with no fallback to private parsing or cryptography. */
export class WechatStorageClient implements AccountIdentityPort, MessageParserPort {
  private methods?: Set<string>
  constructor(private readonly rpc: SyncTransport) {}
  private call<T>(method: string, params: unknown, schema: z.ZodType<T>): T {
    if (!this.methods) {
      const description = wechatStorageDescriptionSchema.safeParse(
        this.rpc.call('runtime.describe', {})
      )
      if (!description.success) throw new RuntimeRpcError('INCOMPATIBLE_RUNTIME')
      this.methods = new Set(description.data.methods)
    }
    if (!this.methods.has(method)) throw new RuntimeRpcError('CAPABILITY_UNAVAILABLE')
    const response = schema.safeParse(this.rpc.call(method, dto(params)))
    if (!response.success) throw new RuntimeRpcError('INVALID_RUNTIME_RESPONSE')
    return response.data
  }
  readLocalAccountIdentity(root: string): LocalAccountIdentity | null {
    return this.call('identity.read', { root }, localAccountIdentitySchema)
  }
  accountDirectoryBelongsToIdentity(directory: string, wxid: string): boolean {
    return this.call('identity.matches', { directory, wxid }, z.boolean())
  }
  deriveAccountWxid(directory: string): string | undefined {
    return this.call('identity.derive', { directory }, z.string().nullable()) ?? undefined
  }
  normalizeLocalType(value: string | number): number {
    return this.call('message.normalizeType', { value }, z.number().int())
  }
  parseMessageContent(content: string, messageType: number): ParsedContent {
    return this.call('message.parse', { content, messageType }, parsedMessageSchema)
  }
  parseStickerMessageFromRow(row: Record<string, unknown>, content: string): ParsedContent {
    return this.call('message.stickerFromRow', { row, content }, parsedMessageSchema)
  }
  isQuoteMessageContent(content: string): boolean {
    return this.call('message.isQuote', { content }, z.boolean())
  }
  parseImageDatNameFromRow(row: Record<string, unknown>): string | undefined {
    return this.call('message.imageDatName', { row }, z.string().nullable()) ?? undefined
  }
  parseImageBufferDataUrlFromRow(row: Record<string, unknown>): string | undefined {
    return this.call('message.imageDataURL', { row }, z.string().nullable()) ?? undefined
  }
  normalizeV4AccountId(account: string): string {
    return this.call('imageKeys.normalizeAccount', { account }, z.string())
  }
  extractKvcommCode(fileName: string): number | null {
    return this.call(
      'imageKeys.kvcommCode',
      { fileName },
      z.number().int().min(1).max(0xffffffff).nullable()
    )
  }
  deriveV4ImageKeys(code: number, account: string): { xorKey: number; aesKey: string } | null {
    return this.call('imageKeys.derive', { code, account }, derivedImageKeysSchema)
  }
}
