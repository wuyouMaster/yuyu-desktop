import type { ProviderSnapshot } from '../../../../shared/data-source'
import type { SourceAccountOption } from './source-context'

export type TelegramLocalConnection =
  | { clientType: 'telegram-desktop'; slot: number; id: string }
  | { clientType: 'telegram-macos'; candidateId: string }

export const telegramLocalSourceOption: SourceAccountOption = {
  id: 'telegram:local',
  source: 'telegram',
  sourceLabel: 'Telegram',
  label: '检测本机账号',
  discovery: true,
  accountHint: '选择 Telegram macOS 原生版或 Desktop · 按客户端显示读取能力',
  status: 'needs_setup'
}

export function telegramSourceOption(
  snapshot: ProviderSnapshot | undefined,
  accountLabel = '',
  connecting = false,
  local = false,
  clientType?: TelegramLocalConnection['clientType']
): SourceAccountOption {
  return {
    id: snapshot?.accountId || 'telegram:export',
    source: 'telegram',
    sourceLabel: 'Telegram',
    label: accountLabel || (local ? 'Telegram 本地账号' : 'Telegram 导出账号'),
    accountHint:
      snapshot?.health.message ||
      (clientType === 'telegram-macos'
        ? 'Telegram macOS 原生版 · 本地只读快照，不代表完整云端历史'
        : local
          ? '本地快照 · 可补载历史、按需读取缓存；文字发送以能力状态为准'
          : '已保存的 Telegram JSON 导出 · 文字发送'),
    status: connecting ? 'connecting' : snapshot?.health.available ? 'connected' : 'available'
  }
}
