export interface RuntimeInstallationStatus {
  application: string
  version: string
  target: string
  status: 'not-installed' | 'installed' | 'invalid' | 'unsupported'
  restartRequired?: boolean
  sourceLabel?: string
  error?: string
}
export interface RuntimeInstallRequest {
  downloadUrl?: string
  application: string
  version: string
}

export interface RuntimeInstallProgress {
  application: string
  phase:
    | 'connecting'
    | 'downloading'
    | 'verifying'
    | 'extracting'
    | 'activating'
    | 'completed'
    | 'failed'
    | 'cancelled'
  downloaded: number
  total?: number
  error?: string
}
