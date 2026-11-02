import type { AccountIdentityPort } from '../../shared/account-identity-port'
import { applicationWechatStorage } from '../runtime-rpc/application-runtimes'
import { CapabilityProviderRegistry, protocolMethods } from './capability-provider-registry'

export const accountIdentityProviders = new CapabilityProviderRegistry<AccountIdentityPort>(
  'wechat',
  '',
  1,
  protocolMethods<AccountIdentityPort>({
    readLocalAccountIdentity: true,
    accountDirectoryBelongsToIdentity: true,
    deriveAccountWxid: true
  })
)
accountIdentityProviders.register({
  id: 'wechat-go-identity',
  source: 'wechat',
  accountId: '',
  protocolVersion: 1,
  implementation: {
    readLocalAccountIdentity: (...args: Parameters<AccountIdentityPort['readLocalAccountIdentity']>) => applicationWechatStorage().readLocalAccountIdentity(...args),
    accountDirectoryBelongsToIdentity: (...args: Parameters<AccountIdentityPort['accountDirectoryBelongsToIdentity']>) => applicationWechatStorage().accountDirectoryBelongsToIdentity(...args),
    deriveAccountWxid: (...args: Parameters<AccountIdentityPort['deriveAccountWxid']>) => applicationWechatStorage().deriveAccountWxid(...args)
  },
  health: () => ({ state: 'ready' })
})
