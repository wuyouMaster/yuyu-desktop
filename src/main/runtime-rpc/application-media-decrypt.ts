import { createApplicationRuntime } from './application-runtimes'
import { WechatCDNClient } from './wechat-cdn-client'
export async function decryptMessagePayload(key: string, data: Buffer): Promise<Buffer> {
  const rpc = createApplicationRuntime('wechat')
  try { return await new WechatCDNClient(rpc).decrypt(data, key) } finally { await rpc.close() }
}
