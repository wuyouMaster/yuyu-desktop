/** Disk inspection is separate from a connected ReadProvider. */
export interface TelegramLocalAccount {
  id: string
  label: string
  slot: number
  isActive: boolean
  storageVersion?: number
  state: 'metadata_read' | 'unreadable' | 'unsupported_format'
  draftCount?: number
  hasMediaCache?: boolean
  canReadMessages: false
}

export interface TelegramLocalInspection {
  source: 'telegram'
  state:
    | 'detected'
    | 'not_found'
    | 'locked'
    | 'unreadable'
    | 'unsupported_format'
    | 'unsupported_platform'
  accounts: TelegramLocalAccount[]
  storageVersion?: number
  message: string
}
