import { createHash } from 'crypto'
import { readApplicationVoice } from './runtime-rpc/application-assets'
import type { DatabasePort } from '../shared/database-port'
import {
  createDefaultAudioDecoderRegistry,
  type EncodedVoiceSource
} from './voice-pipeline/audio-decoder'

type DatabaseReader = Pick<DatabasePort, 'getVoiceData' | 'getVoiceDataBatch' | 'getAccountRoot'>

export interface ResolvedPcmAudio {
  pcm: Buffer
  sampleRate: number
  channels: number
  codec: EncodedVoiceSource['codec']
  sourceHash: string
}

export type ResolvePcmResult =
  | { success: true; audio: ResolvedPcmAudio }
  | { success: false; error: string }

export type ResolveSourceResult =
  | { success: true; source: EncodedVoiceSource }
  | { success: false; error: string }

export interface VoiceReference {
  sessionId: string
  localId: number
  createTime: number
  svrId?: string | number
}

export class VoiceService {
  private database: DatabaseReader
  private voiceCache = new Map<string, string>()
  private pcmCache = new Map<string, ResolvedPcmAudio>()
  private readonly decoderRegistry = createDefaultAudioDecoderRegistry()

  constructor(database: DatabaseReader) {
    this.database = database
  }

  async resolveVoice(
    sessionId: string,
    localId: number,
    createTime: number,
    svrId?: string | number
  ): Promise<{ success: boolean; data?: string; error?: string }> {
    const cacheKey = this.buildCacheKey(sessionId, localId, createTime)

    const cached = this.voiceCache.get(cacheKey)
    if (cached) {
      console.log('[VoiceService] cache hit for', cacheKey)
      return { success: true, data: cached }
    }

    const pcmResult = await this.resolvePcm(sessionId, localId, createTime, svrId)
    if (!pcmResult.success) return pcmResult
    const pcmData = pcmResult.audio.pcm

    const wavData = this.createWavBuffer(
      pcmData,
      pcmResult.audio.sampleRate,
      pcmResult.audio.channels
    )
    // duration 由 PCM 字节数反算（wavData 去掉 44 字节头即 PCM），
    // 用来和用户实际听到的长度对齐、排查「时长显示不对」这类问题。
    // 注意它**不是权威值**：权威时长在消息 XML 的 <voicemsg voicelength>（毫秒），
    // 显示层以那个为准；这里只是解码结果的自证。
    const durationSeconds =
      pcmData.length / (pcmResult.audio.sampleRate * pcmResult.audio.channels * 2)
    console.log(
      '[VoiceService] wavData length:',
      wavData.length,
      'base64 length:',
      wavData.toString('base64').length,
      'duration:',
      `${durationSeconds.toFixed(2)}s`
    )

    const base64Data = wavData.toString('base64')

    this.voiceCache.set(cacheKey, base64Data)

    return { success: true, data: base64Data }
  }

  async resolveVoices(
    references: VoiceReference[]
  ): Promise<Array<{ success: boolean; data?: string; error?: string }>> {
    const results: Array<{ success: boolean; data?: string; error?: string } | undefined> =
      new Array(references.length)
    const missing: Array<{ index: number; reference: VoiceReference }> = []
    references.forEach((reference, index) => {
      const cached = this.voiceCache.get(
        this.buildCacheKey(reference.sessionId, reference.localId, reference.createTime)
      )
      if (cached) results[index] = { success: true, data: cached }
      else missing.push({ index, reference })
    })
    if (!missing.length)
      return results as Array<{ success: boolean; data?: string; error?: string }>

    const sources = await this.database.getVoiceDataBatch(
      missing.map(({ reference }) => ({
        sessionId: reference.sessionId,
        createTime: reference.createTime,
        localId: reference.localId,
        svrId: reference.svrId,
        candidates: this.buildCandidates(reference.sessionId)
      }))
    )
    const failed: Array<{ index: number; reference: VoiceReference }> = []
    for (const [{ index, reference }, source] of missing.map(
      (item, sourceIndex) => [item, sources[sourceIndex]] as const
    )) {
      if (!source?.success || !source.hex) {
        failed.push({ index, reference })
        continue
      }
      const silkData = this.decodeVoiceBlob(source.hex)
      if (!silkData?.length) {
        results[index] = { success: false, error: '语音数据为空' }
        continue
      }
      try {
        const decoded = await this.decoderRegistry.decode({
          data: silkData,
          codec: 'silk',
          sourceHash: createHash('sha256').update(silkData).digest('hex')
        })
        const wavData = this.createWavBuffer(decoded.pcm, decoded.sampleRate, decoded.channels)
        const data = wavData.toString('base64')
        const cacheKey = this.buildCacheKey(
          reference.sessionId,
          reference.localId,
          reference.createTime
        )
        this.voiceCache.set(cacheKey, data)
        this.pcmCache.set(cacheKey, { ...decoded, codec: 'silk' })
        results[index] = { success: true, data }
      } catch (error) {
        results[index] = {
          success: false,
          error: error instanceof Error ? error.message : 'Silk 解码失败'
        }
      }
    }
    const retried = await Promise.all(
      failed.map(({ reference }) =>
        this.resolveVoice(
          reference.sessionId,
          reference.localId,
          reference.createTime,
          reference.svrId
        )
      )
    )
    failed.forEach(({ index }, retryIndex) => {
      results[index] = retried[retryIndex]
    })
    return results as Array<{ success: boolean; data?: string; error?: string }>
  }

  async resolvePcm(
    sessionId: string,
    localId: number,
    createTime: number,
    svrId?: string | number
  ): Promise<ResolvePcmResult> {
    const cacheKey = this.buildCacheKey(sessionId, localId, createTime)
    const cached = this.pcmCache.get(cacheKey)
    if (cached) return { success: true, audio: cached }

    const sourceResult = await this.resolveSource(sessionId, localId, createTime, svrId)
    if (!sourceResult.success) return sourceResult

    try {
      const decoded = await this.decoderRegistry.decode(sourceResult.source)
      const audio: ResolvedPcmAudio = { ...decoded, codec: sourceResult.source.codec }
      this.pcmCache.set(cacheKey, audio)
      return { success: true, audio }
    } catch (error) {
      console.error('[VoiceService] audio decode failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : sourceResult.source.codec + ' 解码失败'
      }
    }
  }

  /**
   * 语音源解析：优先 WCDB `VoiceInfo`（`media_1.db`，SILK BLOB）。
   * 身份：`chat_name_id` + `create_time` + `local_id` + `svr_id`（2026-09-25 真机确认）。
   * 本客户端播放/下载不落明文磁盘文件；V2 目录扫描仅作极端旁路。
   */
  async resolveSource(
    sessionId: string,
    localId: number,
    createTime: number,
    svrId?: string | number
  ): Promise<ResolveSourceResult> {
    const candidates = this.buildCandidates(sessionId)
    const voiceResult = await this.database.getVoiceData(
      sessionId,
      createTime,
      candidates,
      localId,
      svrId || 0
    )
    if (!voiceResult.success || !voiceResult.hex) {
      // V2 旁路：GetMsgAudioPath 同域磁盘文件（.aud/.silk/.AMR）
      const disk = await this.resolveFromDisk(sessionId, localId, createTime, svrId)
      if (disk?.data.length) {
        return {
          success: true,
          source: {
            data: disk.data,
            codec: disk.codec,
            sourceHash: createHash('sha256').update(disk.data).digest('hex')
          }
        }
      }
      return { success: false, error: voiceResult.error || '获取语音数据失败' }
    }

    const silkData = this.decodeVoiceBlob(voiceResult.hex)
    if (!silkData?.length) return { success: false, error: '语音数据为空' }

    return {
      success: true,
      source: {
        data: silkData,
        codec: 'silk',
        sourceHash: createHash('sha256').update(silkData).digest('hex')
      }
    }
  }

  private buildCacheKey(sessionId: string, localId: number, createTime: number): string {
    return `${sessionId}-${localId}-${createTime}`
  }

  private buildCandidates(sessionId: string): string[] {
    const candidates: string[] = [sessionId]
    if (sessionId.endsWith('@chatroom')) {
      candidates.push(sessionId.replace('@chatroom', ''))
    }
    return candidates
  }

  /**
   * V2：旁路 `wcdb_get_voice_data`，在账号目录下找语音文件
   * （`GetMsgAudioPath` 同域：Message / MsgAndFiles / VoiceTemp）。
   * 只读；找不到时返回 null，上层仍报原 wcdb 错误。
   */
  private async resolveFromDisk(
    sessionId: string,
    localId: number,
    createTime: number,
    svrId?: string | number
  ): Promise<{ data: Buffer; codec: 'silk' | 'amr' } | null> {
    const accountRoot = this.database.getAccountRoot?.()
    if (!accountRoot) return null
    return readApplicationVoice(accountRoot, {
      kind: 'voice',
      sessionId,
      localId,
      created: createTime,
      serverId: svrId === undefined ? undefined : String(svrId)
    })
  }

  private decodeVoiceBlob(hex: string): Buffer | null {
    try {
      const hexClean = hex.replace(/\s+/g, '')
      if (!/^[0-9a-fA-F]+$/.test(hexClean)) {
        return null
      }
      return Buffer.from(hexClean, 'hex')
    } catch {
      return null
    }
  }

  private createWavBuffer(
    pcmData: Buffer,
    sampleRate: number = 16000,
    channels: number = 1
  ): Buffer {
    const pcmLength = pcmData.length
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + pcmLength, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(channels, 22)
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(sampleRate * channels * 2, 28)
    header.writeUInt16LE(channels * 2, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36)
    header.writeUInt32LE(pcmLength, 40)
    return Buffer.concat([header, pcmData])
  }
}
