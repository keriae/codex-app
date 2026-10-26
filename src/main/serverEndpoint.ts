import { isAbsolute, resolve } from 'node:path'

export type AppServerEndpoint =
  | { kind: 'websocket'; url: string }
  | { kind: 'unix'; socketPath: string }

/** Explicit endpoints override daemon discovery and must never fall back to stdio. */
export function configuredAppServerEndpoint(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): AppServerEndpoint | null {
  const url = env.CODEX_APP_SERVER_URL?.trim()
  const socketPath = env.CODEX_APP_SERVER_SOCKET?.trim()
  if (url && socketPath) {
    throw new Error('Configure either CODEX_APP_SERVER_URL or CODEX_APP_SERVER_SOCKET, not both')
  }
  if (socketPath) return { kind: 'unix', socketPath: resolve(cwd, socketPath) }
  if (!url) return null
  return parseAppServerEndpoint(url, cwd)
}

export function parseAppServerEndpoint(value: string, cwd = process.cwd()): AppServerEndpoint {
  if (isAbsolute(value)) return { kind: 'unix', socketPath: resolve(cwd, value) }
  const address = /^(?:localhost|127\.0\.0\.1|\[::1\]):\d+(?:\/.*)?$/u.test(value)
    ? `ws://${value}`
    : value
  let url: URL
  try {
    url = new URL(address)
  } catch {
    throw new Error('CODEX_APP_SERVER_URL must be a ws://, wss:// or unix:// endpoint')
  }
  if (url.protocol === 'unix:' || url.protocol === 'ws+unix:') {
    if (url.hostname || url.search || url.hash || !url.pathname || url.pathname === '/') {
      throw new Error('Unix app-server endpoints must specify an absolute socket path')
    }
    let socketPath: string
    try {
      socketPath = decodeURIComponent(url.pathname)
    } catch {
      throw new Error('Unix app-server endpoint contains an invalid encoded path')
    }
    if (socketPath.includes('\0')) throw new Error('Unix app-server endpoint contains an invalid path')
    return { kind: 'unix', socketPath }
  }
  if (!['ws:', 'wss:'].includes(url.protocol) || !url.hostname || url.hash) {
    throw new Error('CODEX_APP_SERVER_URL must be a ws://, wss:// or unix:// endpoint')
  }
  // Preserve the supplied WS path: codex --listen exposes '/', while the
  // managed daemon uses '/rpc'. Adding '/rpc' would break public listeners.
  return { kind: 'websocket', url: url.href }
}
