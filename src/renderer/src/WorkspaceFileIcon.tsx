import type { ReactNode } from 'react'
import recovered from './assets/workspaceFileIcons.json'
import './assets/workspaceFileIcons.css'

const fileNames: Record<string, string> = recovered.fileNames
const extensions: Record<string, string> = recovered.extensions
const completeExtensions: Record<string, string> = recovered.completeExtensions
const symbols: Record<string, { viewBox: string; body: string }> = recovered.symbols

/** Preserve shipped filename precedence and compound suffixes such as mdx.tsx. */
export function workspaceFileIconToken(path: string): string {
  const name = path.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() || ''
  if (Object.hasOwn(fileNames, name)) return fileNames[name]
  const segments = name.split('.')
  for (let index = 1; index < segments.length; index += 1) {
    const suffix = segments.slice(index).join('.')
    if (Object.hasOwn(completeExtensions, suffix)) return completeExtensions[suffix]
    if (Object.hasOwn(extensions, suffix)) return extensions[suffix]
  }
  return 'default'
}

/** These are inert SVG literals recovered from the original Pierre icon sprite. */
export function WorkspaceFileIcon({ path, className = '' }: { path: string; className?: string }): ReactNode {
  const token = workspaceFileIconToken(path)
  const symbol = symbols[token] || symbols.default
  return <svg className={`workspace-file-kind workspace-file-icon ${className}`.trim()} viewBox={symbol.viewBox}
    aria-hidden="true" focusable="false" fill="none" stroke="none" data-workspace-file-icon={token}
    style={{ color: `var(--workspace-file-icon-${token}, var(--text-muted))` }}
    dangerouslySetInnerHTML={{ __html: symbol.body }} />
}
