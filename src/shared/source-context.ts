import type { Organization, OrganizationIdentity } from './domain-entities'
import { parseEntityId, type EntityId } from './entity-id'

/** An account context is explicitly organization-independent, not an unknown identity. */
export type ActiveIdentity =
  | { kind: 'account' }
  | { kind: 'organization'; organizationId: EntityId; identityId: EntityId }
  | { kind: 'unknown' }

/** Filtering data does not select or change the identity used to send. */
export type ReadScope =
  | { kind: 'all' }
  | { kind: 'unaffiliated' }
  | { kind: 'organization'; organizationId: EntityId }

export interface SourceIdentityState {
  /** Must change on every native identity transition, including A -> B -> A. */
  revision: string
  activeIdentity: ActiveIdentity
  organizations: Organization[]
  identities: OrganizationIdentity[]
}

export interface SourceOperationContext {
  source: string
  accountId: EntityId
  /** Issued by the application on activation; prevents reuse after reconnect. */
  sessionId: string
  revision: string
  identity: ActiveIdentity
}

export interface ReadContext {
  expected: SourceOperationContext
  scope: ReadScope
}

/** No switch method: observing a provider must never switch the native client. */
export interface IdentityContextProvider {
  source: string
  accountId: EntityId
  inspectIdentity(): Promise<SourceIdentityState>
}

export function belongsToAccount(id: EntityId, source: string, accountId: EntityId): boolean {
  try {
    const ref = parseEntityId(id)
    const account = parseEntityId(accountId)
    return account.source === source && ref.source === source && ref.account === account.account
  } catch {
    return false
  }
}

export function identityKey(identity: ActiveIdentity): string {
  if (identity?.kind === 'account' || identity?.kind === 'unknown') return identity.kind
  if (identity?.kind === 'organization' && identity.organizationId && identity.identityId) {
    return JSON.stringify(['organization', identity.organizationId, identity.identityId])
  }
  throw new Error('数据源身份无效')
}

/** Include scope plus this key in cursors, caches, search indexes and report jobs. */
export function sourceContextKey(context: SourceOperationContext): string {
  if (!context?.source || !context.accountId || !context.sessionId || !context.revision) {
    throw new Error('数据源上下文无效')
  }
  return JSON.stringify([
    context.source,
    context.accountId,
    context.sessionId,
    context.revision,
    identityKey(context.identity)
  ])
}

export function readContextKey(context: ReadContext): string {
  const scope = context.scope
  if (
    !scope ||
    !['all', 'unaffiliated', 'organization'].includes(scope.kind) ||
    (scope.kind === 'organization' && !scope.organizationId)
  ) {
    throw new Error('数据浏览范围无效')
  }
  return JSON.stringify([
    sourceContextKey(context.expected),
    scope.kind,
    scope.kind === 'organization' ? scope.organizationId : null
  ])
}
