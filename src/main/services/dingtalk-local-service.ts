import { promises as fs } from 'node:fs'
import { openRegularFile } from './regular-file'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { DingtalkStore } from './dingtalk-store'
import type {
  DingtalkDatabaseProbe,
  DingtalkLocalAccount,
  DingtalkLocalInspection
} from '../../shared/dingtalk-local'

const execute = promisify(execFile)
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'ascii')
const MAX_ACCOUNTS = 200

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException)?.code
}

async function plainDirectory(path: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(path)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

/** Read only the format header. Never open a SQLite handle, touch WAL/SHM, or dump contents. */
async function probeDatabase(
  directory: string,
  name: DingtalkDatabaseProbe['name']
): Promise<DingtalkDatabaseProbe> {
  const result: DingtalkDatabaseProbe = { name, format: 'unreadable', walPresent: false }
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    const wal = await fs.lstat(join(directory, name + '-wal')).catch(() => undefined)
    result.walPresent = Boolean(wal?.isFile() && !wal.isSymbolicLink())
    handle = await openRegularFile(join(directory, name))
    const stat = await handle.stat()
    if (!stat.isFile()) return result
    result.byteLength = stat.size
    const header = Buffer.alloc(16)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    result.format =
      bytesRead < header.length
        ? 'truncated'
        : header.equals(SQLITE_HEADER)
          ? 'sqlite'
          : 'encoded_or_unknown'
  } catch (error) {
    result.format = errorCode(error) === 'ENOENT' ? 'missing' : 'unreadable'
  } finally {
    await handle?.close()
  }
  return result
}

export interface DingtalkLocalServiceOptions {
  platform?: NodeJS.Platform
  dataRoot?: string
  preferences?: string
  helperPath?: string
  appPaths?: string[]
  storeFactory?: (options: {
    root: string
    preferences: string
    helperPath?: string
  }) => Pick<DingtalkStore, 'account'>
}

/** Discovery adapter that upgrades an account only after the native read helper connects. */
export class DingtalkLocalService {
  private readonly platform: NodeJS.Platform
  private readonly dataRoot: string
  private readonly preferences: string
  private readonly helperPath: string | undefined
  private readonly appPaths: string[]
  private readonly storeFactory: NonNullable<DingtalkLocalServiceOptions['storeFactory']>
  private inFlight: Promise<DingtalkLocalInspection> | undefined

  constructor(options: DingtalkLocalServiceOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.dataRoot = options.dataRoot ?? join(homedir(), 'Library/Application Support/DingTalkMac')
    this.preferences =
      options.preferences ?? join(homedir(), 'Library/Preferences/com.alibaba.DingTalkMac.plist')
    this.helperPath = options.helperPath
    this.storeFactory = options.storeFactory ?? ((storeOptions) => new DingtalkStore(storeOptions))
    this.appPaths = options.appPaths ?? [
      '/Applications/DingTalk.app',
      join(homedir(), 'Applications/DingTalk.app')
    ]
  }

  inspect(): Promise<DingtalkLocalInspection> {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.inspectOnce().finally(() => {
      this.inFlight = undefined
    })
    return this.inFlight
  }

  private async inspectClient(): Promise<DingtalkLocalInspection['client']> {
    for (const appPath of this.appPaths) {
      try {
        const { stdout } = await execute(
          '/usr/bin/plutil',
          ['-convert', 'json', '-o', '-', join(appPath, 'Contents/Info.plist')],
          { timeout: 2000, maxBuffer: 256 * 1024 }
        )
        const info = JSON.parse(stdout)
        if (info.CFBundleIdentifier !== 'com.alibaba.DingTalkMac') continue
        return {
          version: String(info.CFBundleShortVersionString || ''),
          build: String(info.CFBundleVersion || '')
        }
      } catch {
        // A missing client must not hide a retained local database directory.
      }
    }
    return undefined
  }

  private async inspectOnce(): Promise<DingtalkLocalInspection> {
    const result: DingtalkLocalInspection = {
      source: 'dingtalk',
      state: 'not_found',
      checkedAt: new Date().toISOString(),
      accounts: [],
      message: '未发现钉钉本地聊天库。请先在本机钉钉中登录并打开会话，再重新检测。',
      truncated: false
    }
    if (this.platform !== 'darwin') {
      result.state = 'unsupported_platform'
      result.message = '目前仅验证了 macOS 的钉钉目录发现，其他平台尚未适配。'
      return result
    }
    result.client = await this.inspectClient()
    try {
      const rootStat = await fs.lstat(this.dataRoot)
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        result.state = 'unreadable'
        result.message = '无法检查钉钉数据目录；目录类型异常或使用了符号链接。'
        return result
      }
      const entries = await fs.readdir(this.dataRoot, { withFileTypes: true })
      const directories = entries
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))
      result.truncated = directories.length > MAX_ACCOUNTS
      const directoryNamesById = new Map<string, string>()
      for (const entry of directories.slice(0, MAX_ACCOUNTS)) {
        const accountRoot = join(this.dataRoot, entry.name)
        const databaseRoot = join(accountRoot, 'DBFiles')
        if (!(await plainDirectory(databaseRoot))) continue
        const databases = await Promise.all([
          probeDatabase(databaseRoot, 'dingtalk.db'),
          probeDatabase(databaseRoot, 'members.db')
        ])
        if (databases.every((database) => database.format === 'missing')) continue
        const messages = databases[0]
        const id = createHash('sha256').update(accountRoot).digest('hex').slice(0, 24)
        const state: DingtalkLocalAccount['state'] =
          messages.format === 'sqlite'
            ? 'needs_schema'
            : messages.format === 'encoded_or_unknown'
              ? 'needs_decoder'
              : 'unreadable'
        const publicId = `dingtalk-local:${id}`
        directoryNamesById.set(publicId, entry.name)
        result.accounts.push({
          id: publicId,
          label: `本地账号 ${result.accounts.length + 1}`,
          databases,
          state,
          canRead: false,
          canSend: false
        })
      }
      if (result.accounts.length) {
        try {
          const account = await this.storeFactory({
            root: this.dataRoot,
            preferences: this.preferences,
            helperPath: this.helperPath
          }).account()
          const connected = result.accounts.find(
            (item) => directoryNamesById.get(item.id) === account.accountKey
          )
          if (connected) {
            connected.state = 'ready'
            connected.canRead = true
          }
        } catch {
          // Keep discovery results visible; the connection error is surfaced when the user connects.
        }
      }
      if (result.accounts.length) {
        result.state = 'detected'
        result.message = result.accounts.some((account) => account.canRead)
          ? '已发现并可连接本机钉钉数据。会话和消息可读取，发送能力会在打开数据源后单独检测。'
          : '已发现本地数据，但当前 native reader 尚未连接；请确认钉钉已登录后重试。'
      }
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        result.state = 'unreadable'
        result.message = '无法读取钉钉数据目录，请检查系统对该目录的访问权限后重试。'
      }
    }
    return result
  }
}

export const dingtalkLocalService = new DingtalkLocalService()
