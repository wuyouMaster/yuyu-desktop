/**
 * An entity id is opaque outside the data-source boundary.
 *
 * The serialized form keeps the source and account scope visible for logs and
 * debugging, while escaping delimiters so native ids remain lossless.
 */
export type EntityId = string & { readonly __entityId: unique symbol }

export interface NativeEntityRef {
  source: string
  account: string
  native: string
}

const encodePart = (value: string): string => encodeURIComponent(value)

export function serializeEntityId(ref: NativeEntityRef): EntityId {
  if (!ref.source || !ref.account || !ref.native) {
    throw new Error('Entity id requires source, account, and native values')
  }
  return [ref.source, ref.account, ref.native].map(encodePart).join(':') as EntityId
}

export function parseEntityId(value: EntityId | string): NativeEntityRef {
  const parts = String(value).split(':')
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error('Invalid entity id')
  }
  return {
    source: decodeURIComponent(parts[0]),
    account: decodeURIComponent(parts[1]),
    native: decodeURIComponent(parts[2])
  }
}

/** A native member id is only unique inside its organization. Keep the outer ID format stable. */
export function createOrganizationIdentityId(
  organizationId: EntityId,
  nativeMemberId: string
): EntityId {
  if (!nativeMemberId) throw new Error('Organization identity requires a native member id')
  const organization = parseEntityId(organizationId)
  return serializeEntityId({
    source: organization.source,
    account: organization.account,
    native: JSON.stringify(['organizationIdentity', organization.native, nativeMemberId])
  })
}
