import { open, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { extname, isAbsolute, join, relative } from 'node:path'
import type {
  JsonMap,
  WorkspaceDirectoryEntry,
  WorkspaceDirectoryResult,
  WorkspaceFileResult,
  WorkspaceFileSaveRequest,
  WorkspaceFileSaveResult,
  WorkspacePathRequest
} from '../shared/api'
import { isAllowedWorkspacePathRequest } from './ipcSecurity'
export { WorkspaceRootGrants } from './workspaceRootGrants'

export const MAX_WORKSPACE_FILE_BYTES = 512 * 1024
export const MAX_WORKSPACE_IMAGE_BYTES = 4 * 1024 * 1024
export const MAX_WORKSPACE_DIRECTORY_ENTRIES = 600

const BINARY_SAMPLE_BYTES = 8 * 1024
const MAX_ENTRY_NAME_LENGTH = 1_024

interface WorkspaceRpcClient {
  request(method: string, params?: JsonMap): Promise<unknown>
}

interface FsReadDirectoryEntry {
  fileName: string
  isDirectory: boolean
  isFile: boolean
}

type SupportedImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

type FileClassification =
  | { kind: 'text'; mimeType: string; maximumBytes: number }
  | { kind: 'image'; mimeType: SupportedImageMimeType; maximumBytes: number }

const TEXT_MIME_TYPES: Record<string, string> = {
  '.c': 'text/x-c',
  '.cc': 'text/x-c++',
  '.cpp': 'text/x-c++',
  '.css': 'text/css',
  '.go': 'text/x-go',
  '.h': 'text/x-c',
  '.hpp': 'text/x-c++',
  '.html': 'text/html',
  '.java': 'text/x-java',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.jsx': 'text/jsx',
  '.md': 'text/markdown',
  '.mjs': 'text/javascript',
  '.py': 'text/x-python',
  '.rb': 'text/x-ruby',
  '.rs': 'text/x-rust',
  '.scss': 'text/x-scss',
  '.sh': 'text/x-shellscript',
  '.sql': 'text/x-sql',
  '.svg': 'image/svg+xml',
  '.swift': 'text/x-swift',
  '.toml': 'application/toml',
  '.ts': 'text/typescript',
  '.tsx': 'text/tsx',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function pathIsInside(root: string, target: string): boolean {
  const relativePath = relative(root, target)
  return (
    relativePath === '' ||
    (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith('../'))
  )
}

export async function canonicalWorkspaceTarget(
  request: WorkspacePathRequest,
  kind: 'directory' | 'file'
): Promise<string> {
  if (!isAllowedWorkspacePathRequest(request)) {
    throw new Error('Invalid workspace path request')
  }

  const [canonicalRoot, canonicalTarget] = await Promise.all([
    realpath(request.root),
    realpath(request.path)
  ])
  if (!pathIsInside(canonicalRoot, canonicalTarget)) {
    throw new Error('Workspace path resolves outside the selected project')
  }

  const [rootMetadata, targetMetadata] = await Promise.all([
    stat(canonicalRoot),
    stat(canonicalTarget)
  ])
  if (!rootMetadata.isDirectory()) throw new Error('Workspace root is not a directory')
  if (kind === 'directory' && !targetMetadata.isDirectory()) {
    throw new Error('Workspace path is not a directory')
  }
  if (kind === 'file' && !targetMetadata.isFile()) {
    throw new Error('Workspace path is not a regular file')
  }

  return canonicalTarget
}

function parseDirectoryEntry(value: unknown): FsReadDirectoryEntry | null {
  if (!isRecord(value)) throw new Error('Invalid directory entry from app-server')
  const { fileName, isDirectory, isFile } = value
  if (
    typeof fileName !== 'string' ||
    fileName.length < 1 ||
    fileName.length > MAX_ENTRY_NAME_LENGTH ||
    fileName === '.' ||
    fileName === '..' ||
    fileName.includes('/') ||
    fileName.includes('\0') ||
    typeof isDirectory !== 'boolean' ||
    typeof isFile !== 'boolean' ||
    (isDirectory && isFile)
  ) {
    throw new Error('Invalid directory entry from app-server')
  }

  // Sockets, devices, and other special files are not useful in a source tree.
  return isDirectory || isFile ? { fileName, isDirectory, isFile } : null
}

function compareDirectoryEntries(left: FsReadDirectoryEntry, right: FsReadDirectoryEntry): number {
  if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1
  return left.fileName.localeCompare(right.fileName, undefined, {
    numeric: true,
    sensitivity: 'base'
  })
}

export async function readWorkspaceDirectory(
  client: WorkspaceRpcClient,
  request: WorkspacePathRequest
): Promise<WorkspaceDirectoryResult> {
  const canonicalPath = await canonicalWorkspaceTarget(request, 'directory')
  const response = await client.request('fs/readDirectory', { path: canonicalPath })
  if (!isRecord(response) || !Array.isArray(response.entries)) {
    throw new Error('Invalid directory response from app-server')
  }

  const parsed = response.entries
    .map(parseDirectoryEntry)
    .filter((entry): entry is FsReadDirectoryEntry => entry !== null)
    .sort(compareDirectoryEntries)
  const truncated = parsed.length > MAX_WORKSPACE_DIRECTORY_ENTRIES
  const entries: WorkspaceDirectoryEntry[] = parsed
    .slice(0, MAX_WORKSPACE_DIRECTORY_ENTRIES)
    .map((entry) => ({
      ...entry,
      path: join(request.path, entry.fileName)
    }))

  return { path: request.path, entries, truncated }
}

function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return false
  }

  let controlCharacters = 0
  for (const byte of bytes) {
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13) {
      controlCharacters += 1
    }
  }
  return bytes.length === 0 || controlCharacters / bytes.length < 0.08
}

function imageMimeType(bytes: Uint8Array): SupportedImageMimeType | null {
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

function classifyFile(path: string, bytes: Uint8Array): FileClassification {
  const imageMime = imageMimeType(bytes)
  if (imageMime) {
    return { kind: 'image', mimeType: imageMime, maximumBytes: MAX_WORKSPACE_IMAGE_BYTES }
  }
  if (!looksLikeText(bytes)) throw new Error('Binary files cannot be previewed')
  return {
    kind: 'text',
    mimeType: TEXT_MIME_TYPES[extname(path).toLowerCase()] ?? 'text/plain',
    maximumBytes: MAX_WORKSPACE_FILE_BYTES
  }
}

async function inspectPreviewFile(path: string): Promise<FileClassification> {
  const metadata = await stat(path)

  const handle = await open(path, 'r')
  try {
    const sample = Buffer.alloc(Math.min(metadata.size, BINARY_SAMPLE_BYTES))
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0)
    const classification = classifyFile(path, sample.subarray(0, bytesRead))
    if (metadata.size > classification.maximumBytes) {
      throw new Error('File is too large to preview')
    }
    return classification
  } finally {
    await handle.close()
  }
}

function decodeAppServerFile(response: unknown, maximumBytes: number): Buffer {
  if (!isRecord(response) || typeof response.dataBase64 !== 'string') {
    throw new Error('Invalid file response from app-server')
  }
  const value = response.dataBase64
  const maximumEncodedLength = Math.ceil(maximumBytes / 3) * 4
  if (
    value.length > maximumEncodedLength ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error('Invalid or oversized file response from app-server')
  }

  const bytes = Buffer.from(value, 'base64')
  if (bytes.byteLength > maximumBytes) {
    throw new Error('File is too large to preview')
  }
  return bytes
}

export async function readWorkspaceFile(
  client: WorkspaceRpcClient,
  request: WorkspacePathRequest
): Promise<WorkspaceFileResult> {
  const canonicalPath = await canonicalWorkspaceTarget(request, 'file')
  const expectedClassification = await inspectPreviewFile(canonicalPath)

  const response = await client.request('fs/readFile', { path: canonicalPath })
  const bytes = decodeAppServerFile(response, expectedClassification.maximumBytes)
  const classification = classifyFile(canonicalPath, bytes)
  if (
    classification.kind !== expectedClassification.kind ||
    classification.mimeType !== expectedClassification.mimeType
  ) {
    throw new Error('File changed while the preview was loading')
  }

  if (classification.kind === 'image') {
    return {
      path: request.path,
      kind: 'image',
      mimeType: classification.mimeType,
      dataBase64: bytes.toString('base64'),
      sizeBytes: bytes.byteLength
    }
  }

  return {
    path: request.path,
    kind: 'text',
    mimeType: classification.mimeType,
    text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    sizeBytes: bytes.byteLength
  }
}

export function isWorkspaceFileSaveRequest(value: unknown): value is WorkspaceFileSaveRequest {
  if (!isRecord(value) || !isAllowedWorkspacePathRequest({ root: value.root, path: value.path })) return false
  return Object.keys(value).every((key) => ['root', 'path', 'text', 'expectedText'].includes(key)) &&
    typeof value.text === 'string' && typeof value.expectedText === 'string' &&
    Buffer.byteLength(value.text, 'utf8') <= MAX_WORKSPACE_FILE_BYTES &&
    Buffer.byteLength(value.expectedText, 'utf8') <= MAX_WORKSPACE_FILE_BYTES &&
    !value.text.includes('\0') && !value.expectedText.includes('\0')
}

/** The installed desktop's workspaceFiles.saveText service checks the disk base before saving. */
export async function saveWorkspaceFile(request: WorkspaceFileSaveRequest): Promise<WorkspaceFileSaveResult> {
  if (!isWorkspaceFileSaveRequest(request)) throw new Error('Invalid workspace save request')
  const pathRequest = { root: request.root, path: request.path }
  const path = await canonicalWorkspaceTarget(pathRequest, 'file')
  const handle = await open(path, constants.O_RDWR | constants.O_NOFOLLOW)
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile() || metadata.size > MAX_WORKSPACE_FILE_BYTES) throw new Error('File is too large to edit')
    const bytes = await handle.readFile()
    const classification = classifyFile(path, bytes)
    if (classification.kind !== 'text') throw new Error('Only text files can be edited')
    const diskText = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const file = (text: string) => ({ path: request.path, kind: 'text' as const, mimeType: classification.mimeType, text, sizeBytes: Buffer.byteLength(text, 'utf8') })
    if (diskText !== request.expectedText) return { outcome: 'conflict', file: file(diskText) }
    // Revalidate the name and inode immediately before changing the opened file.
    const currentPath = await canonicalWorkspaceTarget(pathRequest, 'file')
    const current = await stat(currentPath)
    if (currentPath !== path || current.ino !== metadata.ino || current.dev !== metadata.dev || current.mtimeMs !== metadata.mtimeMs || current.size !== metadata.size) {
      throw new Error('File changed while saving; reload and try again')
    }
    const content = Buffer.from(request.text, 'utf8')
    let offset = 0
    while (offset < content.length) {
      const { bytesWritten } = await handle.write(content, offset, content.length - offset, offset)
      if (bytesWritten === 0) throw new Error('Could not write file')
      offset += bytesWritten
    }
    await handle.truncate(content.length)
    await handle.sync()
    return { outcome: 'saved', file: file(request.text) }
  } finally {
    await handle.close()
  }
}
