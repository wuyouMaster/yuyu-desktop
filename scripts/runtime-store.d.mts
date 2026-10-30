export interface RuntimeTransferProgress {
  phase: 'connecting' | 'downloading' | 'verifying' | 'extracting' | 'activating'
  downloaded: number
  total?: number
}
export interface RuntimePackage {
  application: string
  version: string
  target: string
  sourceCommit: string
  githubAuthentication?: boolean
  repository?: string
  tag?: string
  asset: string
  url: string
  sha256: string
  manifestSha256: string
  files: string[]
  releaseStatus: string
}
export interface RuntimeActive {
  version: string
  sha256: string
  target: string
  sourceCommit: string
}
export function selectRuntime(
  catalog: { packages: RuntimePackage[] },
  application: string,
  version: string,
  target: string
): RuntimePackage
export function readActive(home: string): Promise<Record<string, RuntimeActive>>
export function verifyRuntime(home: string, item: RuntimePackage): Promise<string>
export function verifyRuntimeSync(home: string, item: RuntimePackage): string
export function installRuntime(options: {
  home: string
  item: RuntimePackage
  archive?: string
  baseUrl?: string
  downloadUrl?: string
  token?: string
  signal?: AbortSignal
  onProgress?: (progress: RuntimeTransferProgress) => void
  allowLoopback?: boolean
}): Promise<{ application: string; version: string; sha256: string }>
