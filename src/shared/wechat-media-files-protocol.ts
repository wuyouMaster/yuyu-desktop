import { z } from 'zod'

export const mediaChunkBytes = 512 * 1024
export const mediaDecodeBytes = 48 * 1024 * 1024
export const mediaTransferBytes = 2 * 1024 * 1024 * 1024
export const mediaHandleSchema = z.string().regex(/^[a-f0-9]{48}$/)
export const mediaRelativePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (path) =>
      !/[\\:\x00]/.test(path) &&
      path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  )
export const mediaFileOptionsSchema = z
  .object({
    aesKey: z
      .string()
      .max(64)
      .regex(/^[\x00-\x7f]*$/)
      .default(''),
    xorKey: z.number().int().min(0).max(255).default(0)
  })
  .strict()
export const mediaFindQuerySchema = z
  .object({
    md5: z.string().max(128).optional(),
    datName: z.string().max(160).optional(),
    sessionId: z.string().max(256).optional(),
    sessionMd5: z
      .string()
      .regex(/^[a-f0-9]{32}$/i)
      .optional(),
    created: z.number().int().nonnegative().optional(),
    allowThumbnail: z.boolean().optional(),
    preferThumbnail: z.boolean().optional()
  })
  .strict()
  .refine((q) => !!(q.md5 || q.datName))
export const mediaTransferSchema = z
  .object({
    transferId: mediaHandleSchema,
    path: mediaRelativePathSchema,
    size: z.number().int().nonnegative().max(mediaTransferBytes),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    mime: z.enum([
      'application/octet-stream',
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/bmp',
      'image/webp',
      'image/wxgf'
    ]),
    diagnostic: z.enum(['FILE', 'SUCCESS', 'DIRECT_IMAGE', 'WXGF_REQUIRES_DECODER']),
    requiresDecoder: z.boolean()
  })
  .strict()
  .refine(
    (v) =>
      v.requiresDecoder === (v.mime === 'image/wxgf') &&
      v.requiresDecoder === (v.diagnostic === 'WXGF_REQUIRES_DECODER') &&
      (v.mime === 'application/octet-stream') === (v.diagnostic === 'FILE')
  )
export const mediaChunkSchema = z
  .object({
    offset: z.number().int().nonnegative(),
    data: z.string().max(Math.ceil(mediaChunkBytes / 3) * 4),
    eof: z.boolean()
  })
  .strict()
export type MediaFindQuery = z.infer<typeof mediaFindQuerySchema>
export type MediaTransfer = z.infer<typeof mediaTransferSchema>
