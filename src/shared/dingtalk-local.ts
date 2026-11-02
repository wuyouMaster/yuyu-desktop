/** Discovery reports both file presence and whether the verified native reader can open it. */
export type DingtalkDatabaseFormat =
  | 'sqlite'
  | 'encoded_or_unknown'
  | 'truncated'
  | 'missing'
  | 'unreadable'

export interface DingtalkDatabaseProbe {
  name: 'dingtalk.db' | 'members.db'
  format: DingtalkDatabaseFormat
  byteLength?: number
  walPresent: boolean
}

export interface DingtalkLocalAccount {
  /** Opaque local identifier, not a DingTalk user id or evidence of login. */
  id: string
  label: string
  databases: DingtalkDatabaseProbe[]
  state: 'needs_decoder' | 'needs_schema' | 'ready' | 'unreadable'
  canRead: boolean
  canSend: false
}

export interface DingtalkLocalInspection {
  source: 'dingtalk'
  state: 'detected' | 'not_found' | 'unsupported_platform' | 'unreadable'
  checkedAt: string
  client?: { version: string; build: string }
  accounts: DingtalkLocalAccount[]
  message: string
  truncated: boolean
}
