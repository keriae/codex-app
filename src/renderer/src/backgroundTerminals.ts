import type { RpcNotification } from '../../shared/api'

export interface ThreadBackgroundTerminal {
  itemId: string
  processId: string
  command: string
  cwd: string
  osPid: number | null
  cpuPercent: number | null
  rssKb: number | null
}

export interface BackgroundTerminalsPage {
  data: ThreadBackgroundTerminal[]
  nextCursor: string | null
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function requiredString(
  value: unknown,
  field: string,
  { nonEmpty = false }: { nonEmpty?: boolean } = {}
): string {
  if (typeof value !== 'string' || (nonEmpty && value.length === 0)) {
    throw new Error(`Invalid background terminal ${field}`)
  }
  return value
}

function nullableNumber(
  value: unknown,
  field: string,
  { integer = false }: { integer?: boolean } = {}
): number | null {
  if (value === undefined || value === null) return null
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (integer && (!Number.isSafeInteger(value) || value < 0))
  ) {
    throw new Error(`Invalid background terminal ${field}`)
  }
  return value
}

function normalizeTerminal(value: unknown): ThreadBackgroundTerminal {
  const terminal = record(value)
  if (!terminal) throw new Error('Invalid background terminal entry')

  return {
    itemId: requiredString(terminal.itemId, 'itemId', { nonEmpty: true }),
    processId: requiredString(terminal.processId, 'processId', { nonEmpty: true }),
    command: requiredString(terminal.command, 'command'),
    cwd: requiredString(terminal.cwd, 'cwd'),
    osPid: nullableNumber(terminal.osPid, 'osPid', { integer: true }),
    cpuPercent: nullableNumber(terminal.cpuPercent, 'cpuPercent'),
    rssKb: nullableNumber(terminal.rssKb, 'rssKb', { integer: true })
  }
}

/**
 * Runtime validation for the 0.163.0 experimental
 * `thread/backgroundTerminals/list` response.
 */
export function normalizeBackgroundTerminalsPage(value: unknown): BackgroundTerminalsPage {
  const page = record(value)
  if (!page || !Array.isArray(page.data)) {
    throw new Error('Invalid background terminal list response')
  }
  if (
    page.nextCursor !== undefined &&
    page.nextCursor !== null &&
    typeof page.nextCursor !== 'string'
  ) {
    throw new Error('Invalid background terminal list cursor')
  }

  return {
    data: page.data.map(normalizeTerminal),
    nextCursor: typeof page.nextCursor === 'string' ? page.nextCursor : null
  }
}

export function normalizeTerminateResponse(value: unknown): { terminated: boolean } {
  const response = record(value)
  if (!response || typeof response.terminated !== 'boolean') {
    throw new Error('Invalid background terminal terminate response')
  }
  return { terminated: response.terminated }
}

export function mergeBackgroundTerminals(
  current: ThreadBackgroundTerminal[],
  incoming: ThreadBackgroundTerminal[]
): ThreadBackgroundTerminal[] {
  const merged = new Map(current.map((terminal) => [terminal.processId, terminal]))
  for (const terminal of incoming) merged.set(terminal.processId, terminal)
  return [...merged.values()]
}

/**
 * The protocol does not expose a status field. Presence in the live list is
 * the only status signal available in 0.163.0.
 */
export function backgroundTerminalStatus(): 'Running' {
  return 'Running'
}

export function shouldRefreshBackgroundTerminals(
  notification: RpcNotification,
  threadId: string
): boolean {
  if (notification.method !== 'item/started' && notification.method !== 'item/completed') {
    return false
  }
  const params = record(notification.params)
  if (!params || params.threadId !== threadId) return false
  const item = record(params.item)
  return (
    item?.type === 'commandExecution' &&
    typeof item.processId === 'string' &&
    item.processId.length > 0
  )
}
