import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { isAbsolute, normalize } from 'node:path'
import type { JsonMap, ThreadImageResult } from '../shared/api'

export const MAX_THREAD_IMAGE_BYTES = 4 * 1024 * 1024

const DEFAULT_MAX_GRANTED_PATHS = 512
const MAX_PAYLOAD_DEPTH = 32
const MAX_PAYLOAD_NODES = 20_000
const MAX_PATHS_PER_PAYLOAD = 256
const IMAGE_SAMPLE_BYTES = 12

type ThreadImageMimeType = ThreadImageResult['mimeType']

interface ThreadImageRpcClient {
  request(method: string, params?: JsonMap): Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizedAbsolutePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4_096 &&
    !value.includes('\0') &&
    isAbsolute(value) &&
    normalize(value) === value
  )
}

export function imageMimeType(bytes: Uint8Array): ThreadImageMimeType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 6 &&
    (String.fromCharCode(...bytes.subarray(0, 6)) === 'GIF87a' ||
      String.fromCharCode(...bytes.subarray(0, 6)) === 'GIF89a')
  ) {
    return 'image/gif'
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

function decodeImageResponse(response: unknown): Buffer {
  if (!isRecord(response) || typeof response.dataBase64 !== 'string') {
    throw new Error('Invalid thread image response from app-server')
  }

  const encoded = response.dataBase64
  const maximumEncodedLength = Math.ceil(MAX_THREAD_IMAGE_BYTES / 3) * 4
  if (
    encoded.length === 0 ||
    encoded.length > maximumEncodedLength ||
    encoded.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  ) {
    throw new Error('Invalid or oversized thread image response from app-server')
  }

  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.byteLength > MAX_THREAD_IMAGE_BYTES || bytes.toString('base64') !== encoded) {
    throw new Error('Invalid or oversized thread image response from app-server')
  }
  return bytes
}

/**
 * Exact-file capabilities for images surfaced in a trusted app-server payload
 * or selected in Electron's native picker. Renderer code cannot mint grants.
 */
export class ThreadImagePathGrants {
  private readonly paths = new Map<string, true>()

  constructor(private readonly maxGrantedPaths = DEFAULT_MAX_GRANTED_PATHS) {
    if (!Number.isSafeInteger(maxGrantedPaths) || maxGrantedPaths <= 0) {
      throw new TypeError('maxGrantedPaths must be positive')
    }
  }

  grantFromTrustedPayload(payload: unknown): number {
    const found = new Set<string>()
    const seen = new WeakSet<object>()
    let visitedNodes = 0

    const visit = (value: unknown, depth: number): void => {
      if (
        found.size >= MAX_PATHS_PER_PAYLOAD ||
        depth > MAX_PAYLOAD_DEPTH ||
        visitedNodes >= MAX_PAYLOAD_NODES
      ) {
        return
      }
      visitedNodes += 1
      if (!value || typeof value !== 'object') return
      if (seen.has(value)) return
      seen.add(value)

      if (isRecord(value)) {
        if (
          (value.type === 'imageView' || value.type === 'localImage') &&
          normalizedAbsolutePath(value.path)
        ) {
          found.add(value.path)
        } else if (value.type === 'imageGeneration') {
          if (normalizedAbsolutePath(value.savedPath)) found.add(value.savedPath)
          if (normalizedAbsolutePath(value.result)) found.add(value.result)
        }
      }

      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
          visit(value[index], depth + 1)
          if (found.size >= MAX_PATHS_PER_PAYLOAD || visitedNodes >= MAX_PAYLOAD_NODES) break
        }
        return
      }

      const recordValue = value as Record<string, unknown>
      for (const key in recordValue) {
        if (!Object.hasOwn(recordValue, key)) continue
        visit(recordValue[key], depth + 1)
        if (found.size >= MAX_PATHS_PER_PAYLOAD || visitedNodes >= MAX_PAYLOAD_NODES) break
      }
    }

    visit(payload, 0)
    return this.grant(found)
  }

  grantFromPicker(paths: Iterable<string>): number {
    return this.grant(paths)
  }

  allows(path: unknown): path is string {
    return normalizedAbsolutePath(path) && this.paths.has(path)
  }

  assertAllowed(path: unknown): asserts path is string {
    if (!this.allows(path)) {
      throw new Error('Thread image path was not authorized by app-server or the native file picker')
    }
  }

  private grant(paths: Iterable<string>): number {
    let granted = 0
    for (const path of paths) {
      if (!normalizedAbsolutePath(path)) continue
      this.paths.delete(path)
      this.paths.set(path, true)
      granted += 1
      while (this.paths.size > this.maxGrantedPaths) {
        const oldest = this.paths.keys().next().value as string | undefined
        if (!oldest) break
        this.paths.delete(oldest)
      }
    }
    return granted
  }
}

async function inspectThreadImage(path: string): Promise<{
  mimeType: ThreadImageMimeType
  sizeBytes: number
}> {
  // O_NONBLOCK prevents a trusted-but-stale path from hanging the main process
  // if another process replaced the image with a FIFO or device node.
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile()) throw new Error('Thread image path is not a regular file')
    if (metadata.size > MAX_THREAD_IMAGE_BYTES) {
      throw new Error('Thread image is too large to preview')
    }

    const sample = Buffer.alloc(Math.min(metadata.size, IMAGE_SAMPLE_BYTES))
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0)
    const mimeType = imageMimeType(sample.subarray(0, bytesRead))
    if (!mimeType) throw new Error('Thread image is not a supported raster image')
    return { mimeType, sizeBytes: metadata.size }
  } finally {
    await handle.close()
  }
}

export async function readThreadImage(
  client: ThreadImageRpcClient,
  grants: ThreadImagePathGrants,
  path: unknown
): Promise<ThreadImageResult> {
  grants.assertAllowed(path)
  const expected = await inspectThreadImage(path)
  const response = await client.request('fs/readFile', { path })
  const bytes = decodeImageResponse(response)
  const mimeType = imageMimeType(bytes)
  if (!mimeType || mimeType !== expected.mimeType || bytes.byteLength !== expected.sizeBytes) {
    throw new Error('Thread image changed while the preview was loading')
  }

  return {
    path,
    mimeType,
    dataBase64: bytes.toString('base64'),
    sizeBytes: bytes.byteLength
  }
}
