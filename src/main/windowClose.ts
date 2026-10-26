import { randomUUID } from 'node:crypto'
import type { WindowCloseOrigin, WindowCloseRequest, WindowCloseResponse } from '../shared/api'

export interface ClosableWindow {
  isDestroyed(): boolean
  close(): void
}

export function isWindowCloseOrigin(value: unknown): value is WindowCloseOrigin {
  return value === 'shortcut' || value === 'window'
}

export function isWindowCloseResponse(value: unknown): value is WindowCloseResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const response = value as Record<string, unknown>
  return Object.keys(response).every((key) => key === 'confirmed' || key === 'doNotAskAgain') &&
    typeof response.confirmed === 'boolean' &&
    (response.doNotAskAgain === undefined || typeof response.doNotAskAgain === 'boolean')
}

/** Mirror the target's synchronous shortcut marker and one in-flight confirmation. */
export class WindowCloseController<T extends ClosableWindow> {
  private readonly keyboardRequests = new WeakSet<T>()
  private readonly approved = new WeakSet<T>()
  private readonly pending = new WeakSet<T>()

  constructor(
    private readonly getPolicy: () => 'shortcut' | 'always' | 'never',
    private readonly confirm: (window: T, origin: WindowCloseOrigin) => Promise<WindowCloseResponse>,
    private readonly disableConfirmation: () => void | Promise<void>
  ) {}

  requestClose(window: T, origin: WindowCloseOrigin): void {
    if (window.isDestroyed()) return
    if (origin === 'shortcut') this.keyboardRequests.add(window)
    try { window.close() } finally { this.keyboardRequests.delete(window) }
  }

  shouldPreventClose(window: T): boolean {
    if (this.approved.has(window)) return false
    if (this.pending.has(window)) return true
    const policy = this.getPolicy()
    const keyboard = this.keyboardRequests.has(window)
    if (policy === 'never' || policy === 'shortcut' && !keyboard) return false
    this.pending.add(window)
    void this.confirmAndClose(window, keyboard ? 'shortcut' : 'window')
    return true
  }

  private async confirmAndClose(window: T, origin: WindowCloseOrigin): Promise<void> {
    try {
      const response = await this.confirm(window, origin)
      if (!response.confirmed || window.isDestroyed()) return
      if (response.doNotAskAgain) await this.disableConfirmation()
      if (window.isDestroyed()) return
      this.approved.add(window)
      window.close()
    } catch { /* A missing/replaced renderer or failed persistence cancels close. */ }
    finally {
      this.approved.delete(window)
      this.pending.delete(window)
    }
  }
}

/** Renderer-backed modal requests cancel if the receiving document disappears. */
export class WindowCloseBroker<T extends object> {
  private readonly ready = new WeakSet<T>()
  private readonly pending = new WeakMap<T, {
    id: string
    resolve: (response: WindowCloseResponse) => void
  }>()

  setReady(window: T, ready: boolean): void {
    if (ready) this.ready.add(window)
    else {
      this.ready.delete(window)
      this.pending.get(window)?.resolve({ confirmed: false })
      this.pending.delete(window)
    }
  }

  confirm(window: T, origin: WindowCloseOrigin, send: (request: WindowCloseRequest) => void): Promise<WindowCloseResponse> {
    if (!this.ready.has(window) || this.pending.has(window)) return Promise.resolve({ confirmed: false })
    return new Promise((resolve) => {
      const id = randomUUID()
      this.pending.set(window, { id, resolve })
      try { send({ id, origin }) } catch {
        this.pending.delete(window)
        resolve({ confirmed: false })
      }
    })
  }

  respond(window: T, id: unknown, response: unknown): void {
    const pending = this.pending.get(window)
    if (typeof id !== 'string' || !pending || id !== pending.id || !isWindowCloseResponse(response)) {
      throw new Error('Invalid or expired window close response')
    }
    this.pending.delete(window)
    pending.resolve(response)
  }
}
