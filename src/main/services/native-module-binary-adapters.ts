import { promises as fs } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { dirname, join, resolve } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import {
  getNativeModuleManifest,
  type NativeModuleCapabilityExecution,
  type NativeModuleHealth,
  type NativeModuleId,
  type NativeModuleSource
} from '../../shared/native-modules'
import { NativeModuleCompatibilityService } from './native-module-compatibility-service'

const execFileAsync = promisify(execFile)
const SAFE_ENV = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8' }
const DEFAULT_TIMEOUT_MS = 30_000

interface DatabaseSession {
  accountRoot: string
  databasePath?: string
  keyFile: string
  libraryPath?: string
  profile?: string
}

interface DatabaseCursor {
  context: DatabaseSession
  sessionId: string
  batchSize: number
  offset: number
}

interface SyncSession {
  accountRoot: string
  statePath: string
  journalPath?: string
  watchPaths: string[]
  intervalMs?: number
  maxDepth?: number
  maxFiles?: number
}

interface XsendSession {
  accountRoot: string
  keyFile: string
  resourceDir?: string
  sessionFilter?: string
  includeReceived?: boolean
  readLimit?: number
}

export interface NativeModuleBinaryAdapterOptions {
  resourcesRoot: string
  source?: NativeModuleSource
  timeoutMs?: number
}

function record(input: unknown, operation: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(operation + ' input must be an object')
  }
  return input as Record<string, unknown>
}

function stringValue(input: Record<string, unknown>, key: string, operation: string): string {
  const value = input[key]
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(operation + ' requires ' + key)
  return value.trim()
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function commandPath(resourcesRoot: string, name: string): string {
  return join(resourcesRoot, name)
}

async function assertFile(path: string, label: string): Promise<void> {
  try {
    const stat = await fs.stat(path)
    if (!stat.isFile()) throw new Error()
  } catch {
    throw new Error(label + ' is not an accessible file')
  }
}

function argsWithCommon(context: DatabaseSession): string[] {
  const args = ['--account-root', context.accountRoot, '--key-file', context.keyFile]
  if (context.databasePath) args.push('--db', context.databasePath)
  if (context.libraryPath) args.push('--library', context.libraryPath)
  if (context.profile) args.push('--profile', context.profile)
  return args
}

function parseJson(stdout: string): unknown {
  const value = stdout.trim()
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    throw new Error('native binary returned invalid JSON')
  }
}

export function redactDerivedLocalKeys(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const result = { ...(value as Record<string, unknown>) }
  const aesKey = result.aesKey
  delete result.aesKey
  if (typeof aesKey === 'string') result.aesKeyAvailable = aesKey.length > 0
  return result
}

async function runJson(
  binary: string,
  args: string[],
  timeoutMs: number,
  resourcesRoot: string,
  acceptedExitCodes: readonly number[] = []
): Promise<unknown> {
  await assertFile(binary, 'native binary')
  try {
    const result = await execFileAsync(binary, args, {
      cwd: dirname(binary),
      env: {
        ...SAFE_ENV,
        // Keep the bundled WCDB runtime ahead of the top-level compatibility
        // shim. The latter is a different build that expects a separate
        // WCDB.framework and breaks when inherited by the subprocess.
        DYLD_LIBRARY_PATH: [join(resourcesRoot, 'macos'), resourcesRoot].join(':')
      },
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024
    })
    return parseJson(String(result.stdout))
  } catch (error) {
    const failure = error as {
      stderr?: string
      stdout?: string
      killed?: boolean
      signal?: string
      code?: string | number
    }
    if (typeof failure.code === 'number' && acceptedExitCodes.includes(failure.code)) {
      return parseJson(String(failure.stdout ?? ''))
    }
    if (failure.killed || failure.signal === 'SIGTERM') throw new Error('native binary timed out')
    throw new Error('native binary failed with exit code ' + String(failure.code ?? 'unknown'))
  }
}

async function runJsonLines(
  binary: string,
  args: string[],
  timeoutMs: number,
  resourcesRoot: string
): Promise<unknown[]> {
  await assertFile(binary, 'native binary')
  try {
    const result = await execFileAsync(binary, args, {
      cwd: dirname(binary),
      env: {
        ...SAFE_ENV,
        DYLD_LIBRARY_PATH: [join(resourcesRoot, 'macos'), resourcesRoot].join(':')
      },
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024
    })
    return String(result.stdout)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          throw new Error('native binary returned invalid JSON')
        }
      })
  } catch (error) {
    const failure = error as { killed?: boolean; signal?: string; code?: string | number }
    if (failure.killed || failure.signal === 'SIGTERM') throw new Error('native binary timed out')
    throw new Error('native binary failed with exit code ' + String(failure.code ?? 'unknown'))
  }
}

function health(
  binary: string,
  implementation: string,
  capabilityExecution?: Record<string, NativeModuleCapabilityExecution>
): Promise<NativeModuleHealth> {
  return fs.stat(binary).then(
    (stat) => ({
      availability: 'available',
      execution: 'ready',
      checkedAt: new Date().toISOString(),
      details: { implementation, executable: stat.isFile() },
      capabilityExecution
    }),
    () => ({
      availability: 'unavailable',
      execution: 'unavailable',
      checkedAt: new Date().toISOString(),
      message: 'Native binary is missing: ' + binary
    })
  )
}

function registerBinaryAtRoot(
  service: NativeModuleCompatibilityService,
  id: NativeModuleId,
  resourcesRoot: string,
  binaryName: string,
  capabilityExecution: Record<string, NativeModuleCapabilityExecution> | undefined,
  invoke: (operation: string, input: unknown) => Promise<unknown>,
  source: NativeModuleSource = 'bundled-binary'
): void {
  const manifest = getNativeModuleManifest(id)
  const binary = commandPath(resourcesRoot, binaryName)
  service.register({
    registration: { manifest, source, packageRoot: resourcesRoot },
    healthCheck: () => health(binary, 'c-cli-subprocess', capabilityExecution),
    invoke: (operation, input) => invoke(operation, input)
  })
}

function parseDatabaseInput(input: unknown, operation: string): DatabaseSession {
  const value = record(input, operation)
  const accountRoot = stringValue(value, 'accountRoot', operation)
  const keyFile = optionalString(value, 'keyFile')
  if (!keyFile) throw new Error(operation + ' requires keyFile for native subprocess execution')
  return {
    accountRoot,
    keyFile,
    databasePath: optionalString(value, 'databasePath'),
    libraryPath: optionalString(value, 'libraryPath'),
    profile: optionalString(value, 'profile')
  }
}

export function registerNativeModuleBinaryAdapters(
  service: NativeModuleCompatibilityService,
  options: NativeModuleBinaryAdapterOptions
): void {
  const registerBinary = (...args: Parameters<typeof registerBinaryAtRoot>): void => {
    args[6] ??= options.source ?? 'bundled-binary'
    registerBinaryAtRoot(...args)
  }
  const resourcesRoot = resolve(options.resourcesRoot)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const dbSessions = new Map<string, DatabaseSession>()
  const dbCursors = new Map<string, DatabaseCursor>()
  const syncSessions = new Map<string, SyncSession>()
  const xsendSessions = new Map<string, XsendSession>()

  registerBinary(
    service,
    'wxmessage',
    resourcesRoot,
    'wxmsg_probe',
    undefined,
    async (operation, input) => {
      const value = record(input, operation)
      if (operation === 'message.kind_name') {
        return runJson(
          commandPath(resourcesRoot, 'wxmsg_probe'),
          ['kind-name', '--kind', String(value.kind)],
          timeoutMs,
          resourcesRoot
        )
      }
      const content = stringValue(value, 'content', operation)
      const messageType = String(value.messageType)
      return runJson(
        commandPath(resourcesRoot, 'wxmsg_probe'),
        ['--type', messageType, '--content', content],
        timeoutMs,
        resourcesRoot
      )
    }
  )

  registerBinary(
    service,
    'wxidentity',
    resourcesRoot,
    'wxidentity_probe',
    undefined,
    async (operation, input) => {
      const value = record(input, operation)
      const binary = commandPath(resourcesRoot, 'wxidentity_probe')
      if (operation === 'identity.read_account') {
        return runJson(
          binary,
          ['account', '--data-root', stringValue(value, 'dataRoot', operation)],
          timeoutMs,
          resourcesRoot
        )
      }
      if (operation === 'identity.derive_wxid') {
        return runJson(
          binary,
          ['derive-account', '--directory', stringValue(value, 'directoryName', operation)],
          timeoutMs,
          resourcesRoot
        )
      }
      if (operation === 'identity.account_directory_matches') {
        return runJson(
          binary,
          [
            'directory-match',
            '--directory',
            stringValue(value, 'directoryName', operation),
            '--wxid',
            stringValue(value, 'wxid', operation)
          ],
          timeoutMs,
          resourcesRoot
        )
      }
      if (operation === 'identity.display_name') {
        const args = [
          'contact-name',
          '--username',
          optionalString(value, 'm_nsUsrName') ??
            optionalString(value, 'wxid') ??
            optionalString(value, 'wechatId') ??
            ''
        ]
        for (const [key, flag] of [
          ['m_nsNickName', '--nickname'],
          ['remark', '--remark'],
          ['wechatNickname', '--wechat-nickname']
        ] as const) {
          const item = optionalString(value, key)
          if (item) args.push(flag, item)
        }
        return runJson(binary, args, timeoutMs, resourcesRoot)
      }
      if (operation === 'identity.group_member_display_name') {
        const args = [
          'group-name',
          '--username',
          optionalString(value, 'username') ?? optionalString(value, 'wxid') ?? ''
        ]
        for (const [key, flag] of [
          ['groupNickname', '--group-nickname'],
          ['wechatNickname', '--wechat-nickname']
        ] as const) {
          const item = optionalString(value, key)
          if (item) args.push(flag, item)
        }
        return runJson(binary, args, timeoutMs, resourcesRoot)
      }
      if (operation === 'identity.normalize_avatar_url') {
        return runJson(
          binary,
          ['avatar', '--url', stringValue(value, 'url', operation)],
          timeoutMs,
          resourcesRoot
        )
      }
      throw new Error('C wxidentity adapter does not implement ' + operation)
    }
  )

  registerBinary(
    service,
    'wxasset',
    resourcesRoot,
    'wxasset_probe',
    undefined,
    async (operation, input) => {
      const value = record(input, operation)
      if (operation === 'asset.session_md5') {
        return runJson(
          commandPath(resourcesRoot, 'wxasset_probe'),
          ['session-md5', '--session', stringValue(value, 'sessionId', operation)],
          timeoutMs,
          resourcesRoot
        )
      }
      const accountRoot = stringValue(value, 'accountRoot', operation)
      const args = [operation === 'asset.resolve_image' ? 'image' : 'video', '--root', accountRoot]
      for (const [key, flag] of [
        ['sessionId', '--session'],
        ['sessionMd5', '--session-md5'],
        ['md5', '--md5'],
        ['datName', '--dat']
      ] as const) {
        const item = optionalString(value, key)
        if (item) args.push(flag, item)
      }
      const createTime = optionalNumber(value, 'createTime')
      if (createTime !== undefined) args.push('--time', String(createTime))
      const byteLength = optionalNumber(value, 'byteLength')
      if (byteLength !== undefined) args.push('--bytes', String(byteLength))
      if (operation === 'asset.resolve_image') {
        const mode =
          value.preferThumbnail === true
            ? 'prefer-thumb'
            : value.allowThumbnail === false
              ? 'no-thumb'
              : undefined
        if (mode) args.push('--mode', mode)
      }
      return runJson(
        commandPath(resourcesRoot, 'wxasset_probe'),
        args,
        timeoutMs,
        resourcesRoot,
        [3]
      )
    }
  )

  registerBinary(
    service,
    'wxmedia',
    resourcesRoot,
    'wxmedia_probe',
    {
      'media.transcode': 'inspected'
    },
    async (operation, input) => {
      const value = record(input, operation)
      if (operation === 'media.derive_local_keys') {
        const result = await runJson(
          commandPath(resourcesRoot, 'wxmedia_probe'),
          ['--derive-keys', '--account-root', stringValue(value, 'accountRoot', operation)],
          timeoutMs,
          resourcesRoot
        )
        return redactDerivedLocalKeys(result)
      }
      if (operation === 'media.transcode') {
        const args = [
          '--transcode-input',
          stringValue(value, 'inputPath', operation),
          '--transcode-output',
          stringValue(value, 'outputPath', operation)
        ]
        for (const [key, flag] of [
          ['libwxtransPath', '--libwxtrans'],
          ['multimediadynPath', '--multimediadyn']
        ] as const) {
          const item = optionalString(value, key)
          if (item) args.push(flag, item)
        }
        for (const [key, flag] of [
          ['width', '--width'],
          ['height', '--height'],
          ['fpsOut', '--fps-out'],
          ['videoBitrateKbps', '--video-bitrate-kbps'],
          ['audioChannels', '--audio-channels'],
          ['audioBitrateKbps', '--audio-bitrate-kbps']
        ] as const) {
          const item = optionalNumber(value, key)
          if (item !== undefined) args.push(flag, String(item))
        }
        return runJson(commandPath(resourcesRoot, 'wxmedia_probe'), args, timeoutMs, resourcesRoot)
      }
      const temporaryPaths: string[] = []
      try {
        let inputPath: string
        if (operation === 'media.process_file') {
          inputPath = stringValue(value, 'path', operation)
        } else {
          const data = stringValue(value, 'dataBase64', operation)
          inputPath = join(tmpdir(), 'yuyu-media-' + randomUUID())
          await fs.writeFile(inputPath, Buffer.from(data, 'base64'), { mode: 0o600 })
          temporaryPaths.push(inputPath)
        }
        const args = ['--input', inputPath, '--json']
        const outputPath = optionalString(value, 'outputPath')
        if (outputPath) args.push('--output', outputPath)
        const aesKey = optionalString(value, 'aesKey')
        if (aesKey) {
          const keyPath = join(tmpdir(), 'yuyu-media-key-' + randomUUID())
          await fs.writeFile(keyPath, aesKey + '\n', { mode: 0o600 })
          temporaryPaths.push(keyPath)
          args.push('--aes-key-file', keyPath)
        }
        const xorKey = optionalNumber(value, 'xorKey')
        if (xorKey !== undefined) args.push('--xor-key', String(xorKey))
        const expectedMd5 = optionalString(value, 'expectedMd5')
        if (expectedMd5) args.push('--md5', expectedMd5)
        // Await before the finally block removes temporary input/key files.
        return await runJson(
          commandPath(resourcesRoot, 'wxmedia_probe'),
          args,
          timeoutMs,
          resourcesRoot
        )
      } finally {
        await Promise.all(temporaryPaths.map((path) => fs.rm(path, { force: true })))
      }
    }
  )

  registerBinary(
    service,
    'wxdb',
    resourcesRoot,
    'wxwxdb_probe',
    {
      'database.message_cursor_open': 'inspected',
      'database.message_cursor_fetch': 'inspected',
      'database.message_cursor_close': 'inspected'
    },
    async (operation, input) => {
      const value = record(input, operation)
      if (operation === 'database.open') {
        const context = parseDatabaseInput(value, operation)
        await assertFile(context.keyFile, 'keyFile')
        const id = 'db-' + randomUUID()
        dbSessions.set(id, context)
        return {
          sessionId: id,
          accountRoot: context.accountRoot,
          databasePath: context.databasePath ?? null
        }
      }
      const databaseSessionId = stringValue(value, 'databaseSessionId', operation)
      const context = dbSessions.get(databaseSessionId)
      if (!context) throw new Error('Unknown database session')
      if (operation === 'database.close') {
        for (const [cursorId, cursor] of dbCursors) {
          if (cursor.context === context) dbCursors.delete(cursorId)
        }
        dbSessions.delete(databaseSessionId)
        return { closed: true }
      }
      const binary = commandPath(resourcesRoot, 'wxwxdb_probe')
      const common = argsWithCommon(context)
      if (operation === 'database.profile')
        return {
          accountRoot: context.accountRoot,
          databasePath: context.databasePath ?? null,
          profile: context.profile ?? null
        }
      if (operation === 'database.sessions')
        return runJson(binary, ['sessions', ...common], timeoutMs, resourcesRoot)
      if (operation === 'database.messages') {
        return runJson(
          binary,
          [
            'messages',
            ...common,
            '--session',
            stringValue(value, 'sessionId', operation),
            '--limit',
            String(optionalNumber(value, 'limit') ?? 20),
            '--offset',
            String(optionalNumber(value, 'offset') ?? 0)
          ],
          timeoutMs,
          resourcesRoot
        )
      }
      if (operation === 'database.message_cursor_open') {
        const cursorId = 'cursor-' + randomUUID()
        dbCursors.set(cursorId, {
          context,
          sessionId: stringValue(value, 'sessionId', operation),
          batchSize: optionalNumber(value, 'limit') ?? 20,
          offset: 0
        })
        return { cursorId }
      }
      if (operation === 'database.message_cursor_fetch') {
        const cursorId = stringValue(value, 'cursorId', operation)
        const cursor = dbCursors.get(cursorId)
        if (!cursor) throw new Error('Unknown database cursor')
        const result = await runJson(
          binary,
          [
            'messages',
            ...argsWithCommon(cursor.context),
            '--session',
            cursor.sessionId,
            '--limit',
            String(cursor.batchSize),
            '--offset',
            String(cursor.offset)
          ],
          timeoutMs,
          resourcesRoot
        )
        cursor.offset += cursor.batchSize
        const items = Array.isArray(result)
          ? result
          : result &&
              typeof result === 'object' &&
              Array.isArray((result as Record<string, unknown>).messages)
            ? ((result as Record<string, unknown>).messages as unknown[])
            : []
        return { value: result, hasMore: items.length >= cursor.batchSize }
      }
      if (operation === 'database.message_cursor_close') {
        const cursorId = stringValue(value, 'cursorId', operation)
        return { closed: dbCursors.delete(cursorId) }
      }
      if (operation === 'database.query_readonly') {
        return runJson(
          binary,
          [
            'query',
            ...common,
            '--kind',
            stringValue(value, 'kind', operation),
            '--db',
            stringValue(value, 'databasePath', operation),
            '--sql',
            stringValue(value, 'sql', operation)
          ],
          timeoutMs,
          resourcesRoot
        )
      }
      if (operation === 'database.group_members') {
        return runJson(
          binary,
          ['group-members', ...common, '--chatroom', stringValue(value, 'chatroomId', operation)],
          timeoutMs,
          resourcesRoot
        )
      }
      if (operation === 'database.contacts') {
        return runJson(
          binary,
          ['display-names', ...common, '--users-json', stringValue(value, 'usersJson', operation)],
          timeoutMs,
          resourcesRoot
        )
      }
      if (operation === 'database.contact_status') {
        return runJson(
          binary,
          ['contact-status', ...common, '--users-json', stringValue(value, 'usersJson', operation)],
          timeoutMs,
          resourcesRoot
        )
      }
      if (operation === 'database.resolve_image_hardlink') {
        return runJson(
          binary,
          [
            'image-hardlink',
            ...common,
            '--md5',
            stringValue(value, 'md5', operation),
            '--account-dir',
            optionalString(value, 'accountDir') ?? context.accountRoot
          ],
          timeoutMs,
          resourcesRoot
        )
      }
      if (operation === 'database.resolve_video_hardlink') {
        const databasePath = optionalString(value, 'databasePath') ?? context.databasePath
        if (!databasePath) throw new Error(operation + ' requires databasePath')
        return runJson(
          binary,
          [
            'video-hardlink',
            ...common,
            '--md5',
            stringValue(value, 'md5', operation),
            '--database-path',
            databasePath
          ],
          timeoutMs,
          resourcesRoot
        )
      }
      throw new Error('C wxdb adapter does not implement ' + operation)
    }
  )

  registerBinary(
    service,
    'wxsync',
    resourcesRoot,
    'wxsync_probe',
    undefined,
    async (operation, input) => {
      const value = record(input, operation)
      if (operation === 'sync.open') {
        const accountRoot = stringValue(value, 'accountRoot', operation)
        const statePath = stringValue(value, 'statePath', operation)
        const sessionId = 'sync-' + randomUUID()
        syncSessions.set(sessionId, {
          accountRoot,
          statePath,
          journalPath: optionalString(value, 'journalPath'),
          watchPaths: Array.isArray(value.watchPaths)
            ? value.watchPaths.filter(
                (item): item is string => typeof item === 'string' && item.trim() !== ''
              )
            : ['db_storage', 'msg', 'cache'],
          intervalMs: optionalNumber(value, 'intervalMs'),
          maxDepth: optionalNumber(value, 'maxDepth'),
          maxFiles: optionalNumber(value, 'maxFiles')
        })
        return { sessionId }
      }
      const sessionId = stringValue(value, 'sessionId', operation)
      const context = syncSessions.get(sessionId)
      if (!context) throw new Error('Unknown sync session')
      if (operation === 'sync.close') {
        syncSessions.delete(sessionId)
        return { closed: true }
      }
      const args = ['poll', '--root', context.accountRoot, '--state', context.statePath]
      if (context.journalPath) args.push('--journal', context.journalPath)
      for (const watch of context.watchPaths) args.push('--watch', watch)
      if (context.intervalMs !== undefined) args.push('--interval-ms', String(context.intervalMs))
      if (context.maxDepth !== undefined) args.push('--max-depth', String(context.maxDepth))
      if (context.maxFiles !== undefined) args.push('--max-files', String(context.maxFiles))
      return runJson(commandPath(resourcesRoot, 'wxsync_probe'), args, timeoutMs, resourcesRoot)
    }
  )

  registerBinary(
    service,
    'wxexport',
    resourcesRoot,
    'wxexport_probe',
    undefined,
    async (operation, input) => {
      const value = record(input, operation)
      if (operation !== 'export.archive')
        throw new Error('C wxexport adapter does not implement ' + operation)
      const args = [
        '--output',
        stringValue(value, 'outputPath', operation),
        '--account-id',
        stringValue(value, 'accountId', operation),
        '--export-id',
        stringValue(value, 'exportId', operation),
        '--created-at',
        String(value.createdAt)
      ]
      const items = Array.isArray(value.items) ? value.items : []
      for (const item of items) {
        if (!item || typeof item !== 'object')
          throw new Error('export.archive items must be objects')
        const sourcePath = stringValue(item as Record<string, unknown>, 'sourcePath', operation)
        const archivePath = stringValue(item as Record<string, unknown>, 'archivePath', operation)
        args.push('--file', sourcePath, archivePath)
      }
      return runJson(commandPath(resourcesRoot, 'wxexport_probe'), args, timeoutMs, resourcesRoot)
    }
  )

  registerBinary(
    service,
    'xsend-helper',
    resourcesRoot,
    'xsend_helper',
    undefined,
    async (operation, input) => {
      const value = record(input, operation)
      if (operation === 'send.validate_key') {
        const keyFile = optionalString(value, 'keyFile')
        if (!keyFile)
          throw new Error('send.validate_key requires keyFile for native subprocess execution')
        await assertFile(keyFile, 'keyFile')
        const key = (await fs.readFile(keyFile, 'utf8')).trim()
        return { valid: /^[0-9a-fA-F]{64}$/.test(key) }
      }
      if (operation === 'send.create') {
        const keyFile = optionalString(value, 'keyFile')
        if (!keyFile)
          throw new Error('send.create requires keyFile for native subprocess execution')
        await assertFile(keyFile, 'keyFile')
        const sessionId = 'xsend-' + randomUUID()
        xsendSessions.set(sessionId, {
          accountRoot: stringValue(value, 'accountRoot', operation),
          keyFile,
          resourceDir: optionalString(value, 'resourceDir') ?? join(resourcesRoot, 'macos'),
          sessionFilter: optionalString(value, 'sessionFilter'),
          includeReceived: value.includeReceived === true,
          readLimit: optionalNumber(value, 'readLimit')
        })
        return { sessionId }
      }
      const sessionId = stringValue(value, 'sessionId', operation)
      const context = xsendSessions.get(sessionId)
      if (!context) throw new Error('Unknown xsend session')
      if (operation === 'send.close') {
        xsendSessions.delete(sessionId)
        return { closed: true }
      }
      const args = [
        '--key-file',
        context.keyFile,
        '--account-root',
        context.accountRoot,
        '--no-watch',
        '--once'
      ]
      if (context.resourceDir) args.push('--resource-dir', context.resourceDir)
      if (context.sessionFilter) args.push('--session', context.sessionFilter)
      if (context.includeReceived) args.push('--include-received')
      if (context.readLimit !== undefined) args.push('--read-limit', String(context.readLimit))
      const lines = await runJsonLines(
        commandPath(resourcesRoot, 'xsend_helper'),
        args,
        timeoutMs,
        resourcesRoot
      )
      if (operation === 'send.list_sessions')
        return (
          lines.find(
            (item) =>
              item && typeof item === 'object' && (item as Record<string, unknown>).type === 'ready'
          ) ?? null
        )
      if (operation === 'send.snapshot' || operation === 'send.poll')
        return lines.filter(
          (item) =>
            item && typeof item === 'object' && (item as Record<string, unknown>).type === 'message'
        )
      throw new Error('C xsend-helper adapter does not implement ' + operation)
    }
  )
}
