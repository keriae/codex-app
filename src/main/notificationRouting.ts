import { randomUUID } from 'node:crypto'
import type { OpenThreadRequest } from '../shared/api'

/** Only a server event's explicit thread selector can become a desktop route. */
export function threadIdForDesktopEvent(params: unknown): string | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null
  const value = params as Record<string, unknown>
  const threadId = value.threadId ?? value.thread_id ?? value.conversationId
  return typeof threadId === 'string' && threadId.length > 0 && threadId.length <= 512 &&
    !/[\u0000-\u001f\u007f]/.test(threadId) ? threadId : null
}

/** Keep notification clicks until the renderer explicitly accepts their route. */
export class NotificationThreadRouter {
  private readonly pending: OpenThreadRequest[] = []
  private receiver: ((request: OpenThreadRequest) => void) | null = null

  open(threadId: string): void {
    const request = { id: randomUUID(), threadId }
    // Native notifications can accumulate while the window is hidden. Bound
    // the queue; preserve the latest selection and its requested destination.
    if (this.pending.length === 64) this.pending.shift()
    this.pending.push(request)
    this.receiver?.(request)
  }

  setReceiver(receiver: ((request: OpenThreadRequest) => void) | null): void {
    this.receiver = receiver
    this.replay()
  }

  replay(): void {
    const receiver = this.receiver
    if (!receiver) return
    for (const request of [...this.pending]) {
      if (this.receiver !== receiver) break
      receiver(request)
    }
  }

  acknowledge(id: unknown): void {
    if (typeof id !== 'string') throw new Error('Invalid notification route identifier')
    const index = this.pending.findIndex((request) => request.id === id)
    if (index === -1) throw new Error('Unknown or expired notification route')
    this.pending.splice(index, 1)
  }
}
