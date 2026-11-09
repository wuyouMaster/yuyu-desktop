import { z } from 'zod'

/** Public data contracts; encrypted storage layout and cache keys remain inside the runtime. */
export const telegramStorageDescriptionSchema = z
  .object({
    application: z.literal('telegram'),
    implementation: z.string().optional(),
    protocol: z.literal(1),
    version: z.string().min(1),
    methods: z.array(z.string()),
    clientTypes: z.array(z.enum(['telegram-desktop', 'telegram-macos'])).optional(),
    platform: z.string(),
    arch: z.string()
  })
  .strict()
export const telegramStorageInspectionSchema = z
  .object({
    storageVersion: z.number().int().nonnegative(),
    accounts: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
          slot: z.number().int().nonnegative(),
          isActive: z.boolean(),
          storageVersion: z.number().int().nonnegative().optional(),
          state: z.enum(['metadata_read', 'unreadable', 'unsupported_format']),
          draftCount: z.number().int().nonnegative().optional(),
          hasMediaCache: z.boolean().optional(),
          canReadMessages: z.literal(false)
        })
        .strict()
    )
  })
  .strict()
export const telegramCacheOptionsSchema = z
  .object({
    slot: z.number().int().nonnegative(),
    account: z.string().regex(/^telegram-local:[a-f0-9]{24}$/),
    dataRoot: z.string().min(1),
    cacheOutputRoot: z.string().min(1).optional(),
    maxOutputBytes: z
      .number()
      .int()
      .positive()
      .max(256 * 1024 * 1024)
      .optional()
  })
  .strict()
export const telegramCacheReferenceSchema = z
  .object({
    role: z.enum(['full', 'thumbnail', 'small']),
    keyHigh: z.string(),
    keyLow: z.string(),
    sizeBytes: z.number().int().nonnegative().optional(),
    width: z.number().int().nonnegative().optional(),
    height: z.number().int().nonnegative().optional()
  })
  .strict()
export const telegramExpectedMediaSchema = z
  .object({
    kind: z.enum([
      'photo',
      'file',
      'video',
      'audio',
      'sticker',
      'animation',
      'voice',
      'video_message'
    ]),
    id: z.string(),
    mimeType: z.string().optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    dataCenterId: z.number().int().nonnegative().optional()
  })
  .strict()
export const telegramCacheResultSchema = z
  .object({
    filePath: z.string().min(1),
    mimeType: z.string().min(1),
    byteLength: z.number().int().nonnegative(),
    thumbnail: z.boolean().optional()
  })
  .strict()
  .nullable()
export type TelegramCacheOptions = z.infer<typeof telegramCacheOptionsSchema>
export type TelegramCacheReference = z.infer<typeof telegramCacheReferenceSchema>
export type TelegramExpectedMedia = z.infer<typeof telegramExpectedMediaSchema>
