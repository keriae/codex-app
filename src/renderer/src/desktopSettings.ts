import { useSyncExternalStore } from 'react'

export const DESKTOP_SETTINGS_KEY = 'codex-desktop-settings-v1'
export const DESKTOP_SETTINGS_EVENT = 'codex:desktop-settings-changed'

export type AppearanceMode = 'system' | 'light' | 'dark'

export interface DesktopSettings {
  appearance: AppearanceMode
  accentColor: string
  backgroundColor: string
  foregroundColor: string
  fontFamily: string
  fullAccessVisible: boolean
  defaultFullView: boolean
  bottomPanelEnabled: boolean
  defaultTerminalLocation: 'bottom' | 'right'
  defaultFileTarget: 'finder' | 'terminal'
  language: 'auto' | 'zh-CN' | 'en'
  closeWindowConfirmation: 'shortcut' | 'always' | 'never'
  autoArchiveAfterDays: 0 | 1 | 7 | 14 | 30 | 90
  preventSleepWhileRunning: boolean
  compressHistory: boolean
  permissionNotifications: boolean
  questionNotifications: boolean
  dotNotifications: boolean
  turnCompletionNotifications: 'always' | 'unfocused' | 'never'
  projectlessDirectory: string
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  appearance: 'system',
  accentColor: '#0169cc',
  backgroundColor: '#111111',
  foregroundColor: '#fcfcfc',
  fontFamily: 'system',
  fullAccessVisible: true,
  defaultFullView: false,
  bottomPanelEnabled: true,
  defaultTerminalLocation: 'bottom',
  defaultFileTarget: 'terminal',
  language: 'auto',
  closeWindowConfirmation: 'shortcut',
  autoArchiveAfterDays: 0,
  preventSleepWhileRunning: false,
  compressHistory: true,
  permissionNotifications: true,
  questionNotifications: true,
  dotNotifications: true,
  turnCompletionNotifications: 'unfocused',
  projectlessDirectory: ''
}

const enumValues: Partial<Record<keyof DesktopSettings, readonly unknown[]>> = {
  appearance: ['system', 'light', 'dark'],
  defaultTerminalLocation: ['bottom', 'right'],
  defaultFileTarget: ['finder', 'terminal'],
  language: ['auto', 'zh-CN', 'en'],
  closeWindowConfirmation: ['shortcut', 'always', 'never'],
  autoArchiveAfterDays: [0, 1, 7, 14, 30, 90],
  turnCompletionNotifications: ['always', 'unfocused', 'never']
}

export function normalizeDesktopSettings(value: unknown): DesktopSettings {
  const result = { ...DEFAULT_DESKTOP_SETTINGS }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const key of Object.keys(result) as Array<keyof DesktopSettings>) {
    const candidate = (value as Record<string, unknown>)[key]
    if (candidate === undefined) continue
    const options = enumValues[key]
    if (options ? !options.includes(candidate) : typeof candidate !== typeof result[key]) continue
    if (key.endsWith('Color') && !/^#[0-9a-f]{6}$/i.test(candidate as string)) continue
    if (typeof candidate === 'string' && candidate.length > 4096) continue
    Object.assign(result, { [key]: candidate })
  }
  return result
}

export function parseDesktopSettings(raw: string | null): DesktopSettings {
  try {
    return normalizeDesktopSettings(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_DESKTOP_SETTINGS }
  }
}

let cachedRaw: string | null | undefined
let cachedSettings = DEFAULT_DESKTOP_SETTINGS

export function readDesktopSettings(): DesktopSettings {
  if (typeof window === 'undefined') return DEFAULT_DESKTOP_SETTINGS
  let raw: string | null
  try {
    raw = window.localStorage.getItem(DESKTOP_SETTINGS_KEY)
  } catch {
    return cachedSettings
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw
    cachedSettings = parseDesktopSettings(raw)
  }
  return cachedSettings
}

export function updateDesktopSettings(patch: Partial<DesktopSettings>): DesktopSettings {
  const next = normalizeDesktopSettings({ ...readDesktopSettings(), ...patch })
  const raw = JSON.stringify(next)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(DESKTOP_SETTINGS_KEY, raw)
    } catch {
      // Preferences remain usable for this window if macOS storage is unavailable.
    }
    cachedRaw = raw
    cachedSettings = next
    window.dispatchEvent(new CustomEvent(DESKTOP_SETTINGS_EVENT, { detail: next }))
  }
  return next
}

function subscribe(listener: () => void): () => void {
  const storageChanged = (event: StorageEvent): void => {
    if (event.key === DESKTOP_SETTINGS_KEY || event.key === null) listener()
  }
  window.addEventListener(DESKTOP_SETTINGS_EVENT, listener)
  window.addEventListener('storage', storageChanged)
  return () => {
    window.removeEventListener(DESKTOP_SETTINGS_EVENT, listener)
    window.removeEventListener('storage', storageChanged)
  }
}

export function useDesktopSettings(): DesktopSettings {
  return useSyncExternalStore(subscribe, readDesktopSettings, () => DEFAULT_DESKTOP_SETTINGS)
}

export function appearanceTheme(mode: AppearanceMode, systemDark: boolean): 'light' | 'dark' {
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
}
