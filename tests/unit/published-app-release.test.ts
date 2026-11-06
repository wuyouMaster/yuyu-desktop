import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))
import {
  publishedReleaseFeedUrl,
  selectPublishedAppRelease
} from '../../src/main/services/published-app-release'

const release = (tag_name: string, options: { draft?: boolean; prerelease?: boolean } = {}) => ({
  tag_name,
  draft: options.draft ?? false,
  prerelease: options.prerelease ?? tag_name.includes('-'),
  published_at: '2026-11-05T00:00:00Z',
  assets: [{ name: 'latest-mac.yml' }, { name: 'latest.yml' }]
})
const response = (data: unknown, status = 200): Response =>
  ({
    ok: status === 200,
    status,
    json: async () => data
  }) as Response

describe('published app release selection', () => {
  it('ignores draft tags and picks the newest published matching preview by semver', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        response([
          release('v0.0.0-migration.99', { draft: true }),
          release('v0.0.0-other.11'),
          release('v0.0.0-migration.5'),
          release('v0.0.0-migration.10'),
          release('v0.0.0-migration.6')
        ])
      )
    const chosen = await selectPublishedAppRelease('0.0.0-migration.4', fetcher)
    expect(chosen).toMatchObject({ tag: 'v0.0.0-migration.10', version: '0.0.0-migration.10' })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error' })
    expect(publishedReleaseFeedUrl(chosen.tag)).toBe(
      'https://github.com/wuyouMaster/yuyu-desktop/releases/download/v0.0.0-migration.10/'
    )
  })

  it('does not offer previews to stable users and allows a stable release to preview users', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        response([release('v2.0.0-beta.3'), release('v1.9.1', { prerelease: false })])
      )
    expect((await selectPublishedAppRelease('1.9.0', fetcher)).version).toBe('1.9.1')
    expect((await selectPublishedAppRelease('1.9.0-migration.5', fetcher)).version).toBe('1.9.1')
  })

  it('checks later pages and ignores malformed or unsafe tag names', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(Array.from({ length: 100 }, () => release('v1.0.0'))))
      .mockResolvedValueOnce(response([release('v1.2.0'), release('v1.3.0/../../x')]))
    expect((await selectPublishedAppRelease('1.0.0', fetcher)).version).toBe('1.2.0')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1][0]).toContain('page=2')
  })

  it('fails explicitly when the API errors or has no eligible published release', async () => {
    await expect(
      selectPublishedAppRelease('1.0.0', vi.fn().mockResolvedValue(response([], 403)))
    ).rejects.toThrow('HTTP 403')
    await expect(
      selectPublishedAppRelease(
        '1.0.0',
        vi.fn().mockResolvedValue(response([release('v1.2.0-beta.1')]))
      )
    ).rejects.toThrow('未找到当前更新渠道的公开版本')
  })
})
