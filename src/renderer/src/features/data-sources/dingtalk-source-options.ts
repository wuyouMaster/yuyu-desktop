import type { ProviderSnapshot } from '../../../../shared/data-source'
import type { SourceAccountOption } from './source-context'

export function dingtalkSourceOption(
  snapshot: ProviderSnapshot | undefined,
  connecting = false
): SourceAccountOption {
  return {
    id: snapshot?.accountId || 'dingtalk:local',
    source: 'dingtalk',
    sourceLabel: '钉钉',
    label: '本机钉钉账号',
    accountHint: '本机读取与发送',
    status: connecting ? 'connecting' : snapshot?.health.available ? 'connected' : 'available'
  }
}
