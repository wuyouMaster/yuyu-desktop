import type { DatabaseRuntimePort } from '../../shared/database-runtime-port'
import { CapabilityProviderRegistry, protocolMethods } from './capability-provider-registry'
import { WechatDatabaseRuntime } from '../runtime-rpc/wechat-database-runtime'
import { createApplicationRuntime } from '../runtime-rpc/application-runtimes'

export const databaseRuntimeProviders = new CapabilityProviderRegistry<DatabaseRuntimePort>(
  'wechat',
  '',
  1,
  protocolMethods<DatabaseRuntimePort>({ bootstrap: true, open: true, openAsync: true })
)
databaseRuntimeProviders.register({
  id: 'wechat-go',
  source: 'wechat',
  accountId: '',
  protocolVersion: 1,
  implementation: new WechatDatabaseRuntime(() => createApplicationRuntime('wechat')),
  health: () => ({ state: 'ready' })
})
