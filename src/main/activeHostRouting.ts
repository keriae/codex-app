import type { ActiveHostInvalidated, HostId } from '../shared/api'

/** Per-window execution-host ownership with an atomic multi-window invalidation path. */
export class ActiveHostRouting<Window extends object> {
  private readonly hostByWindow = new WeakMap<Window, HostId>()

  get(window: Window): HostId {
    return this.hostByWindow.get(window) ?? 'local'
  }

  set(window: Window, hostId: HostId): void {
    this.hostByWindow.set(window, hostId)
  }

  invalidate(
    hostId: string,
    windows: Iterable<Window>,
    reason: ActiveHostInvalidated['reason'],
    notify: (window: Window, event: ActiveHostInvalidated) => void
  ): number {
    let count = 0
    for (const window of windows) {
      if (this.get(window) !== hostId) continue
      this.set(window, 'local')
      notify(window, { hostId, reason })
      count += 1
    }
    return count
  }
}
