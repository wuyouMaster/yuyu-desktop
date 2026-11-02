import { execFile } from 'node:child_process'
import { dirname } from 'node:path'
import type { ImageMediaRuntimePort } from '../../shared/image-media-runtime-port'
import { RuntimeRpcError } from '../../shared/runtime-rpc'
import { WechatMediaFilesClient } from './wechat-media-files-client'
import { WechatImageMediaPort } from './wechat-image-media-port'
import { applicationCacheDirectory, createApplicationRuntime } from './application-runtimes'
import { findResource } from '../resource-paths'
function command(
  executable: string,
  args: string[]
): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) =>
    execFile(
      executable,
      args,
      { timeout: 7000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ success: !error, output: `${stdout}\n${stderr}` })
    )
  )
}
export const applicationImageMedia: ImageMediaRuntimePort = {
  create(options) {
    const root = options.database?.getAccountRoot() || options.accountRoot
    if (!root) throw new RuntimeRpcError('INVALID_ARGUMENT')
    const xorKey = Number(options.xorKey || '0')
    if (!Number.isInteger(xorKey) || xorKey < 0 || xorKey > 255)
      throw new RuntimeRpcError('INVALID_ARGUMENT')
    const rpc = createApplicationRuntime('wechat')
    const files = new WechatMediaFilesClient(rpc)
    try {
      files.open(root, { xorKey, aesKey: options.aesKey })
      const port = new WechatImageMediaPort(
        files,
        root,
        applicationCacheDirectory('wechat-images'),
        options.database ?? undefined
      )
      let closed = false
      return {
        id: 'wechat-go-image',
        source: 'wechat',
        accountId: root,
        protocolVersion: 1,
        implementation: port,
        health: () => ({ state: closed ? 'unavailable' : 'ready' }),
        dispose: async () => {
          closed = true
          try {
            port.dispose()
          } finally {
            await rpc.close()
          }
        }
      }
    } catch (error) {
      void rpc.close().catch(() => {})
      throw error
    }
  },
  resolveFfmpegExecutable() {
    const path = findResource(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    if (!path) throw new RuntimeRpcError('CAPABILITY_UNAVAILABLE')
    return path
  },
  async inspectImageDecoderExecutable(executable) {
    const version = await command(executable, ['-hide_banner', '-version'])
    if (!version.success || !/ffmpeg version/i.test(version.output))
      return { installed: false, supportsHevc: false }
    const decoders = await command(executable, ['-hide_banner', '-decoders'])
    return {
      installed: true,
      supportsHevc: decoders.success && /^\s*[A-Z.]{6}\s+hevc\s/im.test(decoders.output)
    }
  },
  async inspectImageDecoderStatus(selectedPath) {
    let path: string
    try {
      path = selectedPath || this.resolveFfmpegExecutable()
    } catch {
      return { installed: false, available: false, source: 'none', selected: false }
    }
    const info = await this.inspectImageDecoderExecutable(path)
    return {
      installed: info.installed,
      available: info.supportsHevc,
      source: selectedPath ? 'selected' : 'bundled',
      selected: !!selectedPath,
      directory: dirname(path)
    }
  }
}
