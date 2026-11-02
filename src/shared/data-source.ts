import type { ReadContext, SourceIdentityState, SourceOperationContext } from './source-context'
import type {
  Account,
  Asset,
  Conversation,
  Membership,
  Message,
  Participant
} from './domain-entities'
import type { EntityId } from './entity-id'

export interface Page<T> {
  items: T[]
  nextCursor?: string
}

export interface ConversationQuery {
  context?: ReadContext
  accountId?: EntityId
  kind?: Conversation['conversationKind']
  cursor?: string
  limit?: number
}

export interface MessageQuery {
  context?: ReadContext
  conversationId: EntityId
  startTime?: number
  endTime?: number
  cursor?: string
  limit?: number
}

export interface MessageAroundQuery {
  context?: ReadContext
  conversationId: EntityId
  messageId: EntityId
  /** Unix epoch milliseconds. */
  anchorTime?: number
  radiusSeconds?: number
}

export interface MessagesAroundPage {
  items: Message[]
  found: boolean
  radiusSeconds: number
  truncated: boolean
}

export interface ProviderCapabilities {
  supportsRecall: boolean
  supportsPayment: boolean
  canSend: boolean
  hasGroupNicknames: boolean
  supportsRealtime: boolean
  supportsLazyAssets: boolean
}

export interface ProviderHealth {
  state: 'ready' | 'degraded' | 'offline'
  available: boolean
  message?: string
  /** Capture time of a local snapshot, in Unix milliseconds, when applicable. */
  capturedAt?: number
}

export interface ProviderDescriptor {
  source: string
  accountId: EntityId
  capabilities: ProviderCapabilities
  health(): ProviderHealth
}

/** Serializable provider metadata for renderer and agent capability checks. */
export interface ProviderSnapshot {
  context?: SourceOperationContext
  identityState?: SourceIdentityState
  source: string
  accountId: EntityId
  capabilities: ProviderCapabilities
  health: ProviderHealth
  /** Optional write capability for sources whose local store is read-only. */
  send?: {
    capabilities: ProviderCapabilities
    health: ProviderHealth
  }
}

export interface AccountRepository {
  listAccounts(): Promise<Page<Account>>
}

export interface ConversationRepository {
  listConversations(query?: ConversationQuery): Promise<Page<Conversation>>
}

export interface ParticipantRepository {
  listParticipants(accountId: EntityId, context?: ReadContext): Promise<Page<Participant>>
}

export interface MembershipRepository {
  listMemberships(conversationId: EntityId, context?: ReadContext): Promise<Page<Membership>>
}

export interface MessageRepository {
  listMessages(query: MessageQuery): Promise<Page<Message>>
  listMessagesAround(query: MessageAroundQuery): Promise<MessagesAroundPage>
}

export interface AssetRepository {
  resolveAsset(assetId: EntityId, context?: ReadContext): Promise<Asset>
}

export interface SaveAssetResult {
  success: boolean
  canceled?: boolean
  error?: string
}

export interface ReadProvider
  extends
    ProviderDescriptor,
    AccountRepository,
    ConversationRepository,
    ParticipantRepository,
    MembershipRepository,
    MessageRepository,
    AssetRepository {
  /** Promise to enforce scopes and recheck identity before native data access. */
  contextAware?: true
}

export interface SendProvider extends ProviderDescriptor {
  /** Must recheck expectedContext at native dispatch, including after async media work. */
  contextAware?: true
  /** Refresh native write capability before publishing a provider snapshot. */
  refresh?(): Promise<void>
  send(request: SendRequest): Promise<SendResult>
}

export interface SendRequest {
  expectedContext?: SourceOperationContext
  conversationId: EntityId
  content: Message['content']
}

export interface SendResult {
  accepted: boolean
  messageId?: EntityId
  error?: string
}

export interface WatchProvider extends ProviderDescriptor {
  watch(handler: (event: WatchEvent) => void): Promise<() => void>
}

export type WatchEvent =
  | { type: 'messageCreated'; message: Message }
  | { type: 'messageUpdated'; message: Message }
  | { type: 'conversationUpdated'; conversation: Conversation }
