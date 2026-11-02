import type { MessageParserPort } from '../../shared/message-parser-port'
import { applicationWechatStorage } from '../runtime-rpc/application-runtimes'
import { CapabilityProviderRegistry, protocolMethods } from './capability-provider-registry'

export const messageParserProviders = new CapabilityProviderRegistry<MessageParserPort>(
  'wechat',
  '',
  1,
  protocolMethods<MessageParserPort>({
    normalizeLocalType: true,
    parseMessageContent: true,
    parseStickerMessageFromRow: true,
    isQuoteMessageContent: true,
    parseImageDatNameFromRow: true,
    parseImageBufferDataUrlFromRow: true
  })
)
messageParserProviders.register({
  id: 'wechat-go-parser',
  source: 'wechat',
  accountId: '',
  protocolVersion: 1,
  implementation: {
    normalizeLocalType: (...args: Parameters<MessageParserPort['normalizeLocalType']>) => applicationWechatStorage().normalizeLocalType(...args),
    parseMessageContent: (...args: Parameters<MessageParserPort['parseMessageContent']>) => applicationWechatStorage().parseMessageContent(...args),
    parseStickerMessageFromRow: (...args: Parameters<MessageParserPort['parseStickerMessageFromRow']>) => applicationWechatStorage().parseStickerMessageFromRow(...args),
    isQuoteMessageContent: (...args: Parameters<MessageParserPort['isQuoteMessageContent']>) => applicationWechatStorage().isQuoteMessageContent(...args),
    parseImageDatNameFromRow: (...args: Parameters<MessageParserPort['parseImageDatNameFromRow']>) => applicationWechatStorage().parseImageDatNameFromRow(...args),
    parseImageBufferDataUrlFromRow: (...args: Parameters<MessageParserPort['parseImageBufferDataUrlFromRow']>) => applicationWechatStorage().parseImageBufferDataUrlFromRow(...args)
  },
  health: () => ({ state: 'ready' })
})
