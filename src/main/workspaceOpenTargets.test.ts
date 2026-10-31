import { describe, expect, it, vi } from 'vitest'
import { listWorkspaceOpenTargets } from './workspaceFileActions'

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original, stat: vi.fn(async (path: string) => {
    if (path !== '/Applications/Visual Studio Code.app') throw new Error('not installed')
    return { isDirectory: () => true }
  }) }
})

describe('native workspace app icons', () => {
  it('loads icons only from discovered app bundles and omits their private paths from IPC results', async () => {
    const icon = 'data:image/png;base64,aWNvbg=='
    const load = vi.fn(async (_applicationPath: string) => icon)
    const targets = await listWorkspaceOpenTargets(load)
    expect(targets).toEqual([
      { id: 'terminal', label: 'Terminal', iconDataUrl: icon },
      { id: 'finder', label: 'Finder', iconDataUrl: icon },
      { id: 'vscode', label: 'Visual Studio Code', iconDataUrl: icon }
    ])
    expect(load.mock.calls.map((call) => call[0])).toEqual([
      '/System/Applications/Utilities/Terminal.app',
      '/System/Library/CoreServices/Finder.app',
      '/Applications/Visual Studio Code.app'
    ])
    expect(targets.every((target) => !('applicationPath' in target))).toBe(true)
  })

  it('keeps installed apps available when macOS cannot supply one icon', async () => {
    const targets = await listWorkspaceOpenTargets(async (path) => {
      if (path.includes('Finder.app')) throw new Error('icon unavailable')
      return 'data:image/png;base64,aWNvbg=='
    })
    expect(targets.find((target) => target.id === 'finder')).toEqual({ id: 'finder', label: 'Finder' })
    expect(targets.find((target) => target.id === 'terminal')?.iconDataUrl).toBeDefined()
    expect(targets.find((target) => target.id === 'vscode')?.iconDataUrl).toBeDefined()
  })
})
