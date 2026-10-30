/** Application events only. Upstream wire fields, credentials and cryptography stay native. */
export interface WechatConnectorAccount {
  accountId: string
  wechatUserId: string
}
export type WechatConnectorPhase = 'stopped' | 'starting' | 'polling' | 'stale_token' | 'error'
export type WechatLoginEvent =
  | { status: 'qrcode'; qrCodeDataUrl: string }
  | { status: 'wait' | 'scaned' | 'need_verifycode' | 'verify_code_blocked' | 'expired' }
  | { status: 'confirmed' }
  | { status: 'active'; accountId: string; wechatUserId: string }
export interface WechatInboundItem {
  type: number
  text?: string
  media?: { id: string; kind: 'image' | 'voice' | 'file' | 'video'; name?: string; size?: number }
}
export interface WechatInboundMessage {
  accountId: string
  fromUserId: string
  messageId: string
  seq?: string | number
  sessionId?: string
  groupId?: string
  messageType: number
  contextToken?: string
  items: WechatInboundItem[]
  receivedAt: number
}
export interface WechatConnectorHost {
  onLog?(level: 'info' | 'warn' | 'error', message: string): void
  onMessages?(messages: WechatInboundMessage[]): Promise<void>
  onPhaseChange?(phase: WechatConnectorPhase, error?: string): void
  onLoginEvent?(event: WechatLoginEvent): void
}
