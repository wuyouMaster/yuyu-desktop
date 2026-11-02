/**
 * Public contract for downloadable local WeChat capability modules.
 *
 * This contract deliberately does not describe a C function table. The C
 * libraries can evolve behind a stable module boundary while callers use the
 * manifest, capability and health contracts below to decide what is safe to
 * load.
 */

export const NATIVE_MODULE_PROTOCOL = 'yuyu-native-module' as const
export const NATIVE_MODULE_CONTRACT_VERSION = 1 as const

export type NativeModuleId =
  | 'wxmessage'
  | 'wxasset'
  | 'wxmedia'
  | 'wxdb'
  | 'wxidentity'
  | 'wxsync'
  | 'wxexport'
  | 'xsend-helper'
  | 'wechat-send'

export type NativeModuleKind =
  | 'message-parser'
  | 'asset-resolver'
  | 'media-decoder'
  | 'database-reader'
  | 'identity-reader'
  | 'file-sync'
  | 'archive-writer'
  | 'database-observer'
  | 'message-sender'

export type NativeModulePermission =
  | 'filesystem-read'
  | 'filesystem-write'
  | 'database-read'
  | 'process-observe'
  | 'process-inject'
  | 'network'

export type NativeModulePlatform = 'darwin' | 'win32' | 'linux'
export type NativeModuleArch = 'arm64' | 'x64' | 'ia32'
export type NativeModuleSource =
  | 'downloaded-binary'
  | 'bundled-binary'
  | 'research-tool'
  | 'builtin-fallback'
export type NativeModuleAvailability = 'available' | 'unavailable' | 'incompatible'
export type NativeModuleExecution = 'ready' | 'inspected' | 'unavailable'
export type NativeModuleCapabilityExecution = NativeModuleExecution

export interface NativeModuleTarget {
  platform: NativeModulePlatform
  arch: NativeModuleArch
}

export interface NativeModuleEntrypoint {
  /** Path relative to the module package root. */
  path: string
  kind: 'library' | 'cli'
  /** Proposed logical ABI name; the future loader must verify it before loading. */
  abi: string
}

export interface NativeModuleManifest {
  protocol: typeof NATIVE_MODULE_PROTOCOL
  contractVersion: typeof NATIVE_MODULE_CONTRACT_VERSION
  id: NativeModuleId
  version: string
  kind: NativeModuleKind
  displayName: string
  description: string
  capabilities: readonly string[]
  permissions: readonly NativeModulePermission[]
  dependencies: readonly NativeModuleId[]
  targets: readonly NativeModuleTarget[]
  entrypoints: readonly NativeModuleEntrypoint[]
  fallback: 'available' | 'planned' | 'none'
}

export interface NativeModuleHealth {
  availability: NativeModuleAvailability
  execution: NativeModuleExecution
  checkedAt: string
  message?: string
  details?: Record<string, string | number | boolean>
  capabilityExecution?: Record<string, NativeModuleCapabilityExecution>
}

export interface NativeModuleRegistration {
  manifest: NativeModuleManifest
  source: NativeModuleSource
  packageRoot?: string
  health?: NativeModuleHealth
}

export interface NativeModuleResolution {
  id: NativeModuleId
  availability: NativeModuleAvailability
  execution: NativeModuleExecution
  source?: NativeModuleSource
  manifest?: NativeModuleManifest
  packageRoot?: string
  reason?: string
  capabilityExecution?: Record<string, NativeModuleCapabilityExecution>
}

export interface NativeModuleStatus extends NativeModuleResolution {
  capabilities: readonly string[]
  dependencies: readonly NativeModuleId[]
}

export const NATIVE_MODULE_CATALOG: readonly NativeModuleManifest[] = [
  {
    protocol: NATIVE_MODULE_PROTOCOL,
    contractVersion: NATIVE_MODULE_CONTRACT_VERSION,
    id: 'wxmessage',
    version: '0.1.0',
    kind: 'message-parser',
    displayName: '微信消息语义解析',
    description: '将微信消息 content 解析为稳定的结构化语义结果。',
    capabilities: ['message.parse', 'message.to_json', 'message.kind_name'],
    permissions: [],
    dependencies: [],
    targets: [
      { platform: 'darwin', arch: 'arm64' },
      { platform: 'darwin', arch: 'x64' },
      { platform: 'win32', arch: 'x64' },
      { platform: 'linux', arch: 'x64' }
    ],
    entrypoints: [
      { path: 'lib/libwxmessage', kind: 'library', abi: 'wxmessage/1' },
      { path: 'bin/wxmsg_probe', kind: 'cli', abi: 'wxmessage-cli/1' }
    ],
    fallback: 'available'
  },
  {
    protocol: NATIVE_MODULE_PROTOCOL,
    contractVersion: NATIVE_MODULE_CONTRACT_VERSION,
    id: 'wxasset',
    version: '0.1.0',
    kind: 'asset-resolver',
    displayName: '微信本地资产定位',
    description: '根据消息标识定位图片、视频、缩略图和 hardlink 资产。',
    capabilities: ['asset.resolve_image', 'asset.resolve_video', 'asset.session_md5'],
    permissions: ['filesystem-read', 'database-read'],
    dependencies: [],
    targets: [
      { platform: 'darwin', arch: 'arm64' },
      { platform: 'darwin', arch: 'x64' },
      { platform: 'win32', arch: 'x64' },
      { platform: 'linux', arch: 'x64' }
    ],
    entrypoints: [
      { path: 'lib/libwxasset', kind: 'library', abi: 'wxasset/1' },
      { path: 'bin/wxasset_probe', kind: 'cli', abi: 'wxasset-cli/1' }
    ],
    fallback: 'planned'
  },
  {
    protocol: NATIVE_MODULE_PROTOCOL,
    contractVersion: NATIVE_MODULE_CONTRACT_VERSION,
    id: 'wxmedia',
    version: '0.1.0',
    kind: 'media-decoder',
    displayName: '微信本地媒体解码',
    description: '处理 DAT、WXGF 和本地媒体密钥，输出可消费的媒体数据。',
    capabilities: [
      'media.process_file',
      'media.process_data',
      'media.derive_local_keys',
      'media.transcode'
    ],
    permissions: ['filesystem-read', 'filesystem-write'],
    dependencies: [],
    targets: [
      { platform: 'darwin', arch: 'arm64' },
      { platform: 'darwin', arch: 'x64' },
      { platform: 'win32', arch: 'x64' },
      { platform: 'linux', arch: 'x64' }
    ],
    entrypoints: [
      { path: 'lib/libwxmedia', kind: 'library', abi: 'wxmedia/1' },
      { path: 'bin/wxmedia_probe', kind: 'cli', abi: 'wxmedia-cli/1' }
    ],
    fallback: 'planned'
  },
  {
    protocol: NATIVE_MODULE_PROTOCOL,
    contractVersion: NATIVE_MODULE_CONTRACT_VERSION,
    id: 'wxdb',
    version: '0.1.0',
    kind: 'database-reader',
    displayName: '微信只读数据库访问',
    description: '通过统一只读接口查询 WCDB 会话、消息、联系人和 hardlink。',
    capabilities: [
      'database.sessions',
      'database.messages',
      'database.contacts',
      'database.contact_status',
      'database.group_members',
      'database.query_readonly',
      'database.resolve_image_hardlink',
      'database.resolve_video_hardlink',
      'database.open',
      'database.close',
      'database.profile',
      'database.message_cursor_open',
      'database.message_cursor_fetch',
      'database.message_cursor_close'
    ],
    permissions: ['filesystem-read', 'database-read'],
    dependencies: [],
    targets: [
      { platform: 'darwin', arch: 'arm64' },
      { platform: 'darwin', arch: 'x64' },
      { platform: 'win32', arch: 'x64' }
    ],
    entrypoints: [
      { path: 'lib/libwxdb', kind: 'library', abi: 'wxdb/1' },
      { path: 'bin/wxdb_probe', kind: 'cli', abi: 'wxdb-cli/1' }
    ],
    fallback: 'planned'
  },
  {
    protocol: NATIVE_MODULE_PROTOCOL,
    contractVersion: NATIVE_MODULE_CONTRACT_VERSION,
    id: 'wxidentity',
    version: '0.1.0',
    kind: 'identity-reader',
    displayName: '微信本地身份规则',
    description: '读取本地账号身份并统一 wxid、展示名和头像 URL 规则。',
    capabilities: [
      'identity.read_account',
      'identity.derive_wxid',
      'identity.account_directory_matches',
      'identity.display_name',
      'identity.group_member_display_name',
      'identity.normalize_avatar_url'
    ],
    permissions: ['filesystem-read'],
    dependencies: [],
    targets: [
      { platform: 'darwin', arch: 'arm64' },
      { platform: 'darwin', arch: 'x64' },
      { platform: 'win32', arch: 'x64' },
      { platform: 'linux', arch: 'x64' }
    ],
    entrypoints: [
      { path: 'lib/libwxidentity', kind: 'library', abi: 'wxidentity/1' },
      { path: 'bin/wxidentity_probe', kind: 'cli', abi: 'wxidentity-cli/1' }
    ],
    fallback: 'available'
  },
  {
    protocol: NATIVE_MODULE_PROTOCOL,
    contractVersion: NATIVE_MODULE_CONTRACT_VERSION,
    id: 'wxsync',
    version: '0.1.0',
    kind: 'file-sync',
    displayName: '微信目录增量同步',
    description: '对账号目录做快照比较，输出 created、modified 和 deleted 事件。',
    capabilities: ['sync.open', 'sync.poll', 'sync.close'],
    permissions: ['filesystem-read', 'filesystem-write'],
    dependencies: [],
    targets: [
      { platform: 'darwin', arch: 'arm64' },
      { platform: 'darwin', arch: 'x64' },
      { platform: 'win32', arch: 'x64' },
      { platform: 'linux', arch: 'x64' }
    ],
    entrypoints: [
      { path: 'lib/libwxsync', kind: 'library', abi: 'wxsync/1' },
      { path: 'bin/wxsync_probe', kind: 'cli', abi: 'wxsync-cli/1' }
    ],
    fallback: 'planned'
  },
  {
    protocol: NATIVE_MODULE_PROTOCOL,
    contractVersion: NATIVE_MODULE_CONTRACT_VERSION,
    id: 'wxexport',
    version: '0.1.0',
    kind: 'archive-writer',
    displayName: '微信可校验归档',
    description: '生成带 manifest 和 SHA-256 校验的本地 USTAR 归档。',
    capabilities: ['export.archive'],
    permissions: ['filesystem-read', 'filesystem-write'],
    dependencies: [],
    targets: [
      { platform: 'darwin', arch: 'arm64' },
      { platform: 'darwin', arch: 'x64' },
      { platform: 'win32', arch: 'x64' },
      { platform: 'linux', arch: 'x64' }
    ],
    entrypoints: [
      { path: 'lib/libwxexport', kind: 'library', abi: 'wxexport/1' },
      { path: 'bin/wxexport_probe', kind: 'cli', abi: 'wxexport-cli/1' }
    ],
    fallback: 'planned'
  },
  {
    protocol: NATIVE_MODULE_PROTOCOL,
    contractVersion: NATIVE_MODULE_CONTRACT_VERSION,
    id: 'xsend-helper',
    version: '0.1.0',
    kind: 'database-observer',
    displayName: '微信发送落库观察器',
    description: '只读观察主动发送消息是否写入本地 WCDB。',
    capabilities: [
      'send.validate_key',
      'send.create',
      'send.close',
      'send.list_sessions',
      'send.snapshot',
      'send.poll'
    ],
    permissions: ['filesystem-read', 'database-read'],
    dependencies: ['wxdb'],
    targets: [
      { platform: 'darwin', arch: 'arm64' },
      { platform: 'darwin', arch: 'x64' },
      { platform: 'win32', arch: 'x64' }
    ],
    entrypoints: [
      { path: 'lib/libxsend_helper', kind: 'library', abi: 'xsend-helper/1' },
      { path: 'bin/xsend_helper', kind: 'cli', abi: 'xsend-helper-cli/1' }
    ],
    fallback: 'planned'
  },
  {
    protocol: NATIVE_MODULE_PROTOCOL,
    contractVersion: NATIVE_MODULE_CONTRACT_VERSION,
    id: 'wechat-send',
    version: '0.1.0',
    kind: 'message-sender',
    displayName: '微信原生文字发送',
    description:
      '通过已验证的 xsend resident 为当前 macOS arm64 微信进程发送文字；图片和语音仍使用 OneBot。',
    capabilities: ['send.status', 'send.install', 'send.text', 'send.stop'],
    permissions: ['process-observe', 'process-inject'],
    dependencies: [],
    targets: [{ platform: 'darwin', arch: 'arm64' }],
    entrypoints: [{ path: 'xsend-v3/xsend-v3-resident', kind: 'cli', abi: 'xsend-v3-resident/1' }],
    fallback: 'none'
  }
]

export interface NativeModuleCallRequest {
  id: NativeModuleId
  operation: string
  input?: unknown
}

export interface NativeModuleCallResult<T = unknown> {
  id: NativeModuleId
  operation: string
  source: NativeModuleSource
  value: T
}

export interface MessageParseInput {
  content: string
  messageType: number
}

export interface IdentityReadAccountInput {
  dataRoot: string
}

export interface IdentityDeriveWxidInput {
  directoryName: string
}

export interface IdentityDisplayNameInput {
  m_nsNickName?: string
  remark?: string
  alias?: string
  wechatNickname?: string
  wechatId?: string
  wxid?: string
  m_nsUsrName?: string
  fallback?: string
}

export interface AssetResolveImageInput {
  accountRoot: string
  sessionId?: string
  sessionMd5?: string
  createTime?: number
  md5?: string
  datName?: string
  allowThumbnail?: boolean
  preferThumbnail?: boolean
}

export interface AssetResolveVideoInput {
  accountRoot: string
  createTime?: number
  md5?: string
  byteLength?: number
  duration?: number
  width?: number
  height?: number
}

export interface MediaProcessFileInput {
  path: string
  aesKey?: string
  xorKey?: number
  expectedMd5?: string
  outputPath?: string
}

export interface MediaProcessDataInput {
  dataBase64: string
  aesKey?: string
  xorKey?: number
  expectedMd5?: string
  outputPath?: string
}

export interface DatabaseOpenInput {
  libraryPath?: string
  accountRoot: string
  databasePath?: string
  key?: string
  keyFile?: string
  wxid?: string
  profile?: string
}

export interface SyncOpenInput {
  accountRoot: string
  statePath: string
  journalPath?: string
  watchPaths?: string[]
  intervalMs?: number
  maxDepth?: number
  maxFiles?: number
}

export interface ExportArchiveInput {
  outputPath: string
  accountId: string
  exportId: string
  createdAt: number
  items: Array<{ sourcePath: string; archivePath: string }>
}

export interface XsendCreateInput {
  key?: string
  keyFile?: string
  accountRoot: string
  resourceDir?: string
  sessionFilter?: string
  includeReceived?: boolean
  readLimit?: number
}

export interface WechatSendTextInput {
  target: string
  content: string
}

export type NativeModuleOperationInput =
  | MessageParseInput
  | IdentityReadAccountInput
  | IdentityDeriveWxidInput
  | IdentityDisplayNameInput
  | AssetResolveImageInput
  | AssetResolveVideoInput
  | MediaProcessFileInput
  | MediaProcessDataInput
  | DatabaseOpenInput
  | SyncOpenInput
  | ExportArchiveInput
  | XsendCreateInput
  | WechatSendTextInput

function isInputRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function validateRequiredStringInput(
  input: unknown,
  operation: string,
  key: string
): string | undefined {
  if (!isInputRecord(input)) return operation + ' input must be an object'
  const value = input[key]
  if (typeof value !== 'string' || value.trim() === '') {
    return operation + ' requires a non-empty ' + key
  }
  return undefined
}

function validateOptionalStringFields(
  input: Record<string, unknown>,
  operation: string,
  keys: readonly string[]
): string[] {
  return keys
    .filter((key) => input[key] !== undefined && typeof input[key] !== 'string')
    .map((key) => operation + ' field ' + key + ' must be a string')
}

function validateOptionalNumberFields(
  input: Record<string, unknown>,
  operation: string,
  keys: readonly string[]
): string[] {
  return keys
    .filter((key) => input[key] !== undefined)
    .filter((key) => typeof input[key] !== 'number' || !Number.isFinite(input[key]))
    .map((key) => operation + ' field ' + key + ' must be a finite number')
}

function validateOptionalBooleanFields(
  input: Record<string, unknown>,
  operation: string,
  keys: readonly string[]
): string[] {
  return keys
    .filter((key) => input[key] !== undefined && typeof input[key] !== 'boolean')
    .map((key) => operation + ' field ' + key + ' must be a boolean')
}

function validateRecordInput(
  input: unknown,
  operation: string
): Record<string, unknown> | string[] {
  return isInputRecord(input) ? input : [operation + ' input must be an object']
}

function validateRequiredStrings(
  input: unknown,
  operation: string,
  keys: readonly string[]
): string[] {
  const record = validateRecordInput(input, operation)
  if (Array.isArray(record)) return record
  return keys.flatMap((key) => {
    const error = validateRequiredStringInput(record, operation, key)
    return error ? [error] : []
  })
}

/** Validate the JSON boundary before a builtin or future native adapter runs. */
export function validateNativeModuleOperationInput(
  id: NativeModuleId,
  operation: string,
  input: unknown
): string[] {
  if (id === 'wxmessage' && (operation === 'message.parse' || operation === 'message.to_json')) {
    const result = validateRecordInput(input, operation)
    if (Array.isArray(result)) return result
    const errors = validateRequiredStrings(result, operation, ['content'])
    if (typeof result.messageType !== 'number' || !Number.isFinite(result.messageType)) {
      errors.push(operation + ' requires a finite numeric messageType')
    }
    return errors
  }
  if (id === 'wxmessage' && operation === 'message.kind_name') {
    const result = validateRecordInput(input, operation)
    if (Array.isArray(result)) return result
    return typeof result.kind === 'number' && Number.isFinite(result.kind)
      ? []
      : [operation + ' requires a finite numeric kind']
  }
  if (id === 'wxidentity' && operation === 'identity.read_account') {
    return validateRequiredStrings(input, operation, ['dataRoot'])
  }
  if (id === 'wxidentity' && operation === 'identity.derive_wxid') {
    return validateRequiredStrings(input, operation, ['directoryName'])
  }
  if (
    id === 'wxidentity' &&
    (operation === 'identity.display_name' ||
      operation === 'identity.group_member_display_name' ||
      operation === 'identity.account_directory_matches')
  ) {
    const result = validateRecordInput(input, operation)
    if (Array.isArray(result)) return result
    if (operation === 'identity.account_directory_matches') {
      return validateRequiredStrings(result, operation, ['directoryName', 'wxid'])
    }
    const errors = validateOptionalStringFields(result, operation, [
      'm_nsNickName',
      'remark',
      'alias',
      'wechatNickname',
      'wechatId',
      'wxid',
      'm_nsUsrName',
      'fallback',
      'username',
      'groupNickname'
    ])
    const identityKey =
      operation === 'identity.group_member_display_name'
        ? ['username', 'wxid']
        : ['m_nsUsrName', 'wxid', 'wechatId']
    if (!identityKey.some((key) => typeof result[key] === 'string' && result[key].trim() !== '')) {
      errors.push(operation + ' requires a non-empty username, wxid, or wechatId')
    }
    return errors
  }
  if (id === 'wxidentity' && operation === 'identity.normalize_avatar_url') {
    return validateRequiredStrings(input, operation, ['url'])
  }
  if (id === 'wxasset' && operation === 'asset.resolve_image') {
    const result = validateRecordInput(input, operation)
    if (Array.isArray(result)) return result
    return [
      ...validateRequiredStrings(result, operation, ['accountRoot']),
      ...validateOptionalStringFields(result, operation, [
        'sessionId',
        'sessionMd5',
        'md5',
        'datName'
      ]),
      ...validateOptionalNumberFields(result, operation, ['createTime']),
      ...validateOptionalBooleanFields(result, operation, ['allowThumbnail', 'preferThumbnail'])
    ]
  }
  if (id === 'wxasset' && operation === 'asset.resolve_video') {
    const result = validateRecordInput(input, operation)
    if (Array.isArray(result)) return result
    return [
      ...validateRequiredStrings(result, operation, ['accountRoot']),
      ...validateOptionalStringFields(result, operation, ['md5']),
      ...validateOptionalNumberFields(result, operation, [
        'createTime',
        'byteLength',
        'duration',
        'width',
        'height'
      ])
    ]
  }
  if (id === 'wxasset' && operation === 'asset.session_md5') {
    return validateRequiredStrings(input, operation, ['sessionId'])
  }
  if (id === 'wxmedia' && operation === 'media.process_file') {
    const result = validateRecordInput(input, operation)
    if (Array.isArray(result)) return result
    return [
      ...validateRequiredStrings(result, operation, ['path']),
      ...validateOptionalStringFields(result, operation, ['aesKey', 'expectedMd5', 'outputPath']),
      ...validateOptionalNumberFields(result, operation, ['xorKey'])
    ]
  }
  if (id === 'wxmedia' && operation === 'media.process_data') {
    const result = validateRecordInput(input, operation)
    if (Array.isArray(result)) return result
    return [
      ...validateRequiredStrings(result, operation, ['dataBase64']),
      ...validateOptionalStringFields(result, operation, ['aesKey', 'expectedMd5', 'outputPath']),
      ...validateOptionalNumberFields(result, operation, ['xorKey'])
    ]
  }
  if (id === 'wxmedia' && operation === 'media.derive_local_keys') {
    return validateRequiredStrings(input, operation, ['accountRoot'])
  }
  if (id === 'wxmedia' && operation === 'media.transcode') {
    const result = validateRecordInput(input, operation)
    if (Array.isArray(result)) return result
    return [
      ...validateRequiredStrings(result, operation, ['inputPath', 'outputPath']),
      ...validateOptionalStringFields(result, operation, ['libwxtransPath', 'multimediadynPath']),
      ...validateOptionalNumberFields(result, operation, [
        'width',
        'height',
        'fpsOut',
        'videoBitrateKbps',
        'audioChannels',
        'audioBitrateKbps'
      ])
    ]
  }
  if (id === 'wxdb' && operation === 'database.open') {
    const result = validateRecordInput(input, operation)
    if (Array.isArray(result)) return result
    const errors = validateRequiredStrings(result, operation, ['accountRoot'])
    if (typeof result.key !== 'string' && typeof result.keyFile !== 'string') {
      errors.push(operation + ' requires a non-empty key or keyFile')
    }
    if (result.key !== undefined && (typeof result.key !== 'string' || result.key.trim() === '')) {
      errors.push(operation + ' field key must be a non-empty string')
    }
    if (
      result.keyFile !== undefined &&
      (typeof result.keyFile !== 'string' || result.keyFile.trim() === '')
    ) {
      errors.push(operation + ' field keyFile must be a non-empty string')
    }
    return [
      ...errors,
      ...validateOptionalStringFields(result, operation, [
        'databasePath',
        'libraryPath',
        'wxid',
        'profile'
      ])
    ]
  }
  if (id === 'wxdb' && operation !== 'database.open') {
    const result = validateRecordInput(input, operation)
    if (Array.isArray(result)) return result
    const errors = validateRequiredStrings(result, operation, ['databaseSessionId'])
    if (operation === 'database.query_readonly') {
      errors.push(...validateRequiredStrings(result, operation, ['kind', 'sql']))
      if (result.databasePath !== undefined && typeof result.databasePath !== 'string') {
        errors.push(operation + ' field databasePath must be a string')
      }
    }
    if (
      operation === 'database.message_cursor_fetch' ||
      operation === 'database.message_cursor_close'
    ) {
      errors.push(...validateRequiredStrings(result, operation, ['cursorId']))
    }
    if (operation === 'database.messages' || operation === 'database.message_cursor_open') {
      errors.push(...validateRequiredStrings(result, operation, ['sessionId']))
      errors.push(...validateOptionalNumberFields(result, operation, ['limit', 'offset']))
    }
    if (operation === 'database.contacts') {
      errors.push(...validateRequiredStrings(result, operation, ['usersJson']))
    }
    if (operation === 'database.group_members') {
      errors.push(...validateRequiredStrings(result, operation, ['chatroomId']))
    }
    if (
      operation === 'database.resolve_image_hardlink' ||
      operation === 'database.resolve_video_hardlink'
    ) {
      errors.push(...validateRequiredStrings(result, operation, ['md5']))
    }
    return errors
  }
  if (id === 'wxsync' && operation === 'sync.open') {
    return validateRequiredStrings(input, operation, ['accountRoot', 'statePath'])
  }
  if (id === 'wxsync' && (operation === 'sync.poll' || operation === 'sync.close')) {
    return validateRequiredStrings(input, operation, ['sessionId'])
  }
  if (id === 'wxexport' && operation === 'export.archive') {
    const result = validateRecordInput(input, operation)
    if (Array.isArray(result)) return result
    const errors = validateRequiredStrings(result, operation, [
      'outputPath',
      'accountId',
      'exportId'
    ])
    if (typeof result.createdAt !== 'number' || !Number.isFinite(result.createdAt)) {
      errors.push(operation + ' requires a finite numeric createdAt')
    }
    if (!Array.isArray(result.items)) errors.push(operation + ' requires an items array')
    return errors
  }
  if (id === 'xsend-helper' && operation === 'send.validate_key') {
    const result = validateRecordInput(input, operation)
    if (Array.isArray(result)) return result
    const errors: string[] = []
    if (typeof result.key !== 'string' && typeof result.keyFile !== 'string') {
      errors.push(operation + ' requires a non-empty key or keyFile')
    }
    if (result.key !== undefined && (typeof result.key !== 'string' || result.key.trim() === '')) {
      errors.push(operation + ' field key must be a non-empty string')
    }
    if (
      result.keyFile !== undefined &&
      (typeof result.keyFile !== 'string' || result.keyFile.trim() === '')
    ) {
      errors.push(operation + ' field keyFile must be a non-empty string')
    }
    return errors
  }
  if (
    id === 'wechat-send' &&
    (operation === 'send.status' || operation === 'send.install' || operation === 'send.stop')
  ) {
    return isInputRecord(input) || input === undefined
      ? []
      : [operation + ' input must be an object']
  }
  if (id === 'wechat-send' && operation === 'send.text') {
    const result = validateRecordInput(input, operation)
    if (Array.isArray(result)) return result
    const errors = validateRequiredStrings(result, operation, ['target', 'content'])
    for (const key of ['target', 'content']) {
      const value = result[key]
      if (typeof value === 'string' && /[\r\n]/.test(value)) {
        errors.push(operation + ' field ' + key + ' must not contain newlines')
      }
    }
    if (
      typeof result.target === 'string' &&
      Buffer.byteLength(result.target.trim(), 'utf8') > 255
    ) {
      errors.push(operation + ' target must be at most 255 UTF-8 bytes')
    }
    if (
      typeof result.content === 'string' &&
      Buffer.byteLength(result.content.trim(), 'utf8') > 4095
    ) {
      errors.push(operation + ' content must be at most 4095 UTF-8 bytes')
    }
    return errors
  }
  if (id === 'xsend-helper' && operation === 'send.create') {
    const result = validateRecordInput(input, operation)
    if (Array.isArray(result)) return result
    const errors = validateRequiredStrings(result, operation, ['accountRoot'])
    if (typeof result.key !== 'string' && typeof result.keyFile !== 'string') {
      errors.push(operation + ' requires a non-empty key or keyFile')
    }
    return [
      ...errors,
      ...validateOptionalStringFields(result, operation, [
        'key',
        'keyFile',
        'resourceDir',
        'sessionFilter'
      ]),
      ...validateOptionalNumberFields(result, operation, ['readLimit']),
      ...validateOptionalBooleanFields(result, operation, ['includeReceived'])
    ]
  }
  if (
    id === 'xsend-helper' &&
    (operation === 'send.close' ||
      operation === 'send.list_sessions' ||
      operation === 'send.snapshot' ||
      operation === 'send.poll')
  ) {
    return validateRequiredStrings(input, operation, ['sessionId'])
  }
  return []
}

export function isNativeModuleCallRequest(value: unknown): value is NativeModuleCallRequest {
  if (!isInputRecord(value)) return false
  const request = value as Record<string, unknown>
  return (
    typeof request.id === 'string' &&
    isNativeModuleId(request.id) &&
    typeof request.operation === 'string' &&
    request.operation.trim().length > 0
  )
}

const MODULE_IDS = new Set<NativeModuleId>(NATIVE_MODULE_CATALOG.map((module) => module.id))
const PLATFORMS = new Set<NativeModulePlatform>(['darwin', 'win32', 'linux'])
const ARCHES = new Set<NativeModuleArch>(['arm64', 'x64', 'ia32'])
const KINDS = new Set(NATIVE_MODULE_CATALOG.map((module) => module.kind))
const PERMISSIONS = new Set<NativeModulePermission>([
  'filesystem-read',
  'filesystem-write',
  'database-read',
  'process-observe',
  'process-inject',
  'network'
])

/** Package paths use portable forward-slash segments, never host absolute paths. */
export function isNativeModuleRelativePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !value.includes(String.fromCharCode(0)) &&
    !value.includes('\\') &&
    !value.includes(':') &&
    value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  )
}

export function isNativeModuleId(value: string): value is NativeModuleId {
  return MODULE_IDS.has(value as NativeModuleId)
}

export function getNativeModuleManifest(id: NativeModuleId): NativeModuleManifest {
  const manifest = NATIVE_MODULE_CATALOG.find((item) => item.id === id)
  if (!manifest) throw new Error('Unknown native module: ' + id)
  return manifest
}

export function validateNativeModuleManifest(manifest: unknown): string[] {
  const errors: string[] = []
  if (!isInputRecord(manifest)) return ['manifest must be an object']

  const value = manifest as Record<string, unknown>
  if (value.protocol !== NATIVE_MODULE_PROTOCOL) errors.push('unsupported protocol')
  if (value.contractVersion !== NATIVE_MODULE_CONTRACT_VERSION)
    errors.push('unsupported contractVersion')
  if (typeof value.id !== 'string' || !isNativeModuleId(value.id)) errors.push('unknown module id')
  if (
    typeof value.version !== 'string' ||
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u.test(
      value.version
    )
  )
    errors.push('version must be a semantic version')
  if (!KINDS.has(value.kind as NativeModuleKind)) errors.push('unknown module kind')
  if (typeof value.displayName !== 'string' || value.displayName.trim() === '')
    errors.push('displayName is required')
  if (typeof value.description !== 'string' || value.description.trim() === '')
    errors.push('description is required')
  if (
    !Array.isArray(value.capabilities) ||
    value.capabilities.length === 0 ||
    value.capabilities.some((item) => typeof item !== 'string' || !item.trim())
  ) {
    errors.push('capabilities must be an array of strings')
  }
  if (
    !Array.isArray(value.permissions) ||
    value.permissions.some((item) => !PERMISSIONS.has(item))
  ) {
    errors.push('permissions must be an array of strings')
  }
  if (
    !Array.isArray(value.dependencies) ||
    value.dependencies.some((item) => !isNativeModuleId(item) || item === value.id)
  ) {
    errors.push('dependencies must be an array of module ids')
  }
  if (
    !Array.isArray(value.targets) ||
    value.targets.length === 0 ||
    value.targets.some((item) => {
      if (!item || typeof item !== 'object') return true
      const target = item as Record<string, unknown>
      return (
        typeof target.platform !== 'string' ||
        !PLATFORMS.has(target.platform as NativeModulePlatform) ||
        typeof target.arch !== 'string' ||
        !ARCHES.has(target.arch as NativeModuleArch)
      )
    })
  ) {
    errors.push('targets must contain supported platform and arch pairs')
  }
  if (
    !Array.isArray(value.entrypoints) ||
    value.entrypoints.some((item) => {
      if (!item || typeof item !== 'object') return true
      const entrypoint = item as Record<string, unknown>
      return (
        !isNativeModuleRelativePath(entrypoint.path) ||
        (entrypoint.kind !== 'library' && entrypoint.kind !== 'cli') ||
        typeof entrypoint.abi !== 'string' ||
        entrypoint.abi.trim() === ''
      )
    })
  ) {
    errors.push('entrypoints contain an invalid relative path or ABI')
  }
  if (value.fallback !== 'available' && value.fallback !== 'planned' && value.fallback !== 'none') {
    errors.push('fallback must be available, planned or none')
  }
  if (typeof value.id === 'string' && isNativeModuleId(value.id)) {
    const catalog = getNativeModuleManifest(value.id)
    if (value.kind !== catalog.kind) errors.push('kind does not match the module catalog')
    if (
      Array.isArray(value.capabilities) &&
      value.capabilities.some((item) => !catalog.capabilities.includes(item))
    ) {
      errors.push('capability is not declared in the module catalog')
    }
  }
  return errors
}

export function isNativeModuleTargetSupported(
  manifest: NativeModuleManifest,
  target: NativeModuleTarget
): boolean {
  return manifest.targets.some(
    (item) => item.platform === target.platform && item.arch === target.arch
  )
}
