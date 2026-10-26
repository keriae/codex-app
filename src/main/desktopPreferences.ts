import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DesktopPreferences, RpcNotification } from '../shared/api'

export type ResolvedDesktopPreferences = DesktopPreferences & {
  appearance: 'system' | 'light' | 'dark'
  closeWindowConfirmation: 'shortcut' | 'always' | 'never'
}

export const DEFAULT_DESKTOP_PREFERENCES: ResolvedDesktopPreferences = {
  appearance: 'system',
  permissionNotifications: true,
  questionNotifications: true,
  dotNotifications: true,
  turnCompletionNotifications: 'unfocused',
  preventSleepWhileRunning: false,
  closeWindowConfirmation: 'shortcut'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isDesktopPreferences(value: unknown): value is DesktopPreferences {
  return isRecord(value) && Object.keys(value).every((key) => [
    'appearance',
    'permissionNotifications', 'questionNotifications', 'dotNotifications',
    'turnCompletionNotifications', 'preventSleepWhileRunning', 'closeWindowConfirmation'
  ].includes(key)) &&
    (value.appearance === undefined || value.appearance === 'system' ||
      value.appearance === 'light' || value.appearance === 'dark') &&
    typeof value.permissionNotifications === 'boolean' &&
    typeof value.questionNotifications === 'boolean' &&
    typeof value.dotNotifications === 'boolean' &&
    typeof value.turnCompletionNotifications === 'string' &&
    ['always', 'unfocused', 'never'].includes(value.turnCompletionNotifications) &&
    typeof value.preventSleepWhileRunning === 'boolean' &&
    (value.closeWindowConfirmation === undefined || value.closeWindowConfirmation === 'shortcut' ||
      value.closeWindowConfirmation === 'always' || value.closeWindowConfirmation === 'never')
}

/** Legacy renderer updates must preserve a close policy changed in main. */
export function mergeDesktopPreferences(
  preferences: DesktopPreferences,
  previous: ResolvedDesktopPreferences = DEFAULT_DESKTOP_PREFERENCES
): ResolvedDesktopPreferences {
  return {
    ...preferences,
    appearance: preferences.appearance ?? previous.appearance,
    closeWindowConfirmation: preferences.closeWindowConfirmation ?? previous.closeWindowConfirmation
  }
}

export class DesktopPreferencesStore {
  private readonly filePath: string

  constructor(userDataDirectory: string) {
    this.filePath = join(userDataDirectory, 'desktop-preferences.json')
  }

  load(): ResolvedDesktopPreferences {
    try {
      const value: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (isDesktopPreferences(value)) return mergeDesktopPreferences(value)
    } catch { /* First launch and stale preferences use the recorded defaults. */ }
    return { ...DEFAULT_DESKTOP_PREFERENCES }
  }

  save(preferences: DesktopPreferences): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(mergeDesktopPreferences(preferences))}\n`, { mode: 0o600 })
    renameSync(temporaryPath, this.filePath)
  }
}

export function shouldDeliverDesktopNotification(
  preferences: DesktopPreferences,
  kind: 'notification' | 'server-request',
  method: string,
  focused: boolean
): boolean {
  if (kind === 'notification') {
    return method === 'turn/completed' && preferences.turnCompletionNotifications !== 'never' &&
      (preferences.turnCompletionNotifications === 'always' || !focused)
  }
  if (focused) return false
  if (['item/tool/requestUserInput', 'mcpServer/elicitation/request'].includes(method)) {
    return preferences.questionNotifications
  }
  return preferences.permissionNotifications && [
    'item/commandExecution/requestApproval',
    'item/fileChange/requestApproval',
    'item/permissions/requestApproval',
    'execCommandApproval',
    'applyPatchApproval'
  ].includes(method)
}

/** Track server-owned turn IDs so the sleep assertion follows actual backend work. */
export class RunningTurnTracker {
  private readonly turns = new Set<string>()

  remember(notification: RpcNotification): void {
    if (!['turn/started', 'turn/completed'].includes(notification.method)) return
    const params = isRecord(notification.params) ? notification.params : null
    const turn = params && isRecord(params.turn) ? params.turn : null
    if (!params || typeof params.threadId !== 'string' || typeof turn?.id !== 'string') return
    const key = JSON.stringify([params.threadId, turn.id])
    if (notification.method === 'turn/started') this.turns.add(key)
    else this.turns.delete(key)
  }

  get isRunning(): boolean { return this.turns.size > 0 }
  clear(): void { this.turns.clear() }
}
