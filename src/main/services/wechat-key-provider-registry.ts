import type { WechatKeyPort } from '../../shared/wechat-key-port'
import { WechatDatabaseKeyProvider } from '../runtime-rpc/wechat-database-key-provider'
import { WechatImageKeyProvider } from '../runtime-rpc/wechat-image-key-provider'
import { createApplicationRuntime } from '../runtime-rpc/application-runtimes'
import { CapabilityProviderRegistry, protocolMethods } from './capability-provider-registry'

export const wechatKeyProviders = new CapabilityProviderRegistry<WechatKeyPort>(
  'wechat',
  '',
  1,
  protocolMethods<WechatKeyPort>({
    autoGetDbKey: true,
    autoGetImageKey: true,
    getIntelEnvironmentStatus: true,
    installIntelKeyRuntime: true
  })
)
const database = new WechatDatabaseKeyProvider(async options => createApplicationRuntime('wechat', options.shutdownGraceMs))
const image = new WechatImageKeyProvider(async () => createApplicationRuntime('wechat'))
wechatKeyProviders.register({
  id: 'wechat-go-key', source: 'wechat', accountId: '', protocolVersion: 1,
  implementation: { autoGetDbKey: database.autoGetDbKey.bind(database), autoGetImageKey: image.autoGetImageKey.bind(image) },
  health: () => ({ state: 'ready' })
})
