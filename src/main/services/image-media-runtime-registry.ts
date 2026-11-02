import type { ImageMediaRuntimePort } from '../../shared/image-media-runtime-port'
import { CapabilityProviderRegistry, protocolMethods } from './capability-provider-registry'
import { applicationImageMedia } from '../runtime-rpc/application-image-media'

export const imageMediaRuntimeProviders = new CapabilityProviderRegistry<ImageMediaRuntimePort>(
  'wechat',
  '',
  1,
  protocolMethods<ImageMediaRuntimePort>({
    create: true,
    resolveFfmpegExecutable: true,
    inspectImageDecoderExecutable: true,
    inspectImageDecoderStatus: true
  })
)
imageMediaRuntimeProviders.register({
  id: 'local-image',
  source: 'wechat',
  accountId: '',
  protocolVersion: 1,
  implementation: applicationImageMedia,
  health: () => ({ state: 'ready' })
})
