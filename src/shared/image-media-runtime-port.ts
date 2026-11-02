import type { DatabasePort } from './database-port'
import type { ImageMediaProviderRegistration } from './image-media-port'
import type { ImageDecoderStatus } from './image-decryption'

export interface ImageMediaOpenOptions {
  xorKey: string
  aesKey: string
  database?: Pick<
    DatabasePort,
    'resolveImageHardlink' | 'resolveImageHardlinkAsync' | 'getAccountRoot'
  > | null
  accountRoot?: string
}

export interface ImageMediaRuntimePort {
  create(options: ImageMediaOpenOptions): ImageMediaProviderRegistration
  resolveFfmpegExecutable(): string
  inspectImageDecoderExecutable(
    executable: string
  ): Promise<{ installed: boolean; supportsHevc: boolean }>
  inspectImageDecoderStatus(selectedPath?: string): Promise<ImageDecoderStatus>
}
