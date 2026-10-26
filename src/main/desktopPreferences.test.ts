import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DESKTOP_PREFERENCES,
  DesktopPreferencesStore,
  isDesktopPreferences,
  mergeDesktopPreferences,
  RunningTurnTracker,
  shouldDeliverDesktopNotification
} from './desktopPreferences'

describe('native desktop preference persistence', () => {
  it('persists supported preferences in the replica profile across main-process launches', () => {
    const directory = mkdtempSync(join(tmpdir(), 'codex-preferences-test-'))
    try {
      const store = new DesktopPreferencesStore(directory)
      expect(store.load()).toEqual(DEFAULT_DESKTOP_PREFERENCES)
      const next = { ...DEFAULT_DESKTOP_PREFERENCES, turnCompletionNotifications: 'never' as const }
      store.save(next)
      expect(new DesktopPreferencesStore(directory).load()).toEqual(next)
      expect(isDesktopPreferences({ ...next, extra: true })).toBe(false)
      expect(isDesktopPreferences({ ...next, permissionNotifications: 'false' })).toBe(false)
      expect(isDesktopPreferences({ ...next, turnCompletionNotifications: { toString: () => 'never' } })).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('migrates five-field profiles while retaining every saved value and preserves native close-policy updates', () => {
    const directory = mkdtempSync(join(tmpdir(), 'codex-preferences-migrate-test-'))
    try {
      const legacy = {
        permissionNotifications: false,
        questionNotifications: false,
        dotNotifications: false,
        turnCompletionNotifications: 'always' as const,
        preventSleepWhileRunning: true
      }
      writeFileSync(join(directory, 'desktop-preferences.json'), JSON.stringify(legacy))
      const store = new DesktopPreferencesStore(directory)
      expect(store.load()).toEqual({ ...legacy, appearance: 'system', closeWindowConfirmation: 'shortcut' })
      expect(isDesktopPreferences(legacy)).toBe(true)
      expect(isDesktopPreferences({ ...legacy, closeWindowConfirmation: 'keyboardOnly' })).toBe(false)
      const next = mergeDesktopPreferences(legacy, { ...DEFAULT_DESKTOP_PREFERENCES, closeWindowConfirmation: 'never' })
      expect(next).toEqual({ ...legacy, appearance: 'system', closeWindowConfirmation: 'never' })
      store.save(next)
      expect(store.load()).toEqual(next)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})

describe('desktop notification delivery policy', () => {
  it('applies completion modes to both foreground and background windows', () => {
    const preferences = { ...DEFAULT_DESKTOP_PREFERENCES }
    expect(shouldDeliverDesktopNotification(preferences, 'notification', 'turn/completed', true)).toBe(false)
    expect(shouldDeliverDesktopNotification(preferences, 'notification', 'turn/completed', false)).toBe(true)
    preferences.turnCompletionNotifications = 'always'
    expect(shouldDeliverDesktopNotification(preferences, 'notification', 'turn/completed', true)).toBe(true)
    preferences.turnCompletionNotifications = 'never'
    expect(shouldDeliverDesktopNotification(preferences, 'notification', 'turn/completed', false)).toBe(false)
  })

  it('controls question and permission alerts independently and excludes noninteractive calls', () => {
    const preferences = { ...DEFAULT_DESKTOP_PREFERENCES, permissionNotifications: false }
    expect(shouldDeliverDesktopNotification(preferences, 'server-request', 'item/fileChange/requestApproval', false)).toBe(false)
    expect(shouldDeliverDesktopNotification(preferences, 'server-request', 'item/tool/requestUserInput', false)).toBe(true)
    expect(shouldDeliverDesktopNotification(preferences, 'server-request', 'mcpServer/elicitation/request', true)).toBe(false)
    preferences.questionNotifications = false
    expect(shouldDeliverDesktopNotification(preferences, 'server-request', 'mcpServer/elicitation/request', false)).toBe(false)
    expect(shouldDeliverDesktopNotification(preferences, 'server-request', 'item/tool/call', false)).toBe(false)
  })
})

describe('running turn sleep assertion tracking', () => {
  it('keeps the app awake until every concurrent turn has completed and clears on disconnection', () => {
    const tracker = new RunningTurnTracker()
    tracker.remember({ method: 'turn/started', params: { threadId: 'thread-one', turn: { id: 'turn-one' } } })
    tracker.remember({ method: 'turn/started', params: { threadId: 'thread-two', turn: { id: 'turn-two' } } })
    tracker.remember({ method: 'turn/completed', params: { threadId: 'thread-one', turn: { id: 'turn-one' } } })
    expect(tracker.isRunning).toBe(true)
    tracker.remember({ method: 'turn/completed', params: { threadId: 'thread-two', turn: { id: 'turn-two' } } })
    expect(tracker.isRunning).toBe(false)
    tracker.remember({ method: 'turn/started', params: { threadId: 'thread-one', turn: { id: 'turn-three' } } })
    tracker.clear()
    expect(tracker.isRunning).toBe(false)
  })
})
