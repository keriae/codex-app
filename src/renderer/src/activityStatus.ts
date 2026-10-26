import type { TurnStatus } from './protocol'

export interface WorkedForActivityItem {
  status?: unknown
  startedAtMs?: unknown
  completedAtMs?: unknown
}

type DurationUnit = 'day' | 'hour' | 'minute' | 'second'

const durationFormatters = new Map<string, Intl.NumberFormat>()

function resolvedDurationLocale(locale?: string): string {
  if (locale?.trim()) return locale
  // Codex keeps elapsed-time units in the compact English form (for example
  // "1m 31s") even when the rest of the desktop UI is localized to Chinese.
  return 'en'
}

function formatDurationUnit(value: number, unit: DurationUnit, locale: string): string {
  const key = `${locale}:${unit}`
  let formatter = durationFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'unit',
      unit,
      unitDisplay: 'narrow'
    })
    durationFormatters.set(key, formatter)
  }

  // The shipped formatter removes the separator emitted by Hungarian narrow
  // units so elapsed labels stay compact in the same way as other locales.
  if (locale.toLowerCase().split('-')[0] === 'hu') {
    return formatter.formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => part.value)
      .join('')
  }
  return formatter.format(value)
}

export function formatTurnDuration(
  durationMs: number | null | undefined,
  locale?: string
): string {
  const resolvedLocale = resolvedDurationLocale(locale)
  const totalSeconds = Math.floor(Math.max(durationMs ?? 0, 0) / 1_000)
  if (totalSeconds < 1) return formatDurationUnit(0, 'second', resolvedLocale)
  if (totalSeconds < 60) return formatDurationUnit(totalSeconds, 'second', resolvedLocale)

  const secondsPerHour = 3_600
  const days = Math.floor(totalSeconds / (secondsPerHour * 24))
  const hours = Math.floor(totalSeconds / secondsPerHour) % 24
  const minutes = Math.floor((totalSeconds % secondsPerHour) / 60)
  const seconds = totalSeconds % 60

  if (days > 0 || hours > 0) {
    const parts: string[] = []
    if (days > 0) parts.push(formatDurationUnit(days, 'day', resolvedLocale))
    if (hours > 0) parts.push(formatDurationUnit(hours, 'hour', resolvedLocale))
    if (minutes > 0) parts.push(formatDurationUnit(minutes, 'minute', resolvedLocale))
    if (seconds > 0) parts.push(formatDurationUnit(seconds, 'second', resolvedLocale))
    return parts.join(' ')
  }

  if (seconds === 0) return formatDurationUnit(minutes, 'minute', resolvedLocale)
  return [
    formatDurationUnit(minutes, 'minute', resolvedLocale),
    formatDurationUnit(seconds, 'second', resolvedLocale)
  ].join(' ')
}

export function liveActivityStatusLabel(durationMs: number, locale?: string): string {
  return durationMs < 1_000 ? '处理中' : `已处理 ${formatTurnDuration(durationMs, locale)}`
}

export function completedActivityStatusLabel(
  durationMs: number,
  status: TurnStatus,
  locale?: string
): string {
  const duration = formatTurnDuration(durationMs, locale)
  return status === 'interrupted' ? `你在 ${duration} 后停止了` : `用时 ${duration}`
}

function finiteMilliseconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * The shipped renderer prefers the synthetic `worked-for` timeline item over
 * the turn fallback duration. Its status remains useful while saved activity
 * is loading, paused, still working, or was explicitly stopped by the user.
 */
export function workedForActivityStatusLabel(
  item: WorkedForActivityItem | null | undefined,
  fallbackDurationMs: number,
  turnStatus: TurnStatus,
  nowMs = Date.now(),
  locale?: string
): string {
  if (!item) return completedActivityStatusLabel(fallbackDurationMs, turnStatus, locale)

  const startedAtMs = finiteMilliseconds(item.startedAtMs)
  const completedAtMs = finiteMilliseconds(item.completedAtMs)
  const elapsedMs = startedAtMs === null
    ? fallbackDurationMs
    : Math.max(0, (completedAtMs ?? nowMs) - startedAtMs)
  const duration = formatTurnDuration(elapsedMs, locale)

  switch (item.status) {
    case 'loading': return '正在加载活动状态'
    case 'unknown': return '活动'
    case 'paused': return '已暂停'
    case 'working': return elapsedMs < 1_000 ? '处理中' : `已处理 ${duration}`
    case 'stopped': return `你在 ${duration} 后停止了`
    case 'worked': return `用时 ${duration}`
    default: return completedActivityStatusLabel(fallbackDurationMs, turnStatus, locale)
  }
}
