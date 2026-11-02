import type { WechatAccountCandidate } from '../../../../shared/database-key'
import type { SourceAccountOption } from './source-context'

export function wechatSourceOption(
  account: WechatAccountCandidate,
  currentRoot: string,
  connected: boolean,
  connecting = false
): SourceAccountOption {
  const current = account.accountRoot === currentRoot
  return {
    id: `wechat:${encodeURIComponent(account.accountRoot)}`,
    source: 'wechat',
    sourceLabel: '微信',
    label: account.nickname || account.wxid || account.directoryName || '未命名账号',
    accountHint: account.wxid || account.directoryName,
    avatar: account.avatar,
    status:
      current && connecting
        ? 'connecting'
        : current && connected
          ? 'connected'
          : account.hasSavedDbKey
            ? 'available'
            : 'needs_setup'
  }
}
