import { managedResourcePath } from '../runtime-paths'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { TelegramLocalInspection } from '../../shared/telegram-local'
import type { TelegramExportDocument } from '../../shared/telegram-export'
import { telegramLocalService } from './telegram-local-service'
import { effectiveTelegramHistory, hasCompleteTelegramHistory } from './telegram-history-state'

const execute = promisify(execFile)
const id = z.string().regex(/^[1-9][0-9]{0,19}$/)
const label = z.string().max(32768)
const size = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const dimension = z.number().int().positive().max(100000)
const mediaDetailsSchema = z
  .object({
    id,
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
    fileName: z.string().max(1024).optional(),
    mimeType: z.string().max(127).optional(),
    sizeBytes: size.optional(),
    durationMs: size.optional(),
    width: dimension.optional(),
    height: dimension.optional(),
    dataCenterId: z.number().int().min(1).max(65535).optional(),
    cacheRefs: z
      .array(
        z
          .object({
            role: z.enum(['full', 'thumbnail', 'small']),
            keyHigh: id,
            keyLow: id,
            sizeBytes: size.optional(),
            width: dimension.optional(),
            height: dimension.optional()
          })
          .strict()
      )
      .max(4)
  })
  .strict()
const schema = z
  .object({
    schemaVersion: z.literal(1),
    slot: z.number().int().min(0).max(5),
    selfId: id,
    selfName: label,
    runtime: z
      .object({
        pid: z.number().int().min(2),
        activeSelfId: id.optional(),
        activePeerId: id.optional()
      })
      .strict()
      .optional(),
    conversations: z
      .array(
        z
          .object({
            id,
            title: label,
            kind: z.enum(['direct', 'group', 'channel']),
            history: z
              .object({
                loadedAtTop: z.boolean(),
                loadedAtBottom: z.boolean(),
                loadState: z.enum(['idle', 'pending', 'unknown']).optional(),
                blockMessageIds: z.array(id).max(20000).optional()
              })
              .strict()
              .optional()
          })
          .strict()
      )
      .max(2048),
    messages: z
      .array(
        z
          .object({
            id,
            peerId: id,
            senderId: id,
            senderName: label,
            dateMs: z.number().int().min(1375315200000).max(4102444800000),
            text: label,
            media: z.enum(['', 'photo', 'document', 'unsupported']),
            mediaDetails: mediaDetailsSchema.optional(),
            groupedId: id.optional()
          })
          .strict()
      )
      .max(20000)
  })
  .strict()

const errors: Record<string, string> = {
  process_not_unique: '请只打开一个 Telegram Desktop 客户端并登录后重试。',
  unsupported_build: '本地消息读取仅支持已验证的 macOS arm64 Telegram Desktop 7.2.5 / 7.2.9 构建。',
  permission_denied: 'macOS 未允许读取 Telegram 进程，无法获取本地消息。',
  account_missing: '运行中的客户端没有所选账号，请重新检测账号。',
  not_logged_in: '所选 Telegram 账号尚未登录。',
  memory_unavailable: 'Telegram 已退出或读取超时，请重试。',
  layout_or_snapshot_changed: 'Telegram 正在更新数据或对象布局不匹配，请稍后重试。'
}

async function runHelper(slot: number): Promise<unknown> {
  const helper = managedResourcePath('telegram/telegram-runtime-read')
  if (!helper) throw new Error('请先安装支持的 Telegram 应用运行时。')
  try {
    const { stdout } = await execute(helper, [String(slot)], {
      timeout: 15000,
      maxBuffer: 16 * 1024 * 1024
    })
    return JSON.parse(stdout)
  } catch {
    // execFile errors may include stdout containing chat data; never propagate them.
    throw new Error('Telegram 本地读取工具运行失败或超时。')
  }
}

export class TelegramRuntimeReader {
  constructor(
    private readonly options: {
      platform?: NodeJS.Platform
      inspect?: () => Promise<TelegramLocalInspection>
      run?: (slot: number) => Promise<unknown>
    } = {}
  ) {}

  async read(slot: number, expectedAccount: string): Promise<TelegramExportDocument> {
    if ((this.options.platform ?? process.platform) !== 'darwin')
      throw new Error(errors.unsupported_build)
    if (
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot > 5 ||
      !/^telegram-local:[a-f0-9]{24}$/.test(expectedAccount)
    ) {
      throw new Error('Telegram 本地账号参数无效，请重新检测。')
    }
    const inspect = this.options.inspect ?? (() => telegramLocalService.inspect())
    const checkAccount = (inspection: TelegramLocalInspection): void => {
      if (inspection.state !== 'detected') throw new Error(inspection.message)
      if (
        !inspection.accounts.some(
          (a) => a.slot === slot && a.id === expectedAccount && a.state === 'metadata_read'
        )
      ) {
        throw new Error('Telegram 本地账号已变化，请重新检测。')
      }
    }
    // Requires readable, empty-passcode local metadata before accessing the process.
    checkAccount(await inspect())
    const response = await (this.options.run ?? runHelper)(slot)
    const envelope = z
      .object({ ok: z.boolean(), error: z.string().optional(), snapshot: z.unknown().optional() })
      .strict()
      .safeParse(response)
    if (!envelope.success) throw new Error('Telegram 本地读取响应无效。')
    if (!envelope.data.ok)
      throw Object.assign(
        new Error(errors[envelope.data.error || ''] || 'Telegram 本地读取未完成。'),
        { code: envelope.data.error }
      )
    const parsed = schema.safeParse(envelope.data.snapshot)
    if (!parsed.success) throw new Error('Telegram 本地消息结构校验失败。')
    const snapshot = parsed.data
    if (BigInt(snapshot.selfId) >= 1n << 48n) throw new Error('Telegram 账号标识格式无效。')
    // Storage::SerializePeerId adds the reserved bit at position 55.
    const accountKey =
      'telegram-local:' +
      createHash('sha256')
        .update((BigInt(snapshot.selfId) | (0x80n << 48n)).toString())
        .digest('hex')
        .slice(0, 24)
    if (snapshot.slot !== slot || accountKey !== expectedAccount)
      throw new Error('Telegram 运行中账号与所选本地账号不一致。')
    checkAccount(await inspect())
    const conversations: TelegramExportDocument['conversations'] = []
    const byId = new Map<string, TelegramExportDocument['conversations'][number]>()
    for (const chat of snapshot.conversations) {
      if (byId.has(chat.id)) throw new Error('Telegram 会话标识重复。')
      const conversation = {
        id: chat.id,
        kind: chat.kind,
        title: chat.title || 'Telegram 未命名会话',
        runtimeHistory: effectiveTelegramHistory(chat.history),
        participants: [],
        messages: [],
        extensions: {
          telegram: { origin: 'runtime', coverage: 'loaded_only', membershipComplete: false }
        }
      } satisfies TelegramExportDocument['conversations'][number]
      byId.set(chat.id, conversation)
      conversations.push(conversation)
    }
    const seen = new Set<string>()
    const latest = new Map<string, number>()
    for (const message of snapshot.messages) {
      const conversation = byId.get(message.peerId)
      const key = message.peerId + '/' + message.id
      if (!conversation || seen.has(key)) throw new Error('Telegram 消息与会话关联校验失败。')
      seen.add(key)
      latest.set(message.peerId, Math.max(latest.get(message.peerId) ?? 0, message.dateMs))
      if (!conversation.participants.some((p) => p.id === message.senderId)) {
        conversation.participants.push({
          id: message.senderId,
          displayName: message.senderName,
          kind: 'unknown'
        })
      }
      conversation.messages.push({
        id: message.id,
        groupedId: message.groupedId,
        type: message.media === 'unsupported' ? 'runtime_media' : 'message',
        dateMs: message.dateMs,
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text || undefined,
        mediaType:
          message.mediaDetails?.kind ??
          (message.media === 'photo' ? 'photo' : message.media === 'document' ? 'file' : undefined),
        fileName: message.mediaDetails?.fileName,
        mimeType: message.mediaDetails?.mimeType,
        durationSeconds:
          message.mediaDetails?.durationMs === undefined
            ? undefined
            : message.mediaDetails.durationMs / 1000,
        runtimeMedia: message.mediaDetails,
        outgoing: message.senderId === snapshot.selfId,
        extensions: {
          telegram: {
            origin: 'runtime',
            media: message.media,
            caption: message.text,
            coverage: 'loaded_only'
          }
        }
      })
    }
    for (const conversation of conversations) {
      const history = conversation.runtimeHistory
      if (!history?.blockMessageIds) continue
      const blockIds = new Set(history.blockMessageIds)
      if (blockIds.size !== history.blockMessageIds.length)
        throw new Error('Telegram 历史窗口消息标识重复。')
      const present = new Set(conversation.messages.map((message) => message.id))
      if (history.blockMessageIds.some((id) => !present.has(id))) {
        history.loadedAtTop = false
        history.loadedAtBottom = false
      }
      if (hasCompleteTelegramHistory(conversation)) {
        conversation.messages = conversation.messages.filter((message) => blockIds.has(message.id))
        const senders = new Set(conversation.messages.map((message) => message.senderId))
        conversation.participants = conversation.participants.filter((participant) =>
          senders.has(participant.id)
        )
      }
    }
    conversations.sort((a, b) => (latest.get(b.id) ?? 0) - (latest.get(a.id) ?? 0))
    return {
      accountKey,
      accountNativeId: snapshot.selfId,
      accountLabel: snapshot.selfName || 'Telegram 本地账号',
      conversations,
      sourceFileName: '',
      origin: 'runtime',
      runtime: snapshot.runtime,
      capturedAt: Date.now()
    }
  }
}
