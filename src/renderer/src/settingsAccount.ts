import type { RpcNotification } from '../../shared/api'

type JsonRecord = Record<string, unknown>

export type AccountDetails =
  | { type: 'chatgpt'; email: string | null; planType: string | null }
  | { type: 'apiKey' }
  | { type: 'amazonBedrock' }
  | { type: 'unknown'; provider: string }

export interface AccountSnapshot {
  account: AccountDetails | null
  requiresOpenaiAuth: boolean
}

export interface AccountPresentation {
  status: 'connected' | 'required' | 'optional'
  eyebrow: string
  title: string
  description: string
  email: string | null
  plan: string | null
  canLogin: boolean
  canLogout: boolean
}

export interface RateLimitWindow {
  usedPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

export interface RateLimitSnapshot {
  limitId: string | null
  limitName: string | null
  planType: string | null
  primary: RateLimitWindow | null
  secondary: RateLimitWindow | null
  credits: {
    hasCredits: boolean
    unlimited: boolean
    balance: string | null
  } | null
}

export interface LoginCompletion {
  loginId: string | null
  success: boolean
  error: string | null
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function normalizeAccountResponse(value: unknown): AccountSnapshot {
  const response = record(value)
  if (!response || typeof response.requiresOpenaiAuth !== 'boolean') {
    throw new Error('The app-server returned an invalid account response')
  }

  if (response.account === null || response.account === undefined) {
    return { account: null, requiresOpenaiAuth: response.requiresOpenaiAuth }
  }

  const rawAccount = record(response.account)
  if (!rawAccount || typeof rawAccount.type !== 'string') {
    throw new Error('The app-server returned an invalid account record')
  }

  let account: AccountDetails
  if (rawAccount.type === 'chatgpt') {
    account = {
      type: 'chatgpt',
      email: nullableString(rawAccount.email),
      planType: nullableString(rawAccount.planType)
    }
  } else if (rawAccount.type === 'apiKey') {
    account = { type: 'apiKey' }
  } else if (rawAccount.type === 'amazonBedrock') {
    account = { type: 'amazonBedrock' }
  } else {
    account = { type: 'unknown', provider: rawAccount.type }
  }

  return { account, requiresOpenaiAuth: response.requiresOpenaiAuth }
}

export function accountPresentation(snapshot: AccountSnapshot): AccountPresentation {
  if (!snapshot.account) {
    if (snapshot.requiresOpenaiAuth) {
      return {
        status: 'required',
        eyebrow: 'OpenAI account',
        title: 'Sign in to use Codex',
        description: 'Connect ChatGPT to run models provided by OpenAI.',
        email: null,
        plan: null,
        canLogin: true,
        canLogout: false
      }
    }
    return {
      status: 'optional',
      eyebrow: 'Authentication',
      title: 'No sign-in required',
      description: 'Your current model provider can run without an OpenAI account.',
      email: null,
      plan: null,
      canLogin: true,
      canLogout: false
    }
  }

  if (snapshot.account.type === 'chatgpt') {
    return {
      status: 'connected',
      eyebrow: 'ChatGPT account',
      title: snapshot.account.email || 'Signed in with ChatGPT',
      description: 'Codex uses this account for model access and usage limits.',
      email: snapshot.account.email,
      plan: snapshot.account.planType,
      canLogin: false,
      canLogout: true
    }
  }

  const provider =
    snapshot.account.type === 'apiKey'
      ? 'API key'
      : snapshot.account.type === 'amazonBedrock'
        ? 'Amazon Bedrock'
        : snapshot.account.provider
  return {
    status: 'connected',
    eyebrow: 'Model provider',
    title: `Connected with ${provider}`,
    description:
      snapshot.account.type === 'apiKey'
        ? 'An API key is configured outside this settings surface. Its value is never displayed.'
        : 'Codex is using the configured external model provider.',
    email: null,
    plan: null,
    canLogin: false,
    canLogout: true
  }
}

function normalizeWindow(value: unknown): RateLimitWindow | null {
  const source = record(value)
  const usedPercent = source && finiteNumber(source.usedPercent)
  if (!source || usedPercent === null) return null
  return {
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    windowDurationMins: finiteNumber(source.windowDurationMins),
    resetsAt: finiteNumber(source.resetsAt)
  }
}

function normalizeRateLimit(value: unknown, fallbackId: string | null): RateLimitSnapshot | null {
  const source = record(value)
  if (!source) return null
  const credits = record(source.credits)
  return {
    limitId: nullableString(source.limitId) || fallbackId,
    limitName: nullableString(source.limitName),
    planType: nullableString(source.planType),
    primary: normalizeWindow(source.primary),
    secondary: normalizeWindow(source.secondary),
    credits:
      credits && typeof credits.hasCredits === 'boolean' && typeof credits.unlimited === 'boolean'
        ? {
            hasCredits: credits.hasCredits,
            unlimited: credits.unlimited,
            balance: nullableString(credits.balance)
          }
        : null
  }
}

export function normalizeRateLimitsResponse(value: unknown): RateLimitSnapshot[] {
  const response = record(value)
  if (!response) return []

  const byId = record(response.rateLimitsByLimitId)
  if (byId) {
    const snapshots = Object.entries(byId).flatMap(([id, item]) => {
      const normalized = normalizeRateLimit(item, id)
      return normalized ? [normalized] : []
    })
    if (snapshots.length) return snapshots
  }

  const single = normalizeRateLimit(response.rateLimits, null)
  return single ? [single] : []
}

export function parseLoginCompletion(notification: RpcNotification): LoginCompletion | null {
  if (notification.method !== 'account/login/completed') return null
  const params = record(notification.params)
  if (!params || typeof params.success !== 'boolean') return null
  return {
    loginId: nullableString(params.loginId),
    success: params.success,
    error: nullableString(params.error)
  }
}

export function shouldRefreshAccount(notification: RpcNotification): boolean {
  return (
    notification.method === 'account/updated' ||
    notification.method === 'account/login/completed' ||
    notification.method === 'account/rateLimits/updated'
  )
}

export function planLabel(value: string | null): string | null {
  if (!value) return null
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function rateLimitWindowLabel(window: RateLimitWindow, fallback: string): string {
  const minutes = window.windowDurationMins
  if (!minutes) return fallback
  if (minutes % 10_080 === 0) return `${minutes / 10_080}-week limit`
  if (minutes % 1_440 === 0) return `${minutes / 1_440}-day limit`
  if (minutes % 60 === 0) return `${minutes / 60}-hour limit`
  return `${minutes}-minute limit`
}
