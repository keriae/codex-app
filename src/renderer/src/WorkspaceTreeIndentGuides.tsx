import type { ReactNode } from 'react'
import './WorkspaceTreeIndentGuides.css'

/** Pierre's spacing columns stay aligned with the 16px icon centers. */
export function WorkspaceTreeIndentGuides({ depth }: { depth: number }): ReactNode {
  const levels = Math.max(0, depth)
  if (!levels) return null
  return <span className="workspace-tree-indent-guides" aria-hidden="true" data-workspace-tree-indent-depth={levels}>
    {Array.from({ length: levels }, (_, index) => <span key={index} style={{ left: 10.25 + index * 8.75 }} />)}
  </span>
}
