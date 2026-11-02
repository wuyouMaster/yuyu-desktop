import type { AccountIdentityPort } from '../../shared/account-identity-port'
import { accountIdentityProviders } from './account-identity-provider-registry'
export type { LocalAccountIdentity } from '../../shared/account-identity-port'

export const readLocalAccountIdentity: AccountIdentityPort['readLocalAccountIdentity'] = (
  ...args
) =>
  accountIdentityProviders
    .resolve(['readLocalAccountIdentity'])
    .port.readLocalAccountIdentity(...args)

export const accountDirectoryBelongsToIdentity: AccountIdentityPort['accountDirectoryBelongsToIdentity'] =
  (...args) =>
    accountIdentityProviders
      .resolve(['accountDirectoryBelongsToIdentity'])
      .port.accountDirectoryBelongsToIdentity(...args)

export const deriveAccountWxid: AccountIdentityPort['deriveAccountWxid'] = (...args) =>
  accountIdentityProviders.resolve(['deriveAccountWxid']).port.deriveAccountWxid(...args)
