import { describe, expect, it } from 'vitest'
import {
  accountPresentation,
  normalizeAccountResponse,
  normalizeRateLimitsResponse,
  parseLoginCompletion,
  rateLimitWindowLabel,
  shouldRefreshAccount
} from './settingsAccount'

describe('account settings model', () => {
  it('retains only display-safe ChatGPT account fields', () => {
    const snapshot = normalizeAccountResponse({
      account: {
        type: 'chatgpt',
        email: 'person@example.com',
        planType: 'team',
        accessToken: 'must-not-escape',
        refreshToken: 'must-not-escape'
      },
      requiresOpenaiAuth: true
    })

    expect(snapshot).toEqual({
      account: { type: 'chatgpt', email: 'person@example.com', planType: 'team' },
      requiresOpenaiAuth: true
    })
    expect(JSON.stringify(snapshot)).not.toContain('must-not-escape')
    expect(accountPresentation(snapshot)).toMatchObject({
      status: 'connected',
      title: 'person@example.com',
      plan: 'team',
      canLogout: true
    })
  })

  it('distinguishes required and provider-managed authentication', () => {
    expect(
      accountPresentation(normalizeAccountResponse({ account: null, requiresOpenaiAuth: true }))
    ).toMatchObject({ status: 'required', canLogin: true })
    expect(
      accountPresentation(normalizeAccountResponse({ account: null, requiresOpenaiAuth: false }))
    ).toMatchObject({ status: 'optional', title: 'No sign-in required' })
  })

  it('describes an existing API-key account without accepting or exposing a key', () => {
    const view = accountPresentation(
      normalizeAccountResponse({ account: { type: 'apiKey', apiKey: 'secret' }, requiresOpenaiAuth: true })
    )
    expect(view.title).toBe('Connected with API key')
    expect(view.description).not.toContain('secret')
    expect(view.canLogin).toBe(false)
  })
})

describe('rate-limit settings model', () => {
  it('uses the multi-bucket response when available and clamps percentages', () => {
    expect(
      normalizeRateLimitsResponse({
        rateLimits: { primary: { usedPercent: 1 } },
        rateLimitsByLimitId: {
          codex: {
            limitName: 'Codex',
            primary: { usedPercent: 123, windowDurationMins: 300, resetsAt: 42 },
            secondary: null,
            credits: { hasCredits: true, unlimited: false, balance: '14.20' }
          }
        }
      })
    ).toEqual([
      {
        limitId: 'codex',
        limitName: 'Codex',
        planType: null,
        primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 42 },
        secondary: null,
        credits: { hasCredits: true, unlimited: false, balance: '14.20' }
      }
    ])
  })

  it('formats common rolling windows', () => {
    expect(
      rateLimitWindowLabel(
        { usedPercent: 25, windowDurationMins: 300, resetsAt: null },
        'Usage'
      )
    ).toBe('5-hour limit')
  })
})

describe('account notifications', () => {
  it('recognizes completion and refresh notifications', () => {
    const completion = {
      method: 'account/login/completed',
      params: { loginId: 'login-1', success: false, error: 'Canceled' }
    }
    expect(parseLoginCompletion(completion)).toEqual({
      loginId: 'login-1',
      success: false,
      error: 'Canceled'
    })
    expect(shouldRefreshAccount(completion)).toBe(true)
    expect(shouldRefreshAccount({ method: 'turn/completed' })).toBe(false)
  })
})
