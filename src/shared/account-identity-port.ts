export interface LocalAccountIdentity {
  wxid: string
  nickname?: string
  avatar?: string
}

export interface AccountIdentityPort {
  readLocalAccountIdentity(dataRoot: string): LocalAccountIdentity | null
  accountDirectoryBelongsToIdentity(directoryName: string, wxid: string): boolean
  deriveAccountWxid(directoryName: string): string | undefined
}
