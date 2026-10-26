import { imageMimeType, MAX_THREAD_IMAGE_BYTES } from './threadImageAccess'

/** Decode only inline raster images already displayed by the conversation UI. */
export function inlineClipboardImageBytes(source: unknown): Buffer {
  const maximumEncodedLength = Math.ceil(MAX_THREAD_IMAGE_BYTES / 3) * 4
  if (typeof source !== 'string' || source.length > maximumEncodedLength + 64) {
    throw new Error('Clipboard image is invalid or exceeds the image size limit')
  }
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(source)
  if (!match) throw new Error('Clipboard image must be a supported base64 raster image')
  const encoded = match[2]
  if (encoded.length % 4 !== 0 || encoded.length > maximumEncodedLength) {
    throw new Error('Clipboard image has invalid or oversized base64 data')
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (
    bytes.byteLength > MAX_THREAD_IMAGE_BYTES ||
    bytes.toString('base64') !== encoded ||
    imageMimeType(bytes) !== match[1]
  ) {
    throw new Error('Clipboard image does not match its raster image type')
  }
  return bytes
}

interface ClipboardRasterImage {
  isEmpty(): boolean
}

/** Keep validation before the pasteboard write, including native decode failure. */
export function writeClipboardImage<T extends ClipboardRasterImage>(
  bytes: Buffer,
  createImage: (buffer: Buffer) => T,
  writeImage: (image: T) => void | Promise<void>
): void | Promise<void> {
  const image = createImage(bytes)
  if (image.isEmpty()) throw new Error('Clipboard image could not be decoded')
  return writeImage(image)
}
