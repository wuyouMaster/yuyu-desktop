import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { runtimeRoot } from '../runtime-paths'
import { parseMessageContent } from '../message-parser'
import { deriveAccountWxid, readLocalAccountIdentity } from './local-account-identity'
import { displayContactName } from '../../shared/contact-name'
import {
  getNativeModuleManifest,
  type IdentityDisplayNameInput,
  type NativeModuleHealth,
  type NativeModuleId
} from '../../shared/native-modules'
import { NativeModuleCompatibilityService } from './native-module-compatibility-service'

function asRecord(input: unknown, operation: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(operation + ' input must be an object')
  }
  return input as Record<string, unknown>
}

function requiredString(input: Record<string, unknown>, key: string, operation: string): string {
  const value = input[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(operation + ' requires a non-empty ' + key)
  }
  return value
}

function requiredNumber(input: Record<string, unknown>, key: string, operation: string): number {
  const value = input[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(operation + ' requires a finite numeric ' + key)
  }
  return value
}

function requiredText(input: Record<string, unknown>, key: string, operation: string): string {
  const value = input[key]
  if (typeof value !== 'string') throw new Error(operation + ' requires a string ' + key)
  return value
}

function builtinHealth(): Promise<NativeModuleHealth> {
  const root = runtimeRoot('wechat')
  if (!root || !existsSync(join(root, process.platform === 'win32' ? 'wechat-storage-host.exe' : 'wechat-storage-host')))
    return Promise.resolve({
      availability: 'unavailable',
      execution: 'unavailable',
      checkedAt: new Date().toISOString(),
      message: '请先安装微信应用运行时'
    })
  return Promise.resolve({
    availability: 'available' as const,
    execution: 'ready' as const,
    checkedAt: new Date().toISOString(),
    details: { implementation: 'runtime-rpc' }
  })
}

function messageAdapter(operation: string, input: unknown): unknown {
  const value = asRecord(input, operation)
  const content = requiredText(value, 'content', operation)
  const messageType = requiredNumber(value, 'messageType', operation)
  const parsed = parseMessageContent(content, messageType)
  return operation === 'message.to_json' ? JSON.stringify(parsed) : parsed
}

function identityAdapter(operation: string, input: unknown): unknown {
  const value = asRecord(input, operation)
  if (operation === 'identity.read_account') {
    return readLocalAccountIdentity(requiredString(value, 'dataRoot', operation))
  }
  if (operation === 'identity.derive_wxid') {
    return deriveAccountWxid(requiredString(value, 'directoryName', operation)) ?? null
  }
  const displayInput = value as IdentityDisplayNameInput
  return displayContactName(displayInput, displayInput.fallback || '未命名联系人')
}

function registerBuiltin(
  service: NativeModuleCompatibilityService,
  id: NativeModuleId,
  operations: readonly string[],
  invoke: (operation: string, input: unknown) => unknown
): void {
  const manifest = getNativeModuleManifest(id)
  service.registerBuiltin(
    { ...manifest, capabilities: operations },
    {
      healthCheck: builtinHealth,
      invoke: async (operation, input) => {
        if (!operations.includes(operation)) {
          throw new Error('Builtin provider does not implement ' + operation)
        }
        return invoke(operation, input)
      }
    }
  )
}

export function registerNativeModuleBuiltinAdapters(
  service: NativeModuleCompatibilityService
): void {
  registerBuiltin(service, 'wxmessage', ['message.parse', 'message.to_json'], messageAdapter)
  registerBuiltin(
    service,
    'wxidentity',
    ['identity.read_account', 'identity.derive_wxid', 'identity.display_name'],
    identityAdapter
  )
}
