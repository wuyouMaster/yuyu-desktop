import type { EntityId, NativeEntityRef } from './entity-id'

export type EntityExtensions = Record<string, unknown>

export interface SourceEntityFields {
  id: EntityId
  nativeRef: NativeEntityRef
  extensions?: EntityExtensions
  raw?: unknown
}

export interface Account extends SourceEntityFields {
  kind: 'account'
  source: string
  displayName?: string
}

/** Organizations and their member identities stay inside the source/account boundary. */
export interface Organization extends SourceEntityFields {
  kind: 'organization'
  accountId: EntityId
  displayName: string
}

export interface OrganizationIdentity extends SourceEntityFields {
  kind: 'organizationIdentity'
  accountId: EntityId
  organizationId: EntityId
  participantId: EntityId
  displayName?: string
}

/** Unknown ownership must not be treated as a personal conversation. */
export type OrganizationAffiliation =
  | { kind: 'unknown' }
  | { kind: 'unaffiliated' }
  | { kind: 'organizations'; organizationIds: EntityId[] }

export type ParticipantKind = 'person' | 'bot' | 'official' | 'unknown'

export interface Participant extends SourceEntityFields {
  kind: 'participant'
  participantKind: ParticipantKind
  displayName: string
  avatar?: string
  aliases?: string[]
}

export type ConversationKind = 'direct' | 'group' | 'channel'

export interface Conversation extends SourceEntityFields {
  kind: 'conversation'
  conversationKind: ConversationKind
  accountId: EntityId
  title: string
  avatar?: string
  affiliation?: OrganizationAffiliation
}

export type MembershipRole = 'owner' | 'admin' | 'member' | 'unknown'

export interface Membership extends SourceEntityFields {
  kind: 'membership'
  conversationId: EntityId
  participantId: EntityId
  nickname?: string
  organizationIdentityId?: EntityId
  role?: MembershipRole
}

export type AssetKind = 'image' | 'video' | 'audio' | 'file' | 'sticker'
export type AssetState = 'unresolved' | 'available' | 'unavailable'

export interface Asset extends SourceEntityFields {
  kind: 'asset'
  assetKind: AssetKind
  state: AssetState
  uri?: string
  thumbnailUri?: string
  name?: string
  mimeType?: string
  byteLength?: number
  durationMs?: number
}

export interface ForwardedItem {
  senderId?: EntityId
  sentAt?: number
  text?: string
  content?: MessageContent
  nested?: ForwardedItem[]
  extensions?: EntityExtensions
}

export interface ShareArticle {
  title: string
  description?: string
  url?: string
  coverUrl?: string
}

export interface PaymentContent {
  type: 'redPacket' | 'transfer'
  title?: string
  description?: string
  amountText?: string
  status?: string
  extensions?: EntityExtensions
}

export type MessageContent =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      assetId?: EntityId
      localPath?: string
      localPaths?: string[]
      extensions?: EntityExtensions
    }
  | { type: 'video'; assetId?: EntityId; durationMs?: number; extensions?: EntityExtensions }
  | {
      type: 'audio'
      assetId?: EntityId
      localPath?: string
      durationMs?: number
      extensions?: EntityExtensions
    }
  | {
      type: 'file'
      assetId?: EntityId
      localPath?: string
      name?: string
      extensions?: EntityExtensions
    }
  | { type: 'sticker'; assetId?: EntityId; localPath?: string; extensions?: EntityExtensions }
  | {
      type: 'location'
      latitude: number
      longitude: number
      label?: string
      extensions?: EntityExtensions
    }
  | {
      type: 'contact'
      participantId?: EntityId
      displayName?: string
      extensions?: EntityExtensions
    }
  | {
      type: 'share'
      title: string
      description?: string
      url?: string
      appName?: string
      articles?: ShareArticle[]
      extensions?: EntityExtensions
    }
  | {
      type: 'forward'
      title?: string
      description?: string
      items: ForwardedItem[]
      extensions?: EntityExtensions
    }
  | {
      type: 'miniProgram'
      title: string
      description?: string
      appName?: string
      extensions?: EntityExtensions
    }
  | { type: 'payment'; payment: PaymentContent }
  | {
      type: 'quote'
      text?: string
      senderId?: EntityId
      quotedMessageId?: EntityId
      extensions?: EntityExtensions
    }
  | { type: 'call'; durationMs?: number; status?: string; extensions?: EntityExtensions }
  | { type: 'system'; text: string; extensions?: EntityExtensions }
  | { type: 'unknown'; platformType: string | number; raw: unknown }

export interface Message extends SourceEntityFields {
  kind: 'message'
  accountId: EntityId
  conversationId: EntityId
  senderId?: EntityId
  sentAt?: number
  direction: 'incoming' | 'outgoing' | 'unknown'
  content: MessageContent
  recalled?: boolean
  replyToId?: EntityId
}
