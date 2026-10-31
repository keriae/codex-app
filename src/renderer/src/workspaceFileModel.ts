import { normalizeAbsoluteWorkspacePath, resolveWorkspacePath } from './workspacePathModel'

export type WorkspaceCodeTokenKind = 'plain' | 'keyword' | 'string' | 'number' | 'comment'

export interface WorkspaceCodeToken {
  text: string
  kind: WorkspaceCodeTokenKind
}

const CODE_KEYWORDS = new Set([
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'def',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'of',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'struct',
  'super',
  'switch',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield'
])

const TOKEN_PATTERN = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/.*$|\#[^\n]*$|\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)\b|\b[A-Za-z_$][\w$]*\b)/g

export function workspacePathName(path: string): string {
  const normalized = path.replace(/\/+$/, '')
  return normalized.slice(normalized.lastIndexOf('/') + 1) || normalized || '/'
}

export function workspaceRelativePath(root: string, path: string): string {
  const normalizedRoot = normalizeAbsoluteWorkspacePath(root)
  const resolvedPath = resolveWorkspacePath(root, path)
  if (!normalizedRoot || !resolvedPath) return path
  if (resolvedPath === normalizedRoot) return ''
  const prefix = normalizedRoot === '/' ? '/' : `${normalizedRoot}/`
  return resolvedPath.slice(prefix.length)
}

export function workspaceBreadcrumbs(root: string, path: string): string[] {
  const relativePath = workspaceRelativePath(root, path)
  return [workspacePathName(root), ...relativePath.split('/').filter(Boolean)]
}

export function languageForWorkspaceFile(path: string, mimeType?: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (extension === path.toLowerCase()) return mimeType === 'application/json' ? 'json' : 'text'
  const aliases: Record<string, string> = {
    cjs: 'javascript',
    htm: 'html',
    js: 'javascript',
    jsx: 'javascript',
    md: 'markdown',
    mjs: 'javascript',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    sh: 'shell',
    ts: 'typescript',
    tsx: 'typescript',
    yml: 'yaml'
  }
  return aliases[extension] ?? (extension || 'text')
}

export function tokenizeWorkspaceCodeLine(line: string): WorkspaceCodeToken[] {
  const tokens: WorkspaceCodeToken[] = []
  let cursor = 0
  for (const match of line.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) tokens.push({ text: line.slice(cursor, index), kind: 'plain' })
    const text = match[0]
    let kind: WorkspaceCodeTokenKind = 'plain'
    if (text.startsWith('//') || text.startsWith('#')) kind = 'comment'
    else if (text.startsWith('"') || text.startsWith("'") || text.startsWith('`')) kind = 'string'
    else if (/^(?:0x|\d)/i.test(text)) kind = 'number'
    else if (CODE_KEYWORDS.has(text)) kind = 'keyword'
    tokens.push({ text, kind })
    cursor = index + text.length
  }
  if (cursor < line.length) tokens.push({ text: line.slice(cursor), kind: 'plain' })
  return tokens.length > 0 ? tokens : [{ text: line || ' ', kind: 'plain' }]
}

export function workspaceErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
}
