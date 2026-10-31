import { resolveWorkspacePath } from './workspacePathModel'

export const OPEN_WORKSPACE_FILE_EVENT = 'codex:open-workspace-file'
export const OPEN_WORKSPACE_SOURCE_IMAGE_EVENT = 'codex:open-workspace-source-image'

export function dispatchWorkspaceSourceImage(
  path: string,
  target: EventTarget = window
): boolean {
  return target.dispatchEvent(
    new CustomEvent<string>(OPEN_WORKSPACE_SOURCE_IMAGE_EVENT, { detail: path })
  )
}

export interface WorkspaceFileLink {
  path: string
  line: number | null
  column?: number
  endLine?: number
  endColumn?: number
}

export function dispatchWorkspaceFileLink(
  link: WorkspaceFileLink,
  target: EventTarget = window
): boolean {
  return target.dispatchEvent(
    new CustomEvent<WorkspaceFileLink>(OPEN_WORKSPACE_FILE_EVENT, { detail: link })
  )
}

const FILE_URL_PATTERN = /^file:/i
const EXTERNAL_URL_PATTERN = /^[a-z][a-z\d+.-]*:\/\//i
const NON_FILE_PROTOCOL_PATTERN = /^(?:data|ftp|https?|javascript|mailto|sms|tel):/i
const HASH_LOCATION_PATTERN = /^L(\d+)(?:C(\d+))?(?:[-–]L(\d+)(?:C(\d+))?)?$/i
const NAMED_LINE_FRAGMENT_PATTERN = /^line[-=:]?(\d+)$/i
const LABEL_LOCATION_PATTERN = /\((?:line\s+(\d+)|lines\s+(\d+)\s*[-–]\s*(\d+))\)\s*$/i
const PATH_LOCATION_PATTERN = /^(.*?):(\d+)(?::(\d+))?(?:[-–](\d+)(?::(\d+))?)?$/
const WORKSPACE_CITATION_PATTERN = /【([^【】\n]+?)†L(\d+)(?:C(\d+))?(?:[-–]L(\d+)(?:C(\d+))?)?】/gi

export interface WorkspaceCitationMatch {
  end: number
  href: string
  label: string
  link: WorkspaceFileLink
  start: number
}

interface WorkspaceFileLocation {
  line: number
  column?: number
  endLine?: number
  endColumn?: number
}

function positiveLine(value: string | undefined): number | null {
  if (!value) return null
  const line = Number(value)
  return Number.isSafeInteger(line) && line > 0 ? line : null
}

function locationFromValues(
  lineValue: string | undefined,
  columnValue?: string,
  endLineValue?: string,
  endColumnValue?: string
): WorkspaceFileLocation | null {
  const line = positiveLine(lineValue)
  if (line === null) return null
  const column = positiveLine(columnValue) ?? undefined
  const endLine = positiveLine(endLineValue) ?? undefined
  const endColumn = positiveLine(endColumnValue) ?? undefined
  return {
    line,
    ...(column ? { column } : {}),
    ...(endLine ? { endLine } : {}),
    ...(endColumn ? { endColumn } : {})
  }
}

function stripReferenceFormatting(value: string): string {
  return value.trim().replace(/^`+|`+$/g, '').trim()
}

function decodedPath(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value)
    return /[\0\r\n]/.test(decoded) ? null : decoded
  } catch {
    return null
  }
}

function fileUrlParts(href: string): { path: string; fragment: string } | null {
  try {
    const url = new URL(href)
    if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost')) return null
    const path = decodedPath(url.pathname)
    if (!path) return null
    return { path, fragment: url.hash.slice(1) }
  } catch {
    return null
  }
}

export function parseWorkspaceFileLink(
  href: string | undefined,
  label = ''
): WorkspaceFileLink | null {
  const rawHref = href?.trim()
  if (!rawHref || rawHref.startsWith('#')) return null

  let path = ''
  let fragment = ''
  if (FILE_URL_PATTERN.test(rawHref)) {
    const parts = fileUrlParts(rawHref)
    if (!parts) return null
    path = parts.path
    fragment = parts.fragment
  } else {
    if (
      rawHref.startsWith('//') ||
      EXTERNAL_URL_PATTERN.test(rawHref) ||
      NON_FILE_PROTOCOL_PATTERN.test(rawHref)
    ) {
      return null
    }

    const hashIndex = rawHref.indexOf('#')
    const pathAndQuery = hashIndex >= 0 ? rawHref.slice(0, hashIndex) : rawHref
    fragment = hashIndex >= 0 ? rawHref.slice(hashIndex + 1) : ''
    const queryIndex = pathAndQuery.indexOf('?')
    const encodedPath = queryIndex >= 0 ? pathAndQuery.slice(0, queryIndex) : pathAndQuery
    const decoded = decodedPath(encodedPath)
    if (!decoded) return null
    path = decoded
  }

  path = stripReferenceFormatting(path)
  const hashLocation = fragment.match(HASH_LOCATION_PATTERN)
  const namedLineFragment = fragment.match(NAMED_LINE_FRAGMENT_PATTERN)
  const labelLocation = label.match(LABEL_LOCATION_PATTERN)
  let location: WorkspaceFileLocation | null = null
  if (hashLocation) {
    location = locationFromValues(
      hashLocation[1],
      hashLocation[2],
      hashLocation[3],
      hashLocation[4]
    )
  } else if (namedLineFragment) {
    location = locationFromValues(namedLineFragment[1])
  } else if (labelLocation) {
    location = locationFromValues(
      labelLocation[1] || labelLocation[2],
      undefined,
      labelLocation[3]
    )
  }

  if (location === null) {
    const pathLocation = path.match(PATH_LOCATION_PATTERN)
    if (pathLocation?.[1]) {
      const parsedLocation = locationFromValues(
        pathLocation[2],
        pathLocation[3],
        pathLocation[4],
        pathLocation[5]
      )
      if (parsedLocation) {
        path = stripReferenceFormatting(pathLocation[1])
        location = parsedLocation
      }
    }
  }

  path = path.trim()
  if (!path || path.endsWith('/')) return null

  // A remaining leading protocol is not a local path. Keep filename:line links
  // working by running this check after the optional line suffix is removed.
  if (/^[a-z][a-z\d+.-]*:/i.test(path)) return null

  return {
    path,
    line: location?.line ?? null,
    ...(location?.column ? { column: location.column } : {}),
    ...(location?.endLine ? { endLine: location.endLine } : {}),
    ...(location?.endColumn ? { endColumn: location.endColumn } : {})
  }
}

export function workspaceFileLocationLabel(link: WorkspaceFileLink): string {
  if (link.line === null) return ''
  if (link.endLine && link.endLine !== link.line) return `(lines ${link.line}–${link.endLine})`
  return `(line ${link.line})`
}

export function workspaceFileLabelHasLocation(label: string): boolean {
  return (
    LABEL_LOCATION_PATTERN.test(label) ||
    /#L\d+(?:C\d+)?/i.test(label) ||
    /:\d+(?::\d+)?(?:[-–]\d+(?::\d+)?)?\s*$/.test(label)
  )
}

export function workspaceCitationMatches(text: string): WorkspaceCitationMatch[] {
  const matches: WorkspaceCitationMatch[] = []
  WORKSPACE_CITATION_PATTERN.lastIndex = 0
  for (
    let match = WORKSPACE_CITATION_PATTERN.exec(text);
    match;
    match = WORKSPACE_CITATION_PATTERN.exec(text)
  ) {
    const path = stripReferenceFormatting(match[1])
    if (!path) continue
    const startColumn = match[3] ? `C${match[3]}` : ''
    const endLocation = match[4] ? `-L${match[4]}${match[5] ? `C${match[5]}` : ''}` : ''
    const href = `${path}#L${match[2]}${startColumn}${endLocation}`
    const link = parseWorkspaceFileLink(href)
    if (!link) continue
    const location = workspaceFileLocationLabel(link)
    const name = path.slice(path.lastIndexOf('/') + 1) || path
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      href,
      label: location ? `${name} ${location}` : name,
      link
    })
  }
  WORKSPACE_CITATION_PATTERN.lastIndex = 0
  return matches
}

export function resolveWorkspaceFileLink(root: string, linkedPath: string): string | null {
  return resolveWorkspacePath(root, linkedPath)
}

export function workspaceFileTypeLabel(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  const labels: Record<string, string> = {
    css: 'CSS',
    go: 'GO',
    html: 'HT',
    js: 'JS',
    jsx: 'JS',
    json: '{}',
    md: 'MD',
    mjs: 'JS',
    py: 'PY',
    rs: 'RS',
    sh: 'SH',
    ts: 'TS',
    tsx: 'TS',
    yaml: 'YA',
    yml: 'YA'
  }
  return labels[extension] || extension.slice(0, 2).toUpperCase() || '<>'
}
