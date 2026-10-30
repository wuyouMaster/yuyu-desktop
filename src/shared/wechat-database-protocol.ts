import { z } from 'zod'

/** Public, account-bound protocol. SQL, cipher details and native pointers stay private. */
const text = z.string().max(8 * 1024 * 1024)
const optionalText = text.optional()
const integer = z.number().int().safe()
const raw = z.record(z.string(), z.unknown())
export const databaseOpenSchema = z
  .object({
    sessionId: z.string().regex(/^[a-f0-9]{48}$/),
    accountRoot: z.string().min(1),
    selfCandidates: z.array(z.string().min(1)).max(8),
    readOnly: z.literal(true)
  })
  .strict()
export const databaseSessionSchema = z
  .object({
    username: text.min(1),
    nickname: text,
    avatar: optionalText,
    wechatNickname: optionalText,
    remark: optionalText,
    alias: optionalText,
    wechatId: optionalText,
    wxid: optionalText,
    legacyIdentifier: optionalText,
    isFolded: z.boolean().optional(),
    isMuted: z.boolean().optional(),
    raw
  })
  .strict()
export const databaseMessageSchema = z
  .object({
    mesLocalID: text.min(1),
    serverId: optionalText,
    mesDes: z.union([z.literal(0), z.literal(1)]),
    messageType: text,
    msgCreateTime: z.string().regex(/^[0-9]+$/),
    msgContent: text,
    sender: optionalText,
    senderNickname: optionalText,
    senderAvatar: optionalText,
    raw
  })
  .strict()
export const databaseMemberSchema = z
  .object({
    m_nsUsrName: text.min(1),
    nickname: text,
    groupNickname: text,
    wechatNickname: text,
    remark: text,
    m_nsHeadImgUrl: text
  })
  .strict()
export const databaseRoomSchema = z
  .object({
    roomId: text.min(1),
    owner: optionalText,
    announcement: optionalText,
    announcementEditor: optionalText,
    announcementPublishTime: integer.optional(),
    chatRoomStatus: integer.optional(),
    memberCount: integer.nonnegative().optional(),
    maxMemberCount: integer.nonnegative().optional(),
    chatName: optionalText,
    openImAccountType: optionalText,
    isOpenIm: z.boolean().optional()
  })
  .strict()
  .nullable()
export const databaseQuerySchema = z
  .object({
    conversation: z.string().min(1).max(256),
    start: integer.nonnegative().optional(),
    end: integer.nonnegative().optional(),
    sinceMs: integer.nonnegative().optional(),
    beforeMs: integer.nonnegative().optional(),
    limit: integer.min(1).max(5000).optional(),
    kind: z.enum(['image', 'voice']).optional(),
    order: z.enum(['asc', 'desc']).optional()
  })
  .strict()
  .refine((q) => q.start === undefined || q.end === undefined || q.start <= q.end)
  .refine((q) => q.sinceMs === undefined || q.beforeMs === undefined || q.sinceMs <= q.beforeMs)
export const databaseCountSchema = z
  .object({ count: integer.nonnegative(), maxLocalId: integer.nonnegative() })
  .strict()
export const databaseTablesSchema = z
  .array(z.object({ name: text, db_number: text }).strict())
  .max(100000)
export const databaseRowsSchema = z.array(raw).max(100000)
export const databaseCatalogSchema = z.enum([
  'snsTimeline',
  'snsMessages',
  'nonStoreEmoticons',
  'emoticonPackages',
  'friendRequests',
  'favorites'
])
export type WechatDatabaseOpen = z.infer<typeof databaseOpenSchema>
export type WechatDatabaseQuery = z.infer<typeof databaseQuerySchema>
export type WechatDatabaseCatalog = z.infer<typeof databaseCatalogSchema>

export const databaseVoiceQuerySchema = z
  .object({
    conversation: z.string().min(1).max(256),
    created: integer.nonnegative(),
    localId: integer.nonnegative().default(0),
    serverId: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,18})$/)
      .refine((v) => BigInt(v) <= 9223372036854775807n)
      .default('0')
  })
  .strict()
  .refine((q) => q.localId > 0 || q.serverId !== '0')
export const databaseVoiceSchema = z
  .string()
  .max(4 * 1024 * 1024)
  .regex(/^(?:[a-f0-9]{2})+$/)
  .nullable()
export const databaseObservationSchema = z.string().regex(/^[a-f0-9]{64}$/)
export type WechatVoiceQuery = z.input<typeof databaseVoiceQuerySchema>

export const databaseContactDetailsSchema = z
  .array(
    z
      .object({
        username: text.min(1),
        wxid: text.min(1),
        wechatId: optionalText,
        legacyIdentifier: optionalText,
        avatar: optionalText
      })
      .strict()
  )
  .max(2000)
export const databaseGroupIdsSchema = z
  .array(
    z
      .object({
        roomId: text.min(1),
        status: z.enum(['ok', 'not_found']),
        memberWxids: z.array(text.min(1)).max(100000)
      })
      .strict()
  )
  .max(500)
export const databaseImageHardlinkSchema = z
  .object({
    file_name: text.min(1),
    relativePath: text,
    dir1: text.min(1),
    dir2: text.min(1)
  })
  .strict()
  .nullable()
export const databaseVideoHardlinkSchema = z
  .object({ resolved_md5: text.min(1) })
  .strict()
  .nullable()
export const databasePagedQuerySchema = databaseQuerySchema.safeExtend({
  limit: integer.min(1).max(1000000).optional()
})
export const databaseCursorSchema = z
  .object({ queryId: z.string().regex(/^[a-f0-9]{48}$/), reverse: z.boolean() })
  .strict()
export const databasePageSchema = z
  .object({ rows: z.array(databaseMessageSchema).max(128), done: z.boolean() })
  .strict()
  .refine((p) => p.done || p.rows.length > 0)
