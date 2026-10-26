import { useEffect, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { WorkspaceLayoutMode } from './workspaceLayout'

/** Keep the unified titlebar aligned with the actual workspace, including window zoom/resizes. */
export function WorkspaceTitlebar({ target, pane, layoutMode, children }: {
  target: HTMLElement
  pane: RefObject<HTMLElement | null>
  layoutMode: WorkspaceLayoutMode
  children: ReactNode
}): ReactNode {
  useEffect(() => {
    const surface = pane.current
    const titlebar = target.closest<HTMLElement>('.window-titlebar')
    if (!surface || !titlebar) return
    const measure = (): void => {
      titlebar.style.setProperty('--workspace-titlebar-width', `${surface.getBoundingClientRect().width}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(surface)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      titlebar.style.removeProperty('--workspace-titlebar-width')
    }
  }, [target, pane, layoutMode])
  return createPortal(<div className="workspace-titlebar-chrome" data-workspace-layout={layoutMode}>{children}</div>, target)
}
