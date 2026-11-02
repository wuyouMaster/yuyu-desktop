import type { ImageMediaPort } from '../../shared/image-media-port'
import { CapabilityProviderRegistry } from './capability-provider-registry'

export type { ImageMediaProviderRegistration } from '../../shared/image-media-port'
export const IMAGE_MEDIA_PROTOCOL_VERSION = 1 as const
const METHODS = {
  getLastDecodeDiagnostic: true,
  findImageFile: true,
  findImageFileAsync: true,
  getCachedDecodedImage: true,
  cacheDecodedImage: true,
  decryptImage: true,
  decryptImageToBase64: true,
  decryptImageToBase64WithFallback: true,
  decryptImageToBase64WithFallbackAsync: true,
  isThumbnailFile: true
} satisfies Record<keyof ImageMediaPort, true>

export class ImageMediaProviderRegistry extends CapabilityProviderRegistry<ImageMediaPort> {
  constructor(source: string, accountId: string) {
    super(
      source,
      accountId,
      IMAGE_MEDIA_PROTOCOL_VERSION,
      Object.keys(METHODS) as (keyof ImageMediaPort)[]
    )
  }
}
