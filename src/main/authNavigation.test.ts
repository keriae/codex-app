import { describe, expect, it } from 'vitest'
import { AuthenticationUrlBroker, normalizeLoginStartResult } from './authNavigation'

describe('authentication URL broker', () => {
  it('accepts only bounded app-server login responses on trusted hosts', () => {
    expect(
      normalizeLoginStartResult({
        loginId: 'synthetic-login',
        authUrl: 'https://auth.openai.com/authorize?state=synthetic'
      })
    ).toEqual({
      loginId: 'synthetic-login',
      authUrl: 'https://auth.openai.com/authorize?state=synthetic'
    })
    expect(() =>
      normalizeLoginStartResult({
        loginId: 'synthetic-login',
        authUrl: 'https://example.com/authorize'
      })
    ).toThrow('invalid login response')
  })

  it('allows an exact remembered URL once and rejects substitutions', () => {
    const broker = new AuthenticationUrlBroker()
    const result = broker.remember({
      loginId: 'synthetic-login',
      authUrl: 'https://chatgpt.com/auth/login?state=one'
    })

    expect(broker.consume('https://chatgpt.com/auth/login?state=two')).toBe(false)
    expect(broker.consume(result.authUrl)).toBe(true)
    expect(broker.consume(result.authUrl)).toBe(false)
  })

  it('expires entries and bounds pending state', () => {
    let now = 1_000
    const broker = new AuthenticationUrlBroker(100, 2, () => now)
    broker.remember({ loginId: 'one', authUrl: 'https://chatgpt.com/auth/login?state=one' })
    broker.remember({ loginId: 'two', authUrl: 'https://chatgpt.com/auth/login?state=two' })
    broker.remember({ loginId: 'three', authUrl: 'https://chatgpt.com/auth/login?state=three' })

    expect(broker.consume('https://chatgpt.com/auth/login?state=one')).toBe(false)
    expect(broker.consume('https://chatgpt.com/auth/login?state=two')).toBe(true)
    now += 101
    expect(broker.consume('https://chatgpt.com/auth/login?state=three')).toBe(false)
  })
})
