import { createContext, useContext } from 'react'

export interface ImageKeyGuidance {
  configured: boolean | null
  onOpenSettings: () => void
  registerLockedImage: () => () => void
}

export const ImageKeyGuidanceContext = createContext<ImageKeyGuidance | null>(null)
export const useImageKeyGuidance = (): ImageKeyGuidance | null =>
  useContext(ImageKeyGuidanceContext)

export function isMissingImageKeyError(error: string | null): boolean {
  return error === '未配置图片解密密钥' || error === '图片密钥未配置'
}
