import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityId } from '../../src/shared/entity-id'

const requestImage = vi.fn()
vi.mock('../../src/renderer/src/components/image-loader', () => ({
  getCachedLoadedImage: vi.fn(() => undefined),
  requestImage: (...args: unknown[]) => requestImage(...args)
}))

import { ImageBubble } from '../../src/renderer/src/components/ImageBubble'
import { RichMessageBubble } from '../../src/renderer/src/components/RichMessageBubble'
import { ImageKeyGuidanceContext } from '../../src/renderer/src/components/chat/image-key-guidance'
import { getCachedLoadedImage } from '../../src/renderer/src/components/image-loader'

const thumbnail =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII='
const original = `${thumbnail}original`

describe('ImageBubble', () => {
  beforeEach(() => {
    requestImage.mockReset()
    vi.mocked(getCachedLoadedImage).mockReturnValue(undefined)
    window.api = {
      copyImage: vi.fn().mockResolvedValue({ success: true }),
      resolveUnifiedAsset: vi.fn()
    } as unknown as typeof window.api
  })

  it('uses the unified asset and skips the legacy image loader', async () => {
    const unifiedUri = 'data:image/png;base64,fixture-unified-image'
    vi.mocked(window.api.resolveUnifiedAsset).mockResolvedValue({
      kind: 'asset',
      id: 'wechat:fixture-account:asset%2Fimage%2Ffixture' as EntityId,
      nativeRef: { source: 'wechat', account: 'fixture-account', native: 'asset/image/fixture' },
      assetKind: 'image',
      state: 'available',
      uri: unifiedUri,
      mimeType: 'image/png'
    })

    render(<ImageBubble assetId="wechat:fixture-account:asset%2Fimage%2Ffixture" />)

    expect(await screen.findByAltText('图片')).toHaveAttribute('src', unifiedUri)
    expect(requestImage).not.toHaveBeenCalled()
  })

  it('loads a thumbnail lazily, then requests the original when opened', async () => {
    requestImage
      .mockResolvedValueOnce({ data: thumbnail, isThumbnail: true })
      .mockResolvedValueOnce({ data: original, isThumbnail: false })
    const onImageClick = vi.fn()
    render(
      <ImageBubble
        imageMd5="fixture-image"
        imageDatName="fixture.dat"
        sessionId="fixture-session"
        onImageClick={onImageClick}
      />
    )

    const image = await screen.findByAltText('图片')
    expect(image).toHaveAttribute('src', thumbnail)
    await userEvent.click(image)
    await waitFor(() => expect(onImageClick).toHaveBeenCalledWith(original))
    expect(requestImage.mock.calls[1][3]).toMatchObject({ force: true })

    onImageClick.mockClear()
    requestImage.mockResolvedValueOnce({ data: original, isThumbnail: false })
    const trigger = screen.getByRole('button', { name: '查看图片' })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(onImageClick).toHaveBeenCalledWith(original))
  })

  it('shows an explicit error and allows retry', async () => {
    requestImage.mockRejectedValueOnce(new Error('不支持的 DAT 版本'))
    render(<ImageBubble imageMd5="unsupported" />)
    expect(await screen.findByText('不支持的 DAT 版本')).toBeVisible()

    requestImage.mockResolvedValueOnce({ data: thumbnail, isThumbnail: true })
    await userEvent.click(screen.getByText('加载失败'))
    expect(await screen.findByAltText('图片')).toBeVisible()
  })

  it('offers image settings and automatically retries a missing key when configured', async () => {
    requestImage.mockRejectedValueOnce(new Error('未配置图片解密密钥'))
    const cleanup = vi.fn()
    const guidance = {
      configured: false,
      onOpenSettings: vi.fn(),
      registerLockedImage: vi.fn(() => cleanup)
    }
    const { rerender } = render(
      <ImageKeyGuidanceContext.Provider value={guidance}>
        <ImageBubble imageMd5="fixture-locked-image" />
      </ImageKeyGuidanceContext.Provider>
    )
    expect(screen.getByText('图片待解锁')).toBeVisible()
    await waitFor(() => expect(requestImage).toHaveBeenCalledOnce())
    await userEvent.click(screen.getByRole('button', { name: '图片待解锁，前往配置图片密钥' }))
    expect(guidance.onOpenSettings).toHaveBeenCalledOnce()
    expect(guidance.registerLockedImage).toHaveBeenCalledOnce()

    requestImage.mockResolvedValueOnce({ data: thumbnail, isThumbnail: true })
    rerender(
      <ImageKeyGuidanceContext.Provider value={{ ...guidance, configured: true }}>
        <ImageBubble imageMd5="fixture-locked-image" />
      </ImageKeyGuidanceContext.Provider>
    )
    expect(await screen.findByAltText('图片')).toBeVisible()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(requestImage).toHaveBeenCalledTimes(2)
  })

  it('preserves file errors when image configuration changes', async () => {
    requestImage.mockRejectedValueOnce(new Error('图片文件不存在'))
    const guidance = { configured: false, onOpenSettings: vi.fn(), registerLockedImage: vi.fn() }
    const { rerender } = render(
      <ImageKeyGuidanceContext.Provider value={guidance}>
        <ImageBubble imageMd5="fixture-missing-file" />
      </ImageKeyGuidanceContext.Provider>
    )
    expect(await screen.findByText('图片文件不存在')).toBeVisible()
    rerender(
      <ImageKeyGuidanceContext.Provider value={{ ...guidance, configured: true }}>
        <ImageBubble imageMd5="fixture-missing-file" />
      </ImageKeyGuidanceContext.Provider>
    )
    expect(screen.getByText('图片文件不存在')).toBeVisible()
    expect(screen.queryByText('图片待解锁')).not.toBeInTheDocument()
    expect(requestImage).toHaveBeenCalledOnce()
  })

  it('keeps cached images visible without a configured key', () => {
    vi.mocked(getCachedLoadedImage).mockReturnValue({ data: thumbnail, isThumbnail: true })
    const registerLockedImage = vi.fn()
    render(
      <ImageKeyGuidanceContext.Provider
        value={{ configured: false, onOpenSettings: vi.fn(), registerLockedImage }}
      >
        <ImageBubble imageMd5="fixture-cached-image" />
      </ImageKeyGuidanceContext.Provider>
    )
    expect(screen.getByAltText('图片')).toBeVisible()
    expect(registerLockedImage).not.toHaveBeenCalled()
    expect(requestImage).not.toHaveBeenCalled()
  })

  it('places a quoted image on the line below the quoted sender', async () => {
    requestImage.mockResolvedValueOnce({ data: thumbnail, isThumbnail: true })
    const { container } = render(
      <RichMessageBubble
        contentData={{
          type: 'quote',
          content: '回复内容',
          quotedContent: '[图片]',
          quotedSender: '测试群成员',
          quotedImageMd5: 'fixture-image'
        }}
        sessionId="fixture-session"
      />
    )

    expect(screen.getByText('测试群成员')).toBeInTheDocument()
    expect(container.querySelector('.quoted-message')).toHaveClass('quoted-message-image')
    expect(await screen.findByAltText('图片')).toBeVisible()
  })
})

describe('RichMessageBubble', () => {
  it('renders every article in a public-account bundle', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(
      <RichMessageBubble
        contentData={{
          type: 'share',
          title: 'Article one',
          url: 'https://example.test/one',
          appname: 'Fixture Publisher',
          articles: [
            { title: 'Article one', url: 'https://example.test/one' },
            { title: 'Article two', url: 'https://example.test/two' },
            { title: 'Article three', url: 'https://example.test/three' }
          ]
        }}
      />
    )

    expect(screen.getByText('Fixture Publisher')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Article one' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Article two' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Article three' })).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Article three' }))
    expect(open).toHaveBeenCalledWith('https://example.test/three', '_blank')
    open.mockRestore()
  })
})
