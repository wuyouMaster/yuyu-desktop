import type { WechatInboundItem } from '../../shared/wechat-connector-port'
export function extractInboundText(items: WechatInboundItem[] | undefined): string {
  return (items ?? []).filter(item => item.type === 1 && item.text?.trim()).map(item => item.text!.trim()).join(' ')
}
