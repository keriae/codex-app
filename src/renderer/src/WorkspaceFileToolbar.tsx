import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

// File controls span the viewer and navigator. Keep their containing block
// outside the editor's clipped source viewport, as in fileSource.Yt.
export function WorkspaceFileToolbar({ target, children, className = '' }: { target?: HTMLElement | null; children: ReactNode; className?: string }): ReactNode {
  const toolbar = <header className={`workspace-code-toolbar${className ? ` ${className}` : ''}`}>{children}</header>
  return target ? createPortal(toolbar, target) : toolbar
}
