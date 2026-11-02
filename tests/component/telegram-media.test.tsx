import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelegramMedia } from '../../src/renderer/src/features/telegram/TelegramMedia'
import type { Asset } from '../../src/shared/domain-entities'
import type { ReadContext } from '../../src/shared/source-context'
import { serializeEntityId } from '../../src/shared/entity-id'

const assetId = serializeEntityId({
  source: 'telegram',
  account: 'fixture-account',
  native: 'asset/fixture-image'
})
const accountId = serializeEntityId({
  source: 'telegram',
  account: 'fixture-account',
  native: 'account'
})
const context: ReadContext = {
  expected: {
    source: 'telegram',
    accountId,
    sessionId: 'fixture-session',
    revision: 'fixture-revision',
    identity: { kind: 'account' }
  },
  scope: { kind: 'all' }
}
const observers: { callback: IntersectionObserverCallback; observer: IntersectionObserver }[] = []
const asset: Asset = {
  id: assetId,
  kind: 'asset',
  nativeRef: { source: 'telegram', account: 'fixture-account', native: 'asset/fixture-image' },
  assetKind: 'image',
  state: 'available',
  uri: 'yuyu-media://fixture/image',
  name: 'fixture-file.pdf'
}

beforeEach(() => {
  observers.length = 0
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        observers.push({ callback, observer: this as unknown as IntersectionObserver })
      }
      observe(): void {
        void 0
      }
      disconnect(): void {
        void 0
      }
      unobserve(): void {
        void 0
      }
    }
  )
})
afterEach(() => vi.unstubAllGlobals())

async function reveal(): Promise<void> {
  // Resolve the outer asset, then notify the existing ImageBubble's observer
  // when it mounts with the resolved URL, as a browser would do.
  for (let pass = 0; pass < 2; pass++) {
    await act(async () => {
      for (const { callback, observer } of [...observers]) {
        callback(
          [
            {
              isIntersecting: true,
              boundingClientRect: { bottom: 1, top: 0, left: 0, right: 1 }
            } as IntersectionObserverEntry
          ],
          observer
        )
      }
    })
  }
}

describe('TelegramMedia', () => {
  it('replaces the displayed preview and viewer URL after the full attachment loads', async () => {
    const preview = {
      ...asset,
      uri: 'yuyu-media://fixture/preview',
      extensions: { telegram: { previewOnly: true } }
    }
    const onImageClick = vi.fn()
    window.api = {
      resolveUnifiedAsset: vi.fn().mockResolvedValue(preview),
      loadTelegramMedia: vi.fn().mockResolvedValue(asset)
    } as unknown as typeof window.api
    render(
      <TelegramMedia
        content={{ type: 'image', assetId }}
        context={context}
        onImageClick={onImageClick}
      />
    )
    await reveal()
    expect(await screen.findByAltText('图片')).toHaveAttribute('src', preview.uri)
    expect(screen.getByText('图片预览，原图尚未完整缓存')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '在 Telegram 中加载' }))
    expect(await screen.findByText('附件已从本地缓存加载')).toBeInTheDocument()
    await reveal()
    expect(screen.queryByText('图片预览，原图尚未完整缓存')).not.toBeInTheDocument()
    expect(await screen.findByAltText('图片')).toHaveAttribute('src', asset.uri)
    fireEvent.click(screen.getByRole('button', { name: '查看图片' }))
    expect(onImageClick).toHaveBeenCalledWith(asset.uri)
  })

  it('shows cache completion without asking the user to download again', async () => {
    window.api = {
      resolveUnifiedAsset: vi
        .fn()
        .mockResolvedValue({ ...asset, state: 'unavailable', uri: undefined }),
      loadTelegramMedia: vi.fn().mockResolvedValue(asset)
    } as unknown as typeof window.api
    render(
      <TelegramMedia
        content={{ type: 'image', assetId }}
        context={context}
        onImageClick={vi.fn()}
      />
    )
    await reveal()
    fireEvent.click(screen.getByRole('button', { name: '在 Telegram 中加载' }))
    expect(await screen.findByText('附件已从本地缓存加载')).toBeInTheDocument()
    expect(screen.queryByText(/请点击 Telegram 中的下载按钮/)).not.toBeInTheDocument()
  })

  it('does not let an old source request clear the loading state of a newer request', async () => {
    let first!: (value: Asset) => void
    let second!: (value: Asset) => void
    const load = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Asset>((resolve) => {
            first = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<Asset>((resolve) => {
            second = resolve
          })
      )
    window.api = {
      resolveUnifiedAsset: vi
        .fn()
        .mockResolvedValue({ ...asset, state: 'unavailable', uri: undefined }),
      loadTelegramMedia: load
    } as unknown as typeof window.api
    const view = render(
      <TelegramMedia
        content={{ type: 'image', assetId }}
        context={context}
        onImageClick={vi.fn()}
      />
    )
    await reveal()
    fireEvent.click(screen.getByRole('button', { name: '在 Telegram 中加载' }))
    const next = { ...context, expected: { ...context.expected, sessionId: 'fixture-next' } }
    view.rerender(
      <TelegramMedia content={{ type: 'image', assetId }} context={next} onImageClick={vi.fn()} />
    )
    await reveal()
    fireEvent.click(screen.getByRole('button', { name: '在 Telegram 中加载' }))
    await act(async () => first(asset))
    expect(screen.getByRole('button', { name: '正在加载…' })).toBeDisabled()
    expect(screen.queryByText('附件已从本地缓存加载')).not.toBeInTheDocument()
    await act(async () => second(asset))
    expect(screen.getByText('附件已从本地缓存加载')).toBeInTheDocument()
  })

  it('labels partial photos as previews and binds client loading to the source context', async () => {
    const load = vi.fn().mockResolvedValue({ ...asset, state: 'unavailable', uri: undefined })
    window.api = {
      resolveUnifiedAsset: vi
        .fn()
        .mockResolvedValue({ ...asset, extensions: { telegram: { previewOnly: true } } }),
      loadTelegramMedia: load
    } as unknown as typeof window.api
    render(
      <TelegramMedia
        content={{ type: 'image', assetId }}
        context={context}
        onImageClick={vi.fn()}
      />
    )
    await reveal()
    expect(screen.getByText('图片预览，原图尚未完整缓存')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '在 Telegram 中加载' }))
    expect(await screen.findByText(/Telegram 可能仍在下载/)).toBeInTheDocument()
    expect(load).toHaveBeenCalledWith({ assetId, expectedContext: context.expected })
    expect(screen.getByRole('button', { name: '重试原图' })).toBeInTheDocument()
  })

  it('does not retain an old account image while a replacement asset resolves', async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce(asset)
      .mockReturnValueOnce(new Promise(() => {}))
    window.api = { resolveUnifiedAsset: resolve } as unknown as typeof window.api
    const view = render(
      <TelegramMedia
        content={{ type: 'image', assetId }}
        context={context}
        onImageClick={vi.fn()}
      />
    )
    await reveal()
    expect(await screen.findByAltText('图片')).toBeInTheDocument()
    view.rerender(
      <TelegramMedia
        content={{ type: 'image', assetId }}
        context={{ ...context, expected: { ...context.expected, sessionId: 'fixture-next' } }}
        onImageClick={vi.fn()}
      />
    )
    expect(screen.queryByAltText('图片')).not.toBeInTheDocument()
  })
  it.each(['image', 'audio', 'video', 'file', 'sticker'] as const)(
    'resolves %s only on demand and renders the returned URI',
    async (kind) => {
      const resolve = vi.fn().mockResolvedValue({ ...asset, assetKind: kind })
      window.api = { resolveUnifiedAsset: resolve } as unknown as typeof window.api
      const { container } = render(
        <TelegramMedia content={{ type: kind, assetId }} context={context} onImageClick={vi.fn()} />
      )
      expect(resolve).not.toHaveBeenCalled()
      await reveal()
      expect(resolve).toHaveBeenCalledOnce()
      expect(resolve).toHaveBeenCalledWith(assetId, context)
      if (kind === 'image' || kind === 'sticker') {
        expect(await screen.findByAltText('图片')).toHaveAttribute('src', asset.uri)
      } else if (kind === 'file') {
        expect(screen.getByRole('button', { name: /fixture-file.pdf/ })).toBeInTheDocument()
        expect(screen.queryByRole('link')).not.toBeInTheDocument()
      } else {
        expect(container.querySelector(kind === 'audio' ? 'audio' : 'video')).toHaveAttribute(
          'src',
          asset.uri
        )
        expect(container.querySelector(kind === 'audio' ? 'audio' : 'video')).toHaveAttribute(
          'preload',
          'none'
        )
      }
    }
  )

  it('uses a muted looping inline video for video/webm stickers', async () => {
    window.api = {
      resolveUnifiedAsset: vi.fn().mockResolvedValue({
        ...asset,
        assetKind: 'sticker',
        mimeType: 'video/webm',
        uri: 'yuyu-media://fixture/sticker.webm'
      })
    } as unknown as typeof window.api
    render(
      <TelegramMedia
        content={{ type: 'sticker', assetId }}
        context={context}
        onImageClick={vi.fn()}
      />
    )
    await reveal()
    const video = screen.getByLabelText('Telegram 视频贴纸') as HTMLVideoElement
    expect(video).toHaveAttribute('src', 'yuyu-media://fixture/sticker.webm')
    expect(video.muted).toBe(true)
    expect(video).toHaveAttribute('loop')
    expect(video).toHaveAttribute('playsinline')
    expect(video).toHaveAttribute('controls')
    expect(screen.queryByAltText('图片')).not.toBeInTheDocument()
  })

  it.each([
    { result: { success: true }, text: '附件已保存' },
    { result: { success: false, canceled: true }, text: '已取消保存' },
    { result: { success: false, error: '合成文件保存失败' }, text: '合成文件保存失败' }
  ])('saves files through unified IPC and reports $text', async ({ result, text }) => {
    const save = vi.fn().mockResolvedValue(result)
    window.api = {
      resolveUnifiedAsset: vi.fn().mockResolvedValue({ ...asset, assetKind: 'file' }),
      saveUnifiedAsset: save
    } as unknown as typeof window.api
    render(
      <TelegramMedia content={{ type: 'file', assetId }} context={context} onImageClick={vi.fn()} />
    )
    await reveal()
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /fixture-file.pdf/ }))
    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(save).toHaveBeenCalledExactlyOnceWith(assetId, context)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    if (!result.success) expect(screen.queryByText('附件已保存')).not.toBeInTheDocument()
  })

  it('handles thrown file-save errors and enables retry', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('fixture save error'))
      .mockResolvedValue({ success: true })
    window.api = {
      resolveUnifiedAsset: vi.fn().mockResolvedValue({ ...asset, assetKind: 'file' }),
      saveUnifiedAsset: save
    } as unknown as typeof window.api
    render(
      <TelegramMedia content={{ type: 'file', assetId }} context={context} onImageClick={vi.fn()} />
    )
    await reveal()
    fireEvent.click(screen.getByRole('button', { name: /fixture-file.pdf/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('附件保存失败，请重试')
    fireEvent.click(screen.getByRole('button', { name: /fixture-file.pdf/ }))
    expect(await screen.findByText('附件已保存')).toBeInTheDocument()
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('supports explicit loading when IntersectionObserver is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const resolve = vi.fn().mockResolvedValue(asset)
    window.api = { resolveUnifiedAsset: resolve } as unknown as typeof window.api
    render(
      <TelegramMedia
        content={{ type: 'image', assetId }}
        context={context}
        onImageClick={vi.fn()}
      />
    )
    expect(resolve).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '加载图片' }))
    expect(await screen.findByAltText('图片')).toHaveAttribute('src', asset.uri)
  })

  it.each([
    { ...asset, state: 'unavailable' },
    { ...asset, state: 'unresolved' },
    { ...asset, uri: undefined }
  ])('shows an explicit placeholder for unusable assets', async (result) => {
    window.api = {
      resolveUnifiedAsset: vi.fn().mockResolvedValue(result)
    } as unknown as typeof window.api
    render(
      <TelegramMedia
        content={{ type: 'image', assetId }}
        context={context}
        onImageClick={vi.fn()}
      />
    )
    await reveal()
    expect(screen.getByText(/图片暂不可用/)).toBeInTheDocument()
    expect(screen.queryByAltText('图片')).not.toBeInTheDocument()
  })

  it('shows resolver failures and allows a bounded explicit retry', async () => {
    const resolve = vi
      .fn()
      .mockRejectedValueOnce(new Error('fixture-error'))
      .mockResolvedValue(asset)
    window.api = { resolveUnifiedAsset: resolve } as unknown as typeof window.api
    render(
      <TelegramMedia
        content={{ type: 'image', assetId }}
        context={context}
        onImageClick={vi.fn()}
      />
    )
    await reveal()
    expect(screen.getByText('图片读取失败，请重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试图片' }))
    await reveal()
    expect(await screen.findByAltText('图片')).toHaveAttribute('src', asset.uri)
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it.each(['image', 'audio', 'video'] as const)(
    'shows %s decode/network failures instead of a broken player',
    async (kind) => {
      window.api = {
        resolveUnifiedAsset: vi.fn().mockResolvedValue(asset)
      } as unknown as typeof window.api
      const { container } = render(
        <TelegramMedia content={{ type: kind, assetId }} context={context} onImageClick={vi.fn()} />
      )
      await reveal()
      const element =
        kind === 'image' ? await screen.findByAltText('图片') : container.querySelector(kind)!
      fireEvent.error(element)
      expect(screen.getByText(/附件可能已失效或格式不受支持/)).toBeInTheDocument()
    }
  )

  it('discards a resolution from an unmounted source session', async () => {
    let finish!: (result: Asset) => void
    window.api = {
      resolveUnifiedAsset: vi.fn(
        () =>
          new Promise<Asset>((resolve) => {
            finish = resolve
          })
      )
    } as unknown as typeof window.api
    const { unmount } = render(
      <TelegramMedia
        content={{ type: 'image', assetId }}
        context={context}
        onImageClick={vi.fn()}
      />
    )
    await reveal()
    unmount()
    await act(async () => finish(asset))
    expect(screen.queryByAltText('图片')).not.toBeInTheDocument()
  })
})
