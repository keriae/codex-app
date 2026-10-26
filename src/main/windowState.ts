import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowStateSnapshot {
  bounds: WindowBounds
  maximized: boolean
  fullScreen: boolean
}

const MIN_VISIBLE_EDGE = 80

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isWindowBounds(value: unknown): value is WindowBounds {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    isFiniteNumber(candidate.x) &&
    isFiniteNumber(candidate.y) &&
    isFiniteNumber(candidate.width) &&
    isFiniteNumber(candidate.height) &&
    candidate.width >= 1 &&
    candidate.height >= 1
  )
}

export function parseWindowState(raw: string): WindowStateSnapshot | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (!value || typeof value !== 'object' || !isWindowBounds(value.bounds)) return null
    return {
      bounds: value.bounds,
      maximized: value.maximized === true,
      fullScreen: value.fullScreen === true
    }
  } catch {
    return null
  }
}

function intersectionArea(left: WindowBounds, right: WindowBounds): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
  )
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
  )
  return width * height
}

function fitWithin(bounds: WindowBounds, workArea: WindowBounds): WindowBounds {
  const width = Math.min(bounds.width, workArea.width)
  const height = Math.min(bounds.height, workArea.height)
  const x = Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width)
  const y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height)
  return { x, y, width, height }
}

export function restoreWindowBounds(
  saved: WindowBounds | null,
  workAreas: WindowBounds[],
  fallback: Pick<WindowBounds, 'width' | 'height'>
): Partial<WindowBounds> {
  if (!saved || workAreas.length === 0) return fallback

  const bestArea = workAreas
    .map((area) => ({ area, overlap: intersectionArea(saved, area) }))
    .sort((left, right) => right.overlap - left.overlap)[0]

  if (!bestArea || bestArea.overlap < MIN_VISIBLE_EDGE * MIN_VISIBLE_EDGE) return fallback
  return fitWithin(saved, bestArea.area)
}

export class WindowStateStore {
  readonly filePath: string

  constructor(userDataDirectory: string) {
    this.filePath = join(userDataDirectory, 'window-state.json')
  }

  load(): WindowStateSnapshot | null {
    try {
      return parseWindowState(readFileSync(this.filePath, 'utf8'))
    } catch {
      return null
    }
  }

  save(snapshot: WindowStateSnapshot): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(snapshot)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    renameSync(temporaryPath, this.filePath)
  }
}
