import { isAllowedAuthenticationUrl } from './ipcSecurity'

const DEFAULT_AUTH_URL_TTL_MS = 10 * 60 * 1000
const DEFAULT_MAX_PENDING_AUTH_URLS = 8

export interface LoginStartResult {
  loginId: string
  authUrl: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeLoginStartResult(value: unknown): LoginStartResult {
  if (!isRecord(value)) throw new Error('The app-server returned an invalid login response')
  if (
    typeof value.loginId !== 'string' ||
    value.loginId.length < 1 ||
    value.loginId.length > 1_024 ||
    typeof value.authUrl !== 'string' ||
    !isAllowedAuthenticationUrl(value.authUrl)
  ) {
    throw new Error('The app-server returned an invalid login response')
  }
  return { loginId: value.loginId, authUrl: value.authUrl }
}

/**
 * Keeps authentication navigation tied to a recent app-server login response.
 * URLs are memory-only, one-shot, bounded, and never logged or persisted.
 */
export class AuthenticationUrlBroker {
  private readonly pending = new Map<string, number>()

  constructor(
    private readonly ttlMs = DEFAULT_AUTH_URL_TTL_MS,
    private readonly maxPending = DEFAULT_MAX_PENDING_AUTH_URLS,
    private readonly now: () => number = Date.now
  ) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new TypeError('ttlMs must be positive')
    if (!Number.isSafeInteger(maxPending) || maxPending <= 0) {
      throw new TypeError('maxPending must be positive')
    }
  }

  remember(value: unknown): LoginStartResult {
    const result = normalizeLoginStartResult(value)
    this.prune()
    this.pending.delete(result.authUrl)
    this.pending.set(result.authUrl, this.now() + this.ttlMs)
    while (this.pending.size > this.maxPending) {
      const oldest = this.pending.keys().next().value as string | undefined
      if (!oldest) break
      this.pending.delete(oldest)
    }
    return result
  }

  consume(value: unknown): value is string {
    if (typeof value !== 'string' || !isAllowedAuthenticationUrl(value)) return false
    this.prune()
    if (!this.pending.has(value)) return false
    this.pending.delete(value)
    return true
  }

  clear(): void {
    this.pending.clear()
  }

  private prune(): void {
    const currentTime = this.now()
    for (const [url, expiresAt] of this.pending) {
      if (expiresAt <= currentTime) this.pending.delete(url)
    }
  }
}
