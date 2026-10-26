import { basename, extname, isAbsolute, normalize, parse, sep } from 'node:path'
import type { ComposerAttachmentSelection } from '../shared/api'

export const MAX_COMPOSER_ATTACHMENTS = 20

type ComposerAttachmentPickerProperty = 'openFile' | 'openDirectory' | 'multiSelections'

export function composerAttachmentPickerProperties(
  platform: NodeJS.Platform = process.platform
): ComposerAttachmentPickerProperty[] {
  return [
    'openFile',
    ...(platform === 'darwin' ? ['openDirectory' as const] : []),
    'multiSelections'
  ]
}

const rasterImageExtensions = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.heic',
  '.heif',
  '.jpeg',
  '.jpg',
  '.png',
  '.tif',
  '.tiff',
  '.webp'
])

export function describeComposerAttachment(
  filePath: string,
  isDirectory = false
): ComposerAttachmentSelection | null {
  if (!isAbsolute(filePath)) return null
  const normalizedPath = normalize(filePath)
  const root = parse(normalizedPath).root
  const fsPath = normalizedPath.endsWith(sep) && normalizedPath !== root
    ? normalizedPath.slice(0, -sep.length)
    : normalizedPath
  const path = isDirectory && !fsPath.endsWith(sep) ? `${fsPath}${sep}` : fsPath
  return {
    kind: !isDirectory && rasterImageExtensions.has(extname(fsPath).toLowerCase())
      ? 'image'
      : 'file',
    name: basename(fsPath),
    fsPath,
    path
  }
}
