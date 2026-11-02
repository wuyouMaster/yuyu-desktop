import { realpathSync } from 'node:fs'
import path from 'node:path'
import type { DatabasePort } from '../shared/database-port'
import { locateApplicationAsset } from './runtime-rpc/application-assets'
export type FileAssetResult = {
  success: boolean
  filePath?: string
  fileName?: string
  error?: string
}
export class FileAssetService {
  constructor(private readonly client: Pick<DatabasePort, 'getAccountRoot'>) {}
  resolve(fileTitle: string, createTime?: number): FileAssetResult {
    const title = path.basename(
      String(fileTitle || '')
        .trim()
        .replace(/\\/g, '/')
    )
    if (!title) return { success: false, error: '文件名为空，无法定位本地附件' }
    const asset = locateApplicationAsset(this.client.getAccountRoot(), {
      kind: 'file',
      name: title,
      created: createTime
    })
    return asset
      ? { success: true, filePath: realpathSync(asset.path), fileName: path.basename(asset.path) }
      : { success: false, error: `本地未找到文件附件：${title}` }
  }
}
