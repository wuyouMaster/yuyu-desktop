export type TextContent = { type: 'text'; content: string }
export type VoiceContent = { type: 'voice'; duration?: number }
export type LocationContent = {
  type: 'location'
  poiname?: string
  label?: string
  lat: number
  lng: number
}
export type CardContent = { type: 'card'; username: string; nickname: string; avatarUrl?: string }
export type ShareArticle = {
  title: string
  description?: string
  url: string
  coverUrl?: string
}
export type ShareContent = {
  type: 'share'
  title: string
  des?: string
  url: string
  appname?: string
  typeVal?: string
  articles?: ShareArticle[]
  transfer?: TransferPaymentInfo
}

export type TransferPaymentInfo = {
  paySubtype?: string
  amountText?: string
  transcationId?: string
  transferId?: string
  invalidTime?: string
  beginTransferTime?: string
  effectiveDate?: string
  payMemo?: string
  receiverUsername?: string
  payerUsername?: string
  transferStatus?: string
  /** `transfer_status` 展示文案（只读）。 */
  transferStatusText?: string
  transId?: string
  feeType?: string
  transferAttach?: string
  refundBankType?: string
}

export type RedPacketPaymentInfo = {
  templateId?: string
  receiveTitle?: string
  sendTitle?: string
  sceneText?: string
  senderDes?: string
  receiverDes?: string
  iconUrl?: string
  nativeUrl?: string
  sendId?: string
  hbType?: string
  hbStatus?: string
  receiveStatus?: string
  /** `hb_status` / `receive_status` 展示文案（只读）。 */
  redPacketStatusText?: string
}
export type ForwardedMessageItem = {
  messageType: number
  sender?: string
  sentAt?: string
  text: string
  nested?: ForwardedMessageItem[]
}
export type ForwardBundleContent = {
  type: 'forwardBundle'
  title: string
  description?: string
  items: ForwardedMessageItem[]
}
export type MiniProgramContent = {
  type: 'miniProgram'
  title: string
  description?: string
  appName?: string
  iconUrl?: string
  thumbMd5?: string
  thumbDatName?: string
  thumbDataUrl?: string
}
export type RedPacketContent = {
  type: 'redPacket'
  title: string
  description?: string
  url?: string
  pay?: RedPacketPaymentInfo
}
export type VoipContent = { type: 'voip'; duration?: number; status: string; roomType?: number }
export type ImageContent = {
  type: 'image'
  md5?: string
  datName?: string
  aeskey?: string
  encrypVer?: number
  /** CDN download URL (cdnurl) when the local file is missing. */
  cdnUrl?: string
  /** CDN file id (fileid) for Mars CDN download tasks. */
  fileId?: string
  /** Client/task id used with fileId. */
  clientId?: string
}
export type VideoContent = {
  type: 'video'
  md5?: string
  newMd5?: string
  rawMd5?: string
  byteLength?: number
  duration?: number
  width?: number
  height?: number
}
export type StickerContent = {
  type: 'sticker'
  md5?: string
  url?: string
  thumbUrl?: string
  encryptUrl?: string
  aeskey?: string
}
export type QuoteContent = {
  type: 'quote'
  title?: string
  content?: string
  sender?: string
  quotedContent?: string
  quotedSender?: string
  quotedType?: string
  quotedImageMd5?: string
  quotedImageDatName?: string
}
export type SystemContent = {
  type: 'system'
  content: string
  raw?: string
  pat?: boolean
  recall?: {
    targetId?: string
    targetIds?: string[]
    replacement: string
    actor?: string
    sessionId?: string
    recallTime?: number
  }
}
export type UnknownContent = { type: 'unknown'; raw: string; messageType?: string | number }

export type ParsedContent =
  | TextContent
  | VoiceContent
  | LocationContent
  | CardContent
  | ShareContent
  | ForwardBundleContent
  | MiniProgramContent
  | RedPacketContent
  | VoipContent
  | ImageContent
  | VideoContent
  | StickerContent
  | QuoteContent
  | SystemContent
  | UnknownContent

export interface MessageParserPort {
  normalizeLocalType(messageType: number | string): number
  parseMessageContent(content: string, messageType: number): ParsedContent
  parseStickerMessageFromRow(row: Record<string, unknown>, content: string): ParsedContent
  isQuoteMessageContent(content: string): boolean
  parseImageDatNameFromRow(row: Record<string, unknown>): string | undefined
  parseImageBufferDataUrlFromRow(row: Record<string, unknown>): string | undefined
}
