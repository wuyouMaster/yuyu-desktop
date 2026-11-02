import type {
  EncodedVoiceSource,
  DecodedVoiceAudio,
  VoiceAudioDecoder,
  EncodedSilkAudio
} from '../../shared/audio-codec-port'
import { audioCodecProviders } from '../services/audio-codec-provider-registry'
export type {
  EncodedVoiceSource,
  DecodedVoiceAudio,
  VoiceAudioDecoder,
  EncodedSilkAudio
} from '../../shared/audio-codec-port'

export class SilkAudioDecoder implements VoiceAudioDecoder {
  readonly codec = 'silk'
  decode(source: EncodedVoiceSource): Promise<DecodedVoiceAudio> {
    return audioCodecProviders('silk').resolve(['decode']).port.decode(source)
  }
}
export class AmrAudioDecoder implements VoiceAudioDecoder {
  readonly codec = 'amr'
  decode(source: EncodedVoiceSource): Promise<DecodedVoiceAudio> {
    return audioCodecProviders('amr').resolve(['decode']).port.decode(source)
  }
}
export class SilkAudioEncoder {
  encode(pcm: Buffer, sampleRate: number): Promise<EncodedSilkAudio> {
    return audioCodecProviders('silk').resolve(['encode']).port.encode(pcm, sampleRate)
  }
}

export class AudioDecoderRegistry {
  private readonly decoders = new Map<string, VoiceAudioDecoder>()

  register(decoder: VoiceAudioDecoder): this {
    if (this.decoders.has(decoder.codec))
      throw new Error(`Decoder already registered: ${decoder.codec}`)
    this.decoders.set(decoder.codec, decoder)
    return this
  }

  decode(source: EncodedVoiceSource): Promise<DecodedVoiceAudio> {
    const decoder = this.decoders.get(source.codec)
    if (!decoder) throw new Error(`Unsupported voice codec: ${source.codec}`)
    return decoder.decode(source)
  }
}

export function createDefaultAudioDecoderRegistry(): AudioDecoderRegistry {
  return new AudioDecoderRegistry().register(new SilkAudioDecoder()).register(new AmrAudioDecoder())
}
