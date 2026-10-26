import { describe, expect, it } from 'vitest'
import { initialWorkspaceLayoutMode, parseWorkspaceLayouts, workspaceSurfaceLayout } from './workspaceLayout'

describe('workspace primary surface layout', () => {
  it('uses the new-task preference without opening a content surface', () => {
    const mode = initialWorkspaceLayoutMode(true)
    expect(mode).toBe('full')
    expect(workspaceSurfaceLayout(mode, false)).toEqual({ primarySurface: 'chat', contentFullWidth: false, showChat: true })
    expect(initialWorkspaceLayoutMode(false)).toBe('split')
    expect(initialWorkspaceLayoutMode(false, 'content')).toBe('full')
  })

  it('full view switches to content and returns to chat when content closes', () => {
    expect(workspaceSurfaceLayout('full', true)).toEqual({ primarySurface: 'content', contentFullWidth: true, showChat: false })
    expect(workspaceSurfaceLayout('full', false)).toEqual({ primarySurface: 'chat', contentFullWidth: false, showChat: true })
  })

  it('split view keeps chat visible while content is open', () => {
    expect(workspaceSurfaceLayout('split', true)).toEqual({ primarySurface: 'content', contentFullWidth: false, showChat: true })
  })

  it('retains valid saved task modes and rejects corrupt or legacy values', () => {
    expect(parseWorkspaceLayouts('{"old":"split","new":"full","expanded":true,"unknown":"automatic","":"full"}')).toEqual({ old: 'split', new: 'full' })
    for (const raw of [null, '', '{broken', '[]', 'null', 'true', '42']) expect(parseWorkspaceLayouts(raw)).toEqual({})
    const stored = parseWorkspaceLayouts('{"old":"split"}')
    expect(initialWorkspaceLayoutMode(true)).toBe('full')
    expect(stored.old).toBe('split')
  })
})
