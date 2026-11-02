import type { AudioCodecPort } from '../../shared/audio-codec-port'
import { CapabilityProviderRegistry, protocolMethods } from './capability-provider-registry'
import { withWechatAudio } from '../runtime-rpc/application-runtimes'

const registries = new Map<'silk' | 'amr', CapabilityProviderRegistry<AudioCodecPort>>()

/** Each codec has its own provider selection; binary/WASM details stay in the adapter. */
export function audioCodecProviders(
  codec: 'silk' | 'amr'
): CapabilityProviderRegistry<AudioCodecPort> {
  const existing = registries.get(codec)
  if (existing) return existing
  const registry = new CapabilityProviderRegistry<AudioCodecPort>(
    'wechat',
    '',
    1,
    protocolMethods<AudioCodecPort>({ decode: true, encode: true })
  )
  registry.register({
    id: 'wechat-go-' + codec,
    source: 'wechat',
    accountId: '',
    protocolVersion: 1,
    implementation: {
      decode: (source) => withWechatAudio(audio => audio.decode(source)),
      ...(codec === 'silk'
        ? { encode: (pcm: Buffer, sampleRate: number) => withWechatAudio(audio => audio.encode(pcm, sampleRate)) }
        : {})
    },
    health: () => ({ state: 'ready' })
  })
  registries.set(codec, registry)
  return registry
}
