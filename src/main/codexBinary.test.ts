import { describe, expect, it, vi } from 'vitest'
import { discoverCodexBinary } from './codexBinary'

describe('discoverCodexBinary', () => {
  it('gives CODEX_BINARY precedence over PATH and fallback locations', () => {
    const isExecutable = vi.fn((path: string) => path === '/custom/codex')

    expect(
      discoverCodexBinary({
        env: { CODEX_BINARY: '/custom/codex', PATH: '/path/bin' },
        isExecutable
      })
    ).toBe('/custom/codex')
    expect(isExecutable).toHaveBeenCalledOnce()
  })

  it('searches PATH before common Homebrew locations when the desktop bundle is absent', () => {
    const isExecutable = (path: string): boolean => path === '/second/bin/codex'

    expect(
      discoverCodexBinary({
        env: { PATH: '/first/bin:/second/bin' },
        isExecutable
      })
    ).toBe('/second/bin/codex')
  })

  it('prefers the installed desktop native binary when PATH is Finder-like', () => {
    const bundled =
      '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
    const isExecutable = (path: string): boolean => path === bundled

    expect(discoverCodexBinary({ env: { PATH: '/usr/bin:/bin' }, isExecutable })).toBe(bundled)
  })

  it('prefers the installed desktop companion over a different PATH release', () => {
    const bundled =
      '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
    const isExecutable = (path: string): boolean =>
      path === bundled || path === '/custom/bin/codex'

    expect(
      discoverCodexBinary({ env: { PATH: '/custom/bin' }, isExecutable })
    ).toBe(bundled)
  })

  it('falls back to the Apple Silicon and Intel Homebrew locations', () => {
    const isExecutable = (path: string): boolean => path === '/opt/homebrew/bin/codex'

    expect(discoverCodexBinary({ env: { PATH: '' }, isExecutable })).toBe(
      '/opt/homebrew/bin/codex'
    )
  })

  it('fails explicitly when an override is invalid', () => {
    expect(() =>
      discoverCodexBinary({
        env: { CODEX_BINARY: '/missing/codex', PATH: '/bin' },
        isExecutable: () => false
      })
    ).toThrow('CODEX_BINARY is set to "/missing/codex"')
  })

  it('describes every supported discovery route when none succeeds', () => {
    expect(() =>
      discoverCodexBinary({ env: { PATH: '/bin' }, isExecutable: () => false })
    ).toThrow(/CODEX_BINARY.*PATH.*npm\/Homebrew.*official Codex desktop app/)
  })
})
