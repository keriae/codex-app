import { describe, expect, it } from 'vitest'
import { appearanceTheme, DEFAULT_DESKTOP_SETTINGS, normalizeDesktopSettings, parseDesktopSettings } from './desktopSettings'

describe('desktop settings persistence', () => {
  it('restores chosen settings across routes and preserves new defaults', () => {
    const saved = parseDesktopSettings(JSON.stringify({
      defaultTerminalLocation: 'right', fullAccessVisible: false,
      turnCompletionNotifications: 'never', projectlessDirectory: '/synthetic/notes',
      accentColor: '#ff0011', unknown: 'ignored'
    }))
    expect(saved.defaultTerminalLocation).toBe('right')
    expect(saved.fullAccessVisible).toBe(false)
    expect(saved.turnCompletionNotifications).toBe('never')
    expect(saved.permissionNotifications).toBe(true)
    expect(saved.accentColor).toBe('#ff0011')
    expect(saved).not.toHaveProperty('unknown')
  })

  it('rejects corrupted, wrongly typed and out-of-range saved preferences', () => {
    expect(parseDesktopSettings('{broken')).toEqual(DEFAULT_DESKTOP_SETTINGS)
    expect(normalizeDesktopSettings({
      fullAccessVisible: 'false', defaultTerminalLocation: 'other',
      autoArchiveAfterDays: -1, accentColor: 'var(--other)', foregroundColor: '#000000;url(x)'
    })).toEqual(DEFAULT_DESKTOP_SETTINGS)
  })

  it('resolves system appearance independently from forced light and dark', () => {
    expect(appearanceTheme('system', true)).toBe('dark')
    expect(appearanceTheme('system', false)).toBe('light')
    expect(appearanceTheme('light', true)).toBe('light')
    expect(appearanceTheme('dark', false)).toBe('dark')
  })
})
