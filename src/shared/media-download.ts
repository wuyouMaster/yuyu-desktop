export interface MediaCdnDownloadContract {
  /** Local path to write the (usually encrypted) payload. */
  fullPath: string
  /** Per-message image aeskey (not db/account key). */
  aeskey?: string
  /** CDN file id from message metadata. */
  fileId?: string
  /** Client/task id used by WeChat CDN tasks. */
  clientId?: string
  /** WeChat message type (3=image, 43=video, 34=voice, …). */
  msgtype?: number
  /** Direct HTTP(S) CDN URL when the message provides one (cdnurl). */
  downloadUrl?: string
  /**
   * Encrypted HTTP(S) CDN URL (emoji `encrypturl` / 20402).
   * Payload is AES-128-CBC with IV = message aeskey + PKCS#7.
   */
  encryptUrl?: string
}

export type MediaCdnFetchErrorCode =
  | 'INVALID_URL'
  | 'MISSING_URL'
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'TOO_LARGE'
  | 'EMPTY_BODY'
  | 'WRITE_FAILED'
  | 'NETWORK_ERROR'

export interface MediaCdnFetchResult {
  ok: boolean
  path?: string
  bytes?: number
  errorCode?: MediaCdnFetchErrorCode
  error?: string
  httpStatus?: number
}

const MAX_MEDIA_BYTES = 64 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30_000

export function mediaCdnMaxBytes(): number {
  return MAX_MEDIA_BYTES
}

export function mediaCdnDefaultTimeoutMs(): number {
  return DEFAULT_TIMEOUT_MS
}

/** Only allow http(s) CDN URLs; reject file:, javascript:, etc. */
export function normalizeMediaCdnUrl(raw: string): string | null {
  const value = String(raw || '').trim()
  if (!value) return null
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return parsed.toString()
}
