import { z } from 'zod'
import type { ForwardedMessageItem, ParsedContent } from './message-parser-port'

export const wechatStorageDescriptionSchema = z
  .object({
    application: z.literal('wechat'),
    protocol: z.literal(1),
    implementation: z.literal('go'),
    version: z.string().min(1),
    platform: z.string().min(1),
    arch: z.string().min(1),
    methods: z.array(z.string().regex(/^[a-z][a-zA-Z0-9_.]{0,95}$/)).max(128)
  })
  .strict()
export const localAccountIdentitySchema = z
  .object({
    wxid: z.string().min(1),
    nickname: z.string().optional(),
    avatar: z.string().optional()
  })
  .strict()
  .nullable()
export const derivedImageKeysSchema = z
  .object({
    xorKey: z.number().int().min(0).max(255),
    aesKey: z.string().regex(/^[a-f0-9]{16}$/)
  })
  .strict()
  .nullable()

const optionalText = z.string().optional()
const optionalNumber = z.number().optional()
// Legacy parsers use NaN for malformed numeric fields. JSON transports these as null.
const legacyNumber = z
  .number()
  .nullable()
  .transform((value) => value ?? Number.NaN)
const transfer = z
  .object({
    paySubtype: optionalText,
    amountText: optionalText,
    transcationId: optionalText,
    transferId: optionalText,
    invalidTime: optionalText,
    beginTransferTime: optionalText,
    effectiveDate: optionalText,
    payMemo: optionalText,
    receiverUsername: optionalText,
    payerUsername: optionalText,
    transferStatus: optionalText,
    transferStatusText: optionalText,
    transId: optionalText,
    feeType: optionalText,
    transferAttach: optionalText,
    refundBankType: optionalText
  })
  .strict()
const payment = z
  .object({
    templateId: optionalText,
    receiveTitle: optionalText,
    sendTitle: optionalText,
    sceneText: optionalText,
    senderDes: optionalText,
    receiverDes: optionalText,
    iconUrl: optionalText,
    nativeUrl: optionalText,
    sendId: optionalText,
    hbType: optionalText,
    hbStatus: optionalText,
    receiveStatus: optionalText,
    redPacketStatusText: optionalText
  })
  .strict()
const forwardedItem: z.ZodType<ForwardedMessageItem> = z.lazy(() =>
  z
    .object({
      messageType: z.number(),
      sender: optionalText,
      sentAt: optionalText,
      text: z.string(),
      nested: z.array(forwardedItem).optional()
    })
    .strict()
)

/** Public presentation DTOs only; private XML/SQL/cipher details stay in the runtime. */
export const parsedMessageSchema: z.ZodType<ParsedContent> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), content: z.string() }).strict(),
  z.object({ type: z.literal('voice'), duration: optionalNumber }).strict(),
  z
    .object({
      type: z.literal('location'),
      poiname: optionalText,
      label: optionalText,
      lat: legacyNumber,
      lng: legacyNumber
    })
    .strict(),
  z
    .object({
      type: z.literal('card'),
      username: z.string(),
      nickname: z.string(),
      avatarUrl: optionalText
    })
    .strict(),
  z
    .object({
      type: z.literal('share'),
      title: z.string(),
      des: optionalText,
      url: z.string(),
      appname: optionalText,
      typeVal: optionalText,
      transfer: transfer.optional(),
      articles: z
        .array(
          z
            .object({
              title: z.string(),
              description: optionalText,
              url: z.string(),
              coverUrl: optionalText
            })
            .strict()
        )
        .optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('forwardBundle'),
      title: z.string(),
      description: optionalText,
      items: z.array(forwardedItem)
    })
    .strict(),
  z
    .object({
      type: z.literal('miniProgram'),
      title: z.string(),
      description: optionalText,
      appName: optionalText,
      iconUrl: optionalText,
      thumbMd5: optionalText,
      thumbDatName: optionalText,
      thumbDataUrl: optionalText
    })
    .strict(),
  z
    .object({
      type: z.literal('redPacket'),
      title: z.string(),
      description: optionalText,
      url: optionalText,
      pay: payment.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('voip'),
      duration: legacyNumber.optional(),
      status: z.string(),
      roomType: legacyNumber.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('image'),
      md5: optionalText,
      datName: optionalText,
      aeskey: optionalText,
      encrypVer: legacyNumber.optional(),
      cdnUrl: optionalText,
      fileId: optionalText,
      clientId: optionalText
    })
    .strict(),
  z
    .object({
      type: z.literal('video'),
      md5: optionalText,
      newMd5: optionalText,
      rawMd5: optionalText,
      byteLength: optionalNumber,
      duration: optionalNumber,
      width: optionalNumber,
      height: optionalNumber
    })
    .strict(),
  z
    .object({
      type: z.literal('sticker'),
      md5: optionalText,
      url: optionalText,
      thumbUrl: optionalText,
      encryptUrl: optionalText,
      aeskey: optionalText
    })
    .strict(),
  z
    .object({
      type: z.literal('quote'),
      title: optionalText,
      content: optionalText,
      sender: optionalText,
      quotedContent: optionalText,
      quotedSender: optionalText,
      quotedType: optionalText,
      quotedImageMd5: optionalText,
      quotedImageDatName: optionalText
    })
    .strict(),
  z
    .object({
      type: z.literal('system'),
      content: z.string(),
      raw: optionalText,
      pat: z.boolean().optional(),
      recall: z
        .object({
          targetId: optionalText,
          targetIds: z.array(z.string()).optional(),
          replacement: z.string(),
          actor: optionalText,
          sessionId: optionalText,
          recallTime: optionalNumber
        })
        .strict()
        .optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('unknown'),
      raw: z.string(),
      messageType: z.union([z.string(), z.number()]).optional()
    })
    .strict()
])
