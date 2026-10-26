import type {
  JsonMap,
  RpcNotification,
  RpcServerRequest
} from '../shared/api'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function rpcThreadId(value: unknown): string | null {
  const payload = record(value)
  if (!payload) return null
  if (typeof payload.threadId === 'string') return payload.threadId
  if (typeof payload.conversationId === 'string') return payload.conversationId
  const thread = record(payload.thread)
  return typeof thread?.id === 'string' ? thread.id : null
}

/**
 * Tracks private renderer-created threads so their events never escape into
 * global desktop affordances such as approval dialogs or native notifications.
 * IDs intentionally remain tracked for the lifetime of the app-server
 * connection: a late request from a discarded ephemeral thread must still be
 * rejected instead of being mistaken for a main-chat request.
 */
export class EphemeralThreadTracker {
  private readonly threadIds = new Set<string>()

  reset(): void {
    this.threadIds.clear()
  }

  remember(threadId: string): void {
    if (threadId) this.threadIds.add(threadId)
  }

  rememberRendererResult(method: string, params: JsonMap | undefined, result: unknown): void {
    if (
      (method !== 'thread/fork' && method !== 'thread/start') ||
      params?.ephemeral !== true
    ) {
      return
    }
    const threadId = rpcThreadId(result)
    if (threadId) this.remember(threadId)
  }

  rememberNotification(notification: RpcNotification): void {
    if (notification.method !== 'thread/started') return
    const params = record(notification.params)
    const thread = record(params?.thread)
    if (thread?.ephemeral !== true || typeof thread.id !== 'string') return
    this.remember(thread.id)
  }

  hasThread(threadId: string | null): boolean {
    return Boolean(threadId && this.threadIds.has(threadId))
  }

  ownsEvent(value: unknown): boolean {
    return this.hasThread(rpcThreadId(value))
  }

  ownsRequest(request: RpcServerRequest): boolean {
    return this.ownsEvent(request.params)
  }
}

export interface RendererServerRequestRoute {
  request: RpcServerRequest
  showBackgroundNotification: boolean
}

/**
 * Preserve ephemeral requests for the renderer while marking their private
 * thread ownership. The renderer owns Side Chat lifecycle state and is the
 * only layer that can distinguish an active pane from a discarded one.
 */
export function routeServerRequestToRenderer(
  tracker: EphemeralThreadTracker,
  request: RpcServerRequest
): RendererServerRequestRoute {
  const { desktopContext: _untrustedDesktopContext, ...protocolRequest } = request
  if (!tracker.ownsRequest(request)) {
    return { request: protocolRequest, showBackgroundNotification: true }
  }
  return {
    request: {
      ...protocolRequest,
      desktopContext: { ephemeralThread: true }
    },
    showBackgroundNotification: false
  }
}
