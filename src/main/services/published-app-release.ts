import { net } from 'electron'
import { compare, parse, prerelease } from 'semver'

const API_URL = 'https://api.github.com/repos/wuyouMaster/yuyu-desktop/releases'
const RELEASE_DOWNLOAD_URL = 'https://github.com/wuyouMaster/yuyu-desktop/releases/download'
const PAGE_SIZE = 100
const MAX_PAGES = 10

type FetchReleases = (url: string, init: RequestInit) => Promise<Response>
interface PublishedRelease {
  tag: string
  version: string
  assets: string[]
}

/** Select only published releases; the GitHub Atom feed also includes unpublished tags. */
export async function selectPublishedAppRelease(
  currentVersion: string,
  fetchReleases: FetchReleases = (url, init) => net.fetch(url, init)
): Promise<PublishedRelease> {
  const current = parse(currentVersion)
  if (!current) throw new Error('当前应用版本无效')
  const currentChannel = prerelease(current)?.[0]
  let selected: PublishedRelease | undefined

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await fetchReleases(`${API_URL}?per_page=${PAGE_SIZE}&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json' },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(20_000)
    })
    if (!response.ok) throw new Error(`公开版本列表请求失败（HTTP ${response.status}）`)
    const releases: unknown = await response.json()
    if (!Array.isArray(releases)) throw new Error('公开版本列表格式无效')
    for (const entry of releases) {
      if (!entry || typeof entry !== 'object') continue
      const release = entry as Record<string, unknown>
      if (
        release.draft !== false ||
        typeof release.published_at !== 'string' ||
        typeof release.prerelease !== 'boolean' ||
        typeof release.tag_name !== 'string'
      )
        continue
      const version = parse(release.tag_name)
      if (!version || ![version.version, `v${version.version}`].includes(release.tag_name)) continue
      const channel = prerelease(version)?.[0]
      const isPreview = release.prerelease || channel !== undefined
      if (
        isPreview &&
        (!currentChannel ||
          !channel ||
          (channel !== currentChannel && !(currentChannel === 'alpha' && channel === 'beta')))
      )
        continue
      if (selected && compare(version, selected.version) <= 0) continue
      if (!Array.isArray(release.assets)) throw new Error('公开版本附件列表格式无效')
      selected = {
        tag: release.tag_name,
        version: version.version,
        assets: release.assets.flatMap((asset: unknown) => {
          if (!asset || typeof asset !== 'object') return []
          const name = (asset as Record<string, unknown>).name
          return typeof name === 'string' ? [name] : []
        })
      }
    }
    if (releases.length < PAGE_SIZE) {
      if (!selected) throw new Error('未找到当前更新渠道的公开版本')
      return selected
    }
  }
  throw new Error('公开版本列表过长，无法完整检查')
}

export function publishedReleaseFeedUrl(tag: string): string {
  return `${RELEASE_DOWNLOAD_URL}/${encodeURIComponent(tag)}/`
}
