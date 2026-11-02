import type { ProviderSnapshot } from '../../../../shared/data-source'
import type { SourceAccountOption } from './source-context'

export const telegramLocalSourceOption: SourceAccountOption = {
  id: 'telegram:local',
  source: 'telegram',
  sourceLabel: 'Telegram',
  label: '检测本机账号',
  discovery: true,
  accountHint: '检测本机账号 · 连接后可补载历史、按需读取缓存；文字发送以能力状态为准',
  status: 'needs_setup'
}

export function telegramSourceOption(
  snapshot: ProviderSnapshot | undefined,
  accountLabel = '',
  connecting = false,
  local = false
): SourceAccountOption {
  return {
    id: snapshot?.accountId || 'telegram:export',
    source: 'telegram',
    sourceLabel: 'Telegram',
    label: accountLabel || (local ? 'Telegram 本地账号' : 'Telegram 导出账号'),
    accountHint:
      snapshot?.health.message ||
      (local
        ? '本地快照 · 可补载历史、按需读取缓存；文字发送以能力状态为准'
        : '已保存的 Telegram JSON 导出 · 文字发送'),
    status: connecting ? 'connecting' : snapshot?.health.available ? 'connected' : 'available'
  }
}
