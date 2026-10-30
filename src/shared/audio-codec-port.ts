/** Main-process audio protocol. PCM is interleaved signed 16-bit little-endian. */
export interface EncodedVoiceSource {
  data: Buffer
  codec: string
  sourceHash: string
}

export interface DecodedVoiceAudio {
  pcm: Buffer
  sampleRate: number
  channels: number
  sourceHash: string
}

export interface VoiceAudioDecoder {
  readonly codec: string
  decode(source: EncodedVoiceSource): Promise<DecodedVoiceAudio>
}

export interface EncodedSilkAudio {
  data: Buffer
  durationMs: number
}

export interface AudioCodecPort {
  decode(source: EncodedVoiceSource): Promise<DecodedVoiceAudio>
  encode(pcm: Buffer, sampleRate: number): Promise<EncodedSilkAudio>
}
