import { isAbsolute, normalize } from 'node:path'

const DEFAULT_MAX_GRANTED_PATHS = 256

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizedAbsolutePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4_096 &&
    !value.includes('\0') &&
    isAbsolute(value) &&
    normalize(value) === value
  )
}

/** Keeps renderer-supplied attachment paths bound to an explicit native picker result. */
export class ComposerPathGrants {
  private readonly paths = new Map<string, true>()

  constructor(private readonly maxGrantedPaths = DEFAULT_MAX_GRANTED_PATHS) {
    if (!Number.isSafeInteger(maxGrantedPaths) || maxGrantedPaths <= 0) {
      throw new TypeError('maxGrantedPaths must be positive')
    }
  }

  grant(paths: readonly string[]): void {
    for (const path of paths) {
      if (!normalizedAbsolutePath(path)) continue
      this.paths.delete(path)
      this.paths.set(path, true)
      while (this.paths.size > this.maxGrantedPaths) {
        const oldest = this.paths.keys().next().value as string | undefined
        if (!oldest) break
        this.paths.delete(oldest)
      }
    }
  }

  assertAllowedRpc(method: unknown, params: unknown): void {
    if (
      method !== 'turn/start' &&
      method !== 'turn/steer' &&
      method !== 'thread/queue/add' &&
      method !== 'thread/queue/update'
    ) return
    if (!isRecord(params) || !Array.isArray(params.input)) {
      throw new Error('Attachment paths require a valid turn input')
    }

    for (const item of params.input) {
      if (!isRecord(item) || (item.type !== 'localImage' && item.type !== 'mention')) continue
      if (!normalizedAbsolutePath(item.path) || !this.paths.has(item.path)) {
        throw new Error('Attachment path was not selected in the native file picker')
      }
    }
  }
}
