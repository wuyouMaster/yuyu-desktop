import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RichMessageBubble } from '../../src/renderer/src/components/RichMessageBubble'
import { VideoBubble } from '../../src/renderer/src/components/VideoBubble'
import type { EntityId } from '../../src/shared/entity-id'

const assetId = 'wechat:fixture-account:asset%2Fvideo%2Ffixture' as EntityId

describe('media components', () => {
  beforeEach(() => {
    window.api = {
      resolveUnifiedAsset: vi.fn(),
      getVideo: vi.fn(),
      saveUnifiedAsset: vi.fn().mockResolvedValue({ success: true })
    } as unknown as typeof window.api
  })

  it('uses a unified video asset without calling the legacy video API', async () => {
    vi.mocked(window.api.resolveUnifiedAsset).mockResolvedValue({
      kind: 'asset',
      id: assetId,
      nativeRef: { source: 'wechat', account: 'fixture-account', native: 'asset/video/fixture' },
      assetKind: 'video',
      state: 'available',
      uri: 'yuyu-media://local/video-fixture',
      thumbnailUri: 'yuyu-media://local/poster-fixture',
      mimeType: 'video/mp4'
    })

    render(<VideoBubble assetId={assetId} duration={12} />)

    await waitFor(() => expect(document.querySelector('video')).toBeTruthy())
    const video = document.querySelector('video')
    expect(video).toHaveAttribute('src', 'yuyu-media://local/video-fixture')
    expect(video).toHaveAttribute('poster', 'yuyu-media://local/poster-fixture')
    expect(window.api.getVideo).not.toHaveBeenCalled()
  })

  it('falls back to the legacy video API when a unified asset is unavailable', async () => {
    const fallbackVideoId = 'wechat:fixture-account:asset%2Fvideo%2Flegacy-fallback' as EntityId
    vi.mocked(window.api.resolveUnifiedAsset).mockResolvedValue({
      kind: 'asset',
      id: fallbackVideoId,
      nativeRef: {
        source: 'wechat',
        account: 'fixture-account',
        native: 'asset/video/legacy-fallback'
      },
      assetKind: 'video',
      state: 'unavailable'
    })
    vi.mocked(window.api.getVideo).mockResolvedValue({
      success: true,
      url: 'yuyu-media://local/legacy-video'
    })

    render(<VideoBubble assetId={fallbackVideoId} md5={'a'.repeat(32)} />)

    await waitFor(() =>
      expect(document.querySelector('video')).toHaveAttribute(
        'src',
        'yuyu-media://local/legacy-video'
      )
    )
    expect(window.api.getVideo).toHaveBeenCalledWith(['a'.repeat(32)], expect.any(Object))
  })

  it('uses a unified sticker asset without calling the legacy sticker API', async () => {
    const stickerId = 'wechat:fixture-account:asset%2Fsticker%2Ffixture' as EntityId
    vi.mocked(window.api.resolveUnifiedAsset).mockResolvedValue({
      kind: 'asset',
      id: stickerId,
      nativeRef: { source: 'wechat', account: 'fixture-account', native: 'asset/sticker/fixture' },
      assetKind: 'sticker',
      state: 'available',
      uri: 'data:image/png;base64,fixture-sticker',
      mimeType: 'image/png'
    })
    const getSticker = vi.fn()
    Object.assign(window.api, { getSticker })

    render(
      <RichMessageBubble
        assetId={stickerId}
        contentData={{ type: 'sticker', md5: 'fixture-md5' }}
      />
    )

    expect(await screen.findByAltText('表情包')).toHaveAttribute(
      'src',
      'data:image/png;base64,fixture-sticker'
    )
    expect(getSticker).not.toHaveBeenCalled()
  })

  it('falls back to the legacy sticker API when a unified asset is unavailable', async () => {
    const stickerId = 'wechat:fixture-account:asset%2Fsticker%2Flegacy-fallback' as EntityId
    vi.mocked(window.api.resolveUnifiedAsset).mockResolvedValue({
      kind: 'asset',
      id: stickerId,
      nativeRef: {
        source: 'wechat',
        account: 'fixture-account',
        native: 'asset/sticker/legacy-fallback'
      },
      assetKind: 'sticker',
      state: 'unavailable'
    })
    const getSticker = vi.fn().mockResolvedValue({
      success: true,
      data: 'data:image/gif;base64,legacy-sticker'
    })
    Object.assign(window.api, { getSticker })

    render(
      <RichMessageBubble
        assetId={stickerId}
        contentData={{ type: 'sticker', md5: 'fixture-md5' }}
      />
    )

    expect(await screen.findByAltText('表情包')).toHaveAttribute(
      'src',
      'data:image/gif;base64,legacy-sticker'
    )
    expect(getSticker).toHaveBeenCalled()
  })

  it.each(['success', 'cancel', 'error'] as const)(
    'saves an attachment through the application: %s',
    async (outcome) => {
      vi.mocked(window.api.saveUnifiedAsset).mockResolvedValue(
        outcome === 'success'
          ? { success: true }
          : outcome === 'cancel'
            ? { success: false, canceled: true }
            : { success: false, error: 'fixture-save-error' }
      )
      const fileId = 'wechat:fixture-account:asset%2Ffile%2Ffixture' as EntityId
      vi.mocked(window.api.resolveUnifiedAsset).mockResolvedValue({
        kind: 'asset',
        id: fileId,
        nativeRef: { source: 'wechat', account: 'fixture-account', native: 'asset/file/fixture' },
        assetKind: 'file',
        state: 'available',
        uri: 'yuyu-media://local/file-fixture',
        name: 'fixture.pdf',
        mimeType: 'application/pdf'
      })

      render(
        <RichMessageBubble
          assetId={fileId}
          contentData={{ type: 'share', title: 'fixture.pdf', des: '', url: '', typeVal: '6' }}
        />
      )

      const button = await screen.findByRole('button', { name: 'fixture.pdf' })
      fireEvent.click(button)
      await waitFor(() => expect(window.api.saveUnifiedAsset).toHaveBeenCalledWith(fileId))
      await waitFor(() => expect(button).not.toBeDisabled())
      if (outcome === 'success')
        expect(await screen.findByRole('status')).toHaveTextContent('附件已保存')
      else if (outcome === 'error')
        expect(await screen.findByRole('alert')).toHaveTextContent('fixture-save-error')
      else {
        expect(screen.queryByRole('status')).toBeNull()
        expect(screen.queryByRole('alert')).toBeNull()
      }
    }
  )

  it('shows the resolver error when a unified asset is unavailable', async () => {
    const unavailableId = 'wechat:fixture-account:asset%2Fvideo%2Fmissing' as EntityId
    vi.mocked(window.api.resolveUnifiedAsset).mockResolvedValue({
      kind: 'asset',
      id: unavailableId,
      nativeRef: { source: 'wechat', account: 'fixture-account', native: 'asset/video/missing' },
      assetKind: 'video',
      state: 'unavailable',
      extensions: { wechat: { error: '本地未找到视频文件' } }
    })

    render(<VideoBubble assetId={unavailableId} />)

    await waitFor(() => expect(screen.getByText('本地未找到视频文件')).toBeVisible())
    expect(window.api.getVideo).not.toHaveBeenCalled()
  })
})
