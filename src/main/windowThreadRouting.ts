import { randomUUID } from 'node:crypto'
import type { HostId, OpenThreadRequest } from '../shared/api'

const MAX_PENDING_ROUTES_PER_WINDOW = 64

export interface ManagedRendererWindow<Contents> {
  webContents: Contents
  isDestroyed(): boolean
}

export function managedWindowForSender<Contents, Window extends ManagedRendererWindow<Contents>>(
  windows: ReadonlySet<Window>,
  sender: Contents,
  fromWebContents: (sender: Contents) => Window | null
): Window | null {
  const window = fromWebContents(sender)
  return window && windows.has(window) && !window.isDestroyed() && window.webContents === sender
    ? window
    : null
}

export function isDesktopThreadId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 &&
    !/[\u0000-\u001f\u007f]/.test(value)
}

export function isWindowRouteId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(value)
}

/**
 * Routes an explicit chat selection to one desktop window. Routes survive the
 * renderer becoming ready, navigation/reload, and backend startup until that
 * same window acknowledges them.
 */
export class WindowThreadRouter<Window extends object> {
  private readonly pending = new Map<Window, OpenThreadRequest[]>()
  private readonly receivers = new Map<Window, (request: OpenThreadRequest) => void>()

  constructor(private readonly requestId: () => string = randomUUID) {}

  open(window: Window, threadId: unknown, hostId: HostId = 'local'): OpenThreadRequest {
    if (!isDesktopThreadId(threadId)) throw new Error('Invalid thread identifier')
    const queue = this.pending.get(window) ?? []
    let id = ''
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = this.requestId()
      if (!isWindowRouteId(candidate)) throw new Error('Invalid generated window route identifier')
      if (!queue.some((request) => request.id === candidate)) {
        id = candidate
        break
      }
    }
    if (!id) throw new Error('Could not allocate a unique window route identifier')
    const request: OpenThreadRequest = {
      id,
      threadId,
      ...(hostId === 'local' ? {} : {hostId})
    }
    if (queue.length === MAX_PENDING_ROUTES_PER_WINDOW) queue.shift()
    queue.push(request)
    this.pending.set(window, queue)
    this.receivers.get(window)?.(request)
    return request
  }

  setReceiver(window: Window, receiver: ((request: OpenThreadRequest) => void) | null): void {
    if (receiver === null) {
      this.receivers.delete(window)
      return
    }
    this.receivers.set(window, receiver)
    for (const request of [...(this.pending.get(window) ?? [])]) {
      if (this.receivers.get(window) !== receiver) break
      receiver(request)
    }
  }

  acknowledge(window: Window, id: unknown): boolean {
    if (!isWindowRouteId(id)) throw new Error('Invalid window route identifier')
    const queue = this.pending.get(window)
    const index = queue?.findIndex((request) => request.id === id) ?? -1
    if (!queue || index === -1) return false
    queue.splice(index, 1)
    if (queue.length === 0) this.pending.delete(window)
    return true
  }

  forget(window: Window): void {
    this.receivers.delete(window)
    this.pending.delete(window)
  }
}
