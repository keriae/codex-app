import type { CodexDesktopApi } from '../../shared/api'

declare global {
  interface Window {
    codex: CodexDesktopApi
  }
}

export {}
