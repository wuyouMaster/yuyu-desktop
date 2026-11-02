import { join, resolve } from 'node:path'
import type { MediaAssetQuery } from '../../shared/wechat-media-files-protocol'
import { WechatMediaFilesClient } from './wechat-media-files-client'
import { applicationMediaTransport } from './application-runtimes'
const files = (root: string) => {
  const client = new WechatMediaFilesClient(applicationMediaTransport())
  client.open(resolve(root))
  return client
}
export function locateApplicationAsset(root: string, query: MediaAssetQuery) {
  const client = files(root)
  try {
    const result = client.locateAsset(query)
    return result
      ? {
          ...result,
          path: join(resolve(root), result.path),
          poster: result.poster ? join(resolve(root), result.poster) : undefined
        }
      : null
  } finally {
    client.close()
  }
}
export async function readApplicationVoice(root: string, query: MediaAssetQuery) {
  const client = files(root)
  try {
    const result = client.locateAsset(query)
    if (!result?.codec) return null
    const data = await client.readFileAsync(result.path, 48 * 1024 * 1024)
    return { data, codec: result.codec }
  } finally {
    client.close()
  }
}
