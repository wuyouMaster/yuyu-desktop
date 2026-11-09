import { z } from 'zod'

/** Public DTOs only. Storage decoding and key handling belong to the runtime. */
export const telegramMacOSCandidateSchema = z.string().regex(/^telegram-macos-local:[a-f0-9]{24}$/)
export const telegramMacOSPeerSchema = z
  .string()
  .regex(/^(0|-?[1-9][0-9]*)$/)
  .refine((value) => {
    if (!/^(0|-?[1-9][0-9]*)$/.test(value) || value.length > 20) return false
    const peer = BigInt(value)
    return peer >= -(2n ** 63n) && peer < 2n ** 63n
  })
export const telegramMacOSKeySchema = z.string().regex(/^[a-f0-9]{40}$/)
const int32 = z.number().int().min(-2147483648).max(2147483647)

export const telegramMacOSInspectionSchema = z
  .object({
    clientType: z.literal('telegram-macos'),
    state: z.enum(['not_found', 'storage_detected', 'unknown_format']),
    application: z
      .object({
        bundleId: z.string(),
        version: z.string(),
        build: z.string(),
        executableSha256: z.string().regex(/^[a-f0-9]{64}$/)
      })
      .strict()
      .optional(),
    candidates: z.array(
      z
        .object({
          id: telegramMacOSCandidateSchema,
          format: z.string(),
          databaseBytes: z.number().int().nonnegative(),
          walPresent: z.boolean()
        })
        .strict()
    ),
    canReadMessages: z.boolean(),
    canSend: z.literal(false)
  })
  .strict()

export const telegramMacOSSourceSchema = z
  .object({
    root: z.string().min(1),
    appPath: z.string().min(1),
    candidateId: telegramMacOSCandidateSchema
  })
  .strict()
export const telegramMacOSConversationsRequestSchema = telegramMacOSSourceSchema
  .extend({
    limit: z.number().int().min(1).max(200),
    beforePeer: telegramMacOSPeerSchema.optional()
  })
  .strict()
export const telegramMacOSConversationsSchema = z
  .object({
    clientType: z.literal('telegram-macos'),
    candidateId: telegramMacOSCandidateSchema,
    scope: z.literal('local-snapshot'),
    order: z.literal('peer-id-desc'),
    items: z
      .array(z.object({ peerId: telegramMacOSPeerSchema, lastTimestamp: int32 }).strict())
      .max(200),
    nextPeer: telegramMacOSPeerSchema.optional()
  })
  .strict()
export const telegramMacOSMediaSchema = z
  .object({
    kind: z.enum(['photo', 'video', 'audio', 'voice', 'sticker', 'animation', 'file', 'unknown']),
    filename: z
      .string()
      .refine((value) => new TextEncoder().encode(value).length <= 1024)
      .optional(),
    mimeType: z.string().max(255).optional(),
    byteLength: z.number().int().safe().nonnegative().optional(),
    width: z.number().int().nonnegative().optional(),
    height: z.number().int().nonnegative().optional(),
    durationSeconds: z.number().finite().nonnegative().optional(),
    metadataState: z.enum(['decoded', 'unsupported'])
  })
  .strict()
export const telegramMacOSMessagesRequestSchema = telegramMacOSSourceSchema
  .extend({
    limit: z.number().int().min(1).max(50),
    beforeKey: telegramMacOSKeySchema.optional(),
    peerId: telegramMacOSPeerSchema.optional()
  })
  .strict()
export const telegramMacOSMessageSchema = z
  .object({
    key: telegramMacOSKeySchema,
    peerId: telegramMacOSPeerSchema,
    namespace: int32,
    id: int32,
    timestamp: int32,
    authorId: telegramMacOSPeerSchema.optional(),
    text: z.string(),
    attributeCount: z.number().int().nonnegative(),
    mediaCount: z.number().int().nonnegative(),
    media: z.array(telegramMacOSMediaSchema).optional()
  })
  .strict()
  .refine((message) => message.media === undefined || message.media.length === message.mediaCount)
export const telegramMacOSMessagesSchema = z
  .object({
    clientType: z.literal('telegram-macos'),
    candidateId: telegramMacOSCandidateSchema,
    scope: z.literal('local-snapshot'),
    order: z.literal('postbox-key-desc'),
    items: z.array(telegramMacOSMessageSchema).max(50),
    nextKey: telegramMacOSKeySchema.optional(),
    mediaDecoded: z.literal(false)
  })
  .strict()

export type TelegramMacOSSource = z.infer<typeof telegramMacOSSourceSchema>
export type TelegramMacOSMessage = z.infer<typeof telegramMacOSMessageSchema>
export type TelegramMacOSConversationsRequest = z.infer<
  typeof telegramMacOSConversationsRequestSchema
>
export type TelegramMacOSMessagesRequest = z.infer<typeof telegramMacOSMessagesRequestSchema>
