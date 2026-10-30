/** Secrets stay in the main process; progress callbacks must not contain credentials. */
export interface DatabaseKeyResult {
  success: boolean
  key?: string
  error?: string
  code?: string
  logs?: string[]
}
export interface ImageKeyResult {
  success: boolean
  xorKey?: number
  aesKey?: string
  verified?: boolean
  error?: string
}
export interface WechatKeyPort {
  autoGetDbKey(
    onStatus?: (message: string) => void,
    accountRoot?: string
  ): Promise<DatabaseKeyResult>
  autoGetImageKey(
    accountRoot?: string,
    onStatus?: (message: string) => void,
    wxid?: string
  ): Promise<ImageKeyResult>
  getIntelEnvironmentStatus(): Promise<{
    sipDisabled: boolean
    pythonAvailable: boolean
    fridaAvailable: boolean
    wechatAdhocSigned: boolean
  }>
  installIntelKeyRuntime(
    onStatus?: (message: string) => void
  ): Promise<{ success: boolean; error?: string; code?: string }>
}
