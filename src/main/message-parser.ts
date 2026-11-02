import type { MessageParserPort } from '../shared/message-parser-port'
import { messageParserProviders } from './services/message-parser-provider-registry'
export type { ParsedContent } from '../shared/message-parser-port'

export const normalizeLocalType: MessageParserPort['normalizeLocalType'] = (...args) =>
  messageParserProviders.resolve(['normalizeLocalType']).port.normalizeLocalType(...args)

export const parseMessageContent: MessageParserPort['parseMessageContent'] = (...args) =>
  messageParserProviders.resolve(['parseMessageContent']).port.parseMessageContent(...args)

export const parseStickerMessageFromRow: MessageParserPort['parseStickerMessageFromRow'] = (
  ...args
) =>
  messageParserProviders
    .resolve(['parseStickerMessageFromRow'])
    .port.parseStickerMessageFromRow(...args)

export const isQuoteMessageContent: MessageParserPort['isQuoteMessageContent'] = (...args) =>
  messageParserProviders.resolve(['isQuoteMessageContent']).port.isQuoteMessageContent(...args)

export const parseImageDatNameFromRow: MessageParserPort['parseImageDatNameFromRow'] = (...args) =>
  messageParserProviders
    .resolve(['parseImageDatNameFromRow'])
    .port.parseImageDatNameFromRow(...args)

export const parseImageBufferDataUrlFromRow: MessageParserPort['parseImageBufferDataUrlFromRow'] = (
  ...args
) =>
  messageParserProviders
    .resolve(['parseImageBufferDataUrlFromRow'])
    .port.parseImageBufferDataUrlFromRow(...args)
