import { describe, expect, it, vi } from 'vitest'
import { inlineClipboardImageBytes, writeClipboardImage } from './imageClipboard'
import { MAX_THREAD_IMAGE_BYTES } from './threadImageAccess'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')

describe('native image clipboard', () => {
  it('decodes a displayed inline raster without fetching a URL', () => {
    expect(inlineClipboardImageBytes(`data:image/png;base64,${png.toString('base64')}`)).toEqual(png)
  })

  it('rejects URLs, SVG, invalid base64, MIME mismatch and excessive payloads', () => {
    for (const source of [
      'https://example.com/image.png',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'data:image/png;base64,%%%%',
      'data:image/png;base64,aA',
      'data:image/png;base64,iVBORw0KGgp=',
      `data:image/jpeg;base64,${png.toString('base64')}`,
      `data:image/png;base64,${Buffer.alloc(MAX_THREAD_IMAGE_BYTES + 1).toString('base64')}`
    ]) {
      expect(() => inlineClipboardImageBytes(source)).toThrow()
    }
  })

  it('writes a successfully decoded native image and preserves the clipboard on failure', () => {
    const image = { isEmpty: () => false }
    const createImage = vi.fn(() => image)
    const writeImage = vi.fn()
    writeClipboardImage(png, createImage, writeImage)
    expect(createImage).toHaveBeenCalledWith(png)
    expect(writeImage).toHaveBeenCalledWith(image)

    writeImage.mockClear()
    expect(() => writeClipboardImage(png, () => ({ isEmpty: () => true }), writeImage)).toThrow('could not be decoded')
    expect(writeImage).not.toHaveBeenCalled()
  })
})
