import type { CodexDesktopApi, WorkspaceFilesChanged, WorkspaceWatchRequest } from '../../shared/api'

type WatchApi = Pick<CodexDesktopApi, 'watchWorkspacePaths' | 'unwatchWorkspacePaths' | 'onWorkspaceFilesChanged'>

/**
 * Subscribe before native startup. Once its id is known, replay buffered events,
 * then start the baseline refresh so its reads supersede the startup event reads.
 * Cancellation also disposes a late returned id and suppresses the ready callback.
 */
export function subscribeWorkspaceChanges(api: WatchApi, request: WorkspaceWatchRequest,
  changed: (event: WorkspaceFilesChanged) => void, failed: (error: unknown) => void,
  ready?: () => void): () => void {
  let id: string | null = null
  let closed = false
  const early: WorkspaceFilesChanged[] = []
  // Consumer failures are ordinary callback errors, not native startup failures.
  const deliver = (callback: () => void): void => {
    try { callback() }
    catch (error) {
      if (typeof globalThis.reportError === 'function') globalThis.reportError(error)
      else queueMicrotask(() => { throw error })
    }
  }
  const remove = api.onWorkspaceFilesChanged((event) => {
    if (closed || event.root !== request.root) return
    if (id === null) { if (early.length < 16) early.push(event); return }
    if (event.id === id) deliver(() => changed(event))
  })
  void api.watchWorkspacePaths(request.root, request.directories, request.files).then((value) => {
    if (closed) { void api.unwatchWorkspacePaths(value).catch(() => {}); return }
    id = value
    for (const event of early) if (!closed && event.id === id) deliver(() => changed(event))
    early.length = 0
    if (!closed && ready) deliver(ready)
  }, (error) => {
    if (!closed) { closed = true; remove(); early.length = 0; deliver(() => failed(error)) }
  })
  return () => { closed = true; remove(); early.length = 0; if (id) void api.unwatchWorkspacePaths(id).catch(() => {}) }
}
