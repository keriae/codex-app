import type { ReactNode } from 'react'
import type { WorkspaceOpenTarget } from '../../shared/api'
import terminal from './assets/workspaceOpenTargets/terminal.png'
import finder from './assets/workspaceOpenTargets/finder.png'
import vscode from './assets/workspaceOpenTargets/vscode.png'
import cursor from './assets/workspaceOpenTargets/cursor.png'
import zed from './assets/workspaceOpenTargets/zed.png'
import windsurf from './assets/workspaceOpenTargets/windsurf.png'

const fallback = { terminal, finder, vscode, cursor, zed, windsurf }

/** Match openIn.loadTargetIcon by displaying the installed macOS app's icon. */
export function WorkspaceOpenTargetIcon({ target }: { target: WorkspaceOpenTarget }): ReactNode {
  const icon = target.iconDataUrl?.startsWith('data:image/png;base64,') ? target.iconDataUrl : undefined
  return <span className="workspace-open-target-icon" aria-hidden="true">
    <img src={icon || fallback[target.id]} alt="" draggable={false} />
  </span>
}
