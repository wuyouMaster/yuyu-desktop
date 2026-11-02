import { basename, resolve } from 'path'
import type { Asset } from '../../shared/domain-entities'
import type { EntityId } from '../../shared/entity-id'
import type { SaveAssetResult } from '../../shared/data-source'

export interface AssetSaveDependencies {
  resolveAsset(id: EntityId): Promise<Asset>
  pathForUrl(url: string): string | undefined
  chooseDestination(name: string): Promise<string | undefined>
  copyFile(source: string, destination: string): Promise<void>
}

/** Only a current-account asset and an application-issued local token may be saved. */
export async function saveUnifiedAsset(
  id: EntityId,
  deps: AssetSaveDependencies
): Promise<SaveAssetResult> {
  try {
    const asset = await deps.resolveAsset(id)
    if (asset.assetKind !== 'file' || asset.state !== 'available' || !asset.uri) {
      return { success: false, error: '附件尚未下载到本机，无法保存' }
    }
    if (!deps.pathForUrl(asset.uri)) return { success: false, error: '附件已失效，请刷新聊天记录' }
    const destination = await deps.chooseDestination(basename(asset.name || '附件'))
    if (!destination) return { success: false, canceled: true }

    // The account may have changed while the native save dialog was open.
    const current = await deps.resolveAsset(id)
    const source =
      current.assetKind === 'file' && current.state === 'available' && current.uri
        ? deps.pathForUrl(current.uri)
        : undefined
    if (!source) return { success: false, error: '附件已失效，请刷新聊天记录' }
    if (resolve(source) !== resolve(destination)) await deps.copyFile(source, destination)
    return { success: true }
  } catch {
    return { success: false, error: '附件保存失败，请确认账号未切换且目标目录可写' }
  }
}
