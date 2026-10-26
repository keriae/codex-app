import { describe, expect, it } from 'vitest'
import {
  languageForWorkspaceFile,
  tokenizeWorkspaceCodeLine,
  workspaceBreadcrumbs,
  workspaceErrorMessage,
  workspaceRelativePath
} from './workspaceFileModel'

describe('workspace file presentation', () => {
  it('builds project-relative paths and breadcrumbs', () => {
    expect(workspaceRelativePath('/workspace/codex-app', '/workspace/codex-app/src/App.tsx')).toBe(
      'src/App.tsx'
    )
    expect(workspaceBreadcrumbs('/workspace/codex-app', '/workspace/codex-app/src/App.tsx')).toEqual(
      ['codex-app', 'src', 'App.tsx']
    )
  })

  it('derives readable language names and token classes', () => {
    expect(languageForWorkspaceFile('/workspace/App.tsx', 'text/tsx')).toBe('typescript')
    const tokens = tokenizeWorkspaceCodeLine('export const answer = "yes" // result')
    expect(tokens).toEqual(
      expect.arrayContaining([
        { text: 'export', kind: 'keyword' },
        { text: 'const', kind: 'keyword' },
        { text: '"yes"', kind: 'string' },
        { text: '// result', kind: 'comment' }
      ])
    )
  })

  it('removes Electron IPC boilerplate from errors shown in the pane', () => {
    expect(
      workspaceErrorMessage(
        new Error("Error invoking remote method 'app:workspace-read-file': Error: File is too large")
      )
    ).toBe('File is too large')
  })
})
