import { describe, expect, it } from 'vitest'
import type { ThreadSession } from './state/sessionReducer'
import {
  collectWorkbenchBrowserRecents,
  formatWorkbenchBrowserRecentTime
} from './workbenchBrowserRecents'

describe('workbench browser recent output artifacts', () => {
  it('collects generated images, changed files, and MCP resource links newest first', () => {
    const session: ThreadSession = {
      activeTurnId: null,
      running: false,
      error: null,
      turns: [{
        id: 'turn-1',
        status: 'completed',
        startedAt: 1_700_000_000,
        completedAt: 1_700_000_100,
        items: [
          {
            type: 'fileChange', id: 'files', status: 'completed', changes: [
              { path: 'src/old.ts', kind: { type: 'delete' }, diff: '' },
              { path: 'src/app.ts', kind: { type: 'update', move_path: null }, diff: '' }
            ]
          },
          { type: 'imageGeneration', id: 'image', status: 'completed', savedPath: '/tmp/result.png' },
          {
            type: 'mcpToolCall', id: 'tool', status: 'completed', result: {
              content: [{ type: 'resource_link', uri: 'https://example.com/report', name: 'Report' }]
            }
          }
        ]
      }]
    }

    expect(collectWorkbenchBrowserRecents(session)).toEqual([
      expect.objectContaining({ kind: 'website', title: 'Report', target: 'https://example.com/report' }),
      expect.objectContaining({ kind: 'image', title: 'result.png', target: '/tmp/result.png' }),
      expect.objectContaining({ kind: 'file', title: 'app.ts', target: 'src/app.ts' })
    ])
    expect(collectWorkbenchBrowserRecents(session)[0].producedAtMs).toBe(1_700_000_100_000)
  })

  it('deduplicates artifacts in favor of the newest occurrence and enforces the limit', () => {
    const session: ThreadSession = {
      activeTurnId: null,
      running: false,
      error: null,
      turns: [1, 2].map((turn) => ({
        id: `turn-${turn}`,
        status: 'completed' as const,
        completedAt: turn,
        items: [{
          type: 'fileChange' as const,
          id: `files-${turn}`,
          changes: [{ path: 'same.ts', kind: { type: 'update' as const, move_path: null }, diff: '' }]
        }]
      }))
    }
    expect(collectWorkbenchBrowserRecents(session, 1)).toEqual([
      expect.objectContaining({ id: 'turn-2:files-2:file:same.ts', producedAtMs: 2_000 })
    ])
  })

  it('formats same-day artifacts as time and older artifacts as a date', () => {
    const now = new Date(2026, 9, 25, 12, 0, 0)
    expect(formatWorkbenchBrowserRecentTime(
      new Date(2026, 9, 25, 0, 35, 0).getTime(),
      now
    )?.label).toMatch(/0?0:35/u)
    expect(formatWorkbenchBrowserRecentTime(
      new Date(2026, 9, 24, 18, 0, 0).getTime(),
      now
    )?.label).toContain('10月24日')
  })
})
