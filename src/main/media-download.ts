import http from 'http'
import https from 'https'
import { promises as fs } from 'fs'
import { dirname } from 'path'
import { mediaCdnDefaultTimeoutMs, mediaCdnMaxBytes, normalizeMediaCdnUrl, type MediaCdnDownloadContract, type MediaCdnFetchErrorCode, type MediaCdnFetchResult } from '../shared/media-download'
import { decryptMessagePayload } from './runtime-rpc/application-media-decrypt'
export async function downloadMediaCdnFile(
  contract: MediaCdnDownloadContract,
  options?: { timeoutMs?: number; maxBytes?: number }
): Promise<MediaCdnFetchResult> {
  const plainUrl = normalizeMediaCdnUrl(contract.downloadUrl || '')
  const encryptUrl = normalizeMediaCdnUrl(contract.encryptUrl || '')
  const aeskey = String(contract.aeskey || '').trim()
  if (!contract.fullPath) {
    return { ok: false, errorCode: 'WRITE_FAILED', error: 'fullPath is required' }
  }

  // Prefer plaintext cdnurl; fall back to encrypturl + aeskey (emoji 20402).
  const useEncrypt = !plainUrl && Boolean(encryptUrl && /^[0-9a-fA-F]{32}$/.test(aeskey))
  const url = useEncrypt ? encryptUrl : plainUrl
  if (!url) {
    return {
      ok: false,
      errorCode: contract.downloadUrl || contract.encryptUrl ? 'INVALID_URL' : 'MISSING_URL',
      error: contract.downloadUrl
        ? 'cdn url must be http(s)'
        : contract.encryptUrl
          ? 'encrypturl requires a 32-hex message aeskey'
          : 'cdn downloadUrl is required'
    }
  }

  const timeoutMs = options?.timeoutMs ?? mediaCdnDefaultTimeoutMs()
  const maxBytes = options?.maxBytes ?? mediaCdnMaxBytes()

  try {
    await fs.mkdir(dirname(contract.fullPath), { recursive: true })
  } catch (error) {
    return {
      ok: false,
      errorCode: 'WRITE_FAILED',
      error: error instanceof Error ? error.message : 'cannot create output directory'
    }
  }

  const buffer = await fetchBuffer(url, timeoutMs, maxBytes, 0)
  if (buffer.kind !== 'ok') {
    return {
      ok: false,
      errorCode: buffer.code,
      error: buffer.message,
      httpStatus: buffer.httpStatus
    }
  }

  let payload = buffer.data
  if (useEncrypt) {
    try {
      payload = await decryptMessagePayload(aeskey, payload)
    } catch (error) {
      return {
        ok: false,
        errorCode: 'WRITE_FAILED',
        error: error instanceof Error ? error.message : 'encrypturl decrypt failed'
      }
    }
  }

  try {
    await fs.writeFile(contract.fullPath, payload)
  } catch (error) {
    return {
      ok: false,
      errorCode: 'WRITE_FAILED',
      error: error instanceof Error ? error.message : 'cannot write media file'
    }
  }

  return { ok: true, path: contract.fullPath, bytes: payload.length }
}

type FetchOutcome =
  | { kind: 'ok'; data: Buffer }
  | {
      kind: 'fail'
      code: MediaCdnFetchErrorCode
      message: string
      httpStatus?: number
    }

function fetchBuffer(
  url: string,
  timeoutMs: number,
  maxBytes: number,
  redirectCount: number
): Promise<FetchOutcome> {
  return new Promise((resolve) => {
    if (redirectCount > 5) {
      resolve({ kind: 'fail', code: 'HTTP_ERROR', message: 'too many CDN redirects' })
      return
    }
    const client = url.startsWith('https:') ? https : http
    const request = client.get(
      url,
      {
        headers: {
          'User-Agent': 'MicroMessenger Client',
          Referer: 'https://weixin.qq.com/'
        }
      },
      (response) => {
        const status = Number(response.statusCode || 0)
        const location = response.headers.location
        if (location && [301, 302, 303, 307, 308].includes(status)) {
          response.resume()
          let nextUrl = location
          try {
            nextUrl = new URL(location, url).toString()
          } catch {
            resolve({ kind: 'fail', code: 'INVALID_URL', message: 'invalid CDN redirect' })
            return
          }
          const normalized = normalizeMediaCdnUrl(nextUrl)
          if (!normalized) {
            resolve({ kind: 'fail', code: 'INVALID_URL', message: 'CDN redirect must be http(s)' })
            return
          }
          fetchBuffer(normalized, timeoutMs, maxBytes, redirectCount + 1).then(resolve)
          return
        }
        if (status !== 200) {
          response.resume()
          resolve({
            kind: 'fail',
            code: 'HTTP_ERROR',
            message: `CDN download failed: HTTP ${status}`,
            httpStatus: status
          })
          return
        }

        const declared = Number(response.headers['content-length'] || 0)
        if (declared > maxBytes) {
          response.destroy()
          resolve({ kind: 'fail', code: 'TOO_LARGE', message: 'CDN payload exceeds size limit' })
          return
        }

        const chunks: Buffer[] = []
        let total = 0
        response.on('data', (chunk: Buffer) => {
          total += chunk.length
          if (total > maxBytes) {
            response.destroy()
            resolve({ kind: 'fail', code: 'TOO_LARGE', message: 'CDN payload exceeds size limit' })
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          const data = Buffer.concat(chunks)
          if (data.length === 0) {
            resolve({ kind: 'fail', code: 'EMPTY_BODY', message: 'CDN response body is empty' })
            return
          }
          resolve({ kind: 'ok', data })
        })
        response.on('error', (error) => {
          resolve({ kind: 'fail', code: 'NETWORK_ERROR', message: error.message })
        })
      }
    )

    request.on('error', (error) => {
      resolve({ kind: 'fail', code: 'NETWORK_ERROR', message: error.message })
    })
    request.setTimeout(timeoutMs, () => {
      request.destroy()
      resolve({ kind: 'fail', code: 'TIMEOUT', message: 'CDN download timed out' })
    })
  })
}
