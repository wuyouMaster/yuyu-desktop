import type { PersonalWechatXsendStatus } from '../../shared/personal-wechat'
import {
  getNativeModuleManifest,
  type NativeModuleCapabilityExecution,
  type NativeModuleHealth
} from '../../shared/native-modules'
import { NativeModuleCompatibilityService } from './native-module-compatibility-service'

export interface NativeWechatSendCapability {
  getStatus(): Promise<PersonalWechatXsendStatus>
  install(): Promise<PersonalWechatXsendStatus>
  sendText(
    target: string,
    content: string
  ): Promise<{
    success: boolean
    status: PersonalWechatXsendStatus
    error?: string
  }>
  stop(): Promise<PersonalWechatXsendStatus>
}

type SafeXsendStatus = Omit<PersonalWechatXsendStatus, 'residentBinaryPath'> & {
  residentBinaryPath?: never
}

function redactStatus(status: PersonalWechatXsendStatus): SafeXsendStatus {
  const { residentBinaryPath: _residentBinaryPath, ...safeStatus } = status
  void _residentBinaryPath
  return safeStatus
}

function capabilityExecution(
  status: PersonalWechatXsendStatus
): Record<string, NativeModuleCapabilityExecution> {
  const supported = status.supported
  return {
    'send.status': supported ? 'ready' : 'unavailable',
    'send.install': supported ? 'ready' : 'unavailable',
    'send.text': supported && status.ready ? 'ready' : 'unavailable',
    'send.stop': supported && status.ready ? 'ready' : 'unavailable'
  }
}

function health(status: PersonalWechatXsendStatus): NativeModuleHealth {
  return {
    availability: status.supported ? 'available' : 'incompatible',
    execution: status.supported ? 'ready' : 'unavailable',
    checkedAt: new Date().toISOString(),
    message: status.message,
    details: { implementation: 'xsend-v3-resident' },
    capabilityExecution: capabilityExecution(status)
  }
}

/**
 * Registers the bundled resident sender behind the same manifest and call
 * contract used by downloaded native modules. The provider owns all C ABI,
 * runtime-image, resident hash and process-injection details.
 */
export function registerNativeModuleWechatSendAdapter(
  service: NativeModuleCompatibilityService,
  xsend: NativeWechatSendCapability
): void {
  service.register({
    registration: {
      manifest: getNativeModuleManifest('wechat-send'),
      source: 'bundled-binary'
    },
    healthCheck: async (operation) => {
      // Status is itself the live probe; selecting its provider must not run it twice.
      // The registry already checks platform/architecture. Write operations retain live gates.
      if (operation === 'send.status')
        return {
          availability: 'available',
          execution: 'ready',
          checkedAt: new Date().toISOString(),
          capabilityExecution: { 'send.status': 'ready' }
        }
      return health(await xsend.getStatus())
    },
    invoke: async (operation, input) => {
      if (operation === 'send.status') return redactStatus(await xsend.getStatus())
      if (operation === 'send.install') return redactStatus(await xsend.install())
      if (operation === 'send.stop') return redactStatus(await xsend.stop())
      if (operation === 'send.text') {
        const value = input as { target: string; content: string }
        const result = await xsend.sendText(value.target, value.content)
        return {
          ...result,
          status: redactStatus(result.status)
        }
      }
      throw new Error('Unsupported wechat-send operation: ' + operation)
    }
  })
}
