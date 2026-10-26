import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  ProjectSummaryPopover,
  projectSummarySubagentCounts,
  projectSummaryVisibleSources,
  type ProjectSummarySource,
  type ProjectSummarySubagent
} from './ProjectSummaryPopover'

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const popoverSource = readFileSync(new URL('./ProjectSummaryPopover.tsx', import.meta.url), 'utf8')
const workspaceSource = readFileSync(new URL('./WorkspacePane.tsx', import.meta.url), 'utf8')

const subagents: ProjectSummarySubagent[] = [
  { threadId: 'layout', name: 'Layout verification', status: 'active' },
  { threadId: 'visual', name: 'Visual diff', status: 'waiting' },
  { threadId: 'tests', name: 'Test audit', status: 'completed' }
]

const sources: ProjectSummarySource[] = [
  { id: 'one', turnId: 'older-turn', title: 'codex-clipboard-97136a6a-1336-4a8f.png', kind: 'image', thumbnailUrl: 'data:image/png;base64,AA==' },
  { id: 'two', turnId: 'older-turn', title: 'codex-clipboard-331429de-fedf-4c4e.png', kind: 'image' },
  { id: 'three', turnId: 'older-turn', title: 'codex-clipboard-636565d8-fbf6-45c2.png', kind: 'image' },
  { id: 'four', turnId: 'newer-turn', title: 'reverse-notes.md', kind: 'attachment' }
]

describe('ProjectSummaryPopover', () => {
  it('renders the observed project, changes, subagent, and source groups', () => {
    const html = renderToStaticMarkup(createElement(ProjectSummaryPopover, {
      projectName: 'codex-app',
      changesCount: 12,
      subagents,
      sources,
      open: true,
      onClose: vi.fn(),
      onOpenChanges: vi.fn(),
      onOpenSubagents: vi.fn(),
      onOpenSource: vi.fn(),
      onOpenProjectMenu: vi.fn()
    }))

    expect(html).toContain('aria-label="codex-app 项目摘要"')
    expect(html).toContain('aria-label="查看变更，12 个文件"')
    expect(html).toContain('>子智能体<')
    expect(html).toContain('2 个运行中')
    expect(html).toContain('1 完成')
    expect(html).toContain('Layout verification，开始工作')
    expect(html).toContain('aria-label="添加来源"')
    expect(html).toContain('aria-label="查看全部来源，共 4 项"')
    expect(html).toContain('codex-clipboard-97136a6a-1336-4a8f.png')
    expect(html).toContain('reverse-notes.md')
    expect(html).not.toContain('codex-clipboard-636565d8-fbf6-45c2.png')
  })

  it('stays absent while closed', () => {
    const html = renderToStaticMarkup(createElement(ProjectSummaryPopover, {
      projectName: 'codex-app',
      changesCount: 0,
      subagents: [],
      sources: [],
      open: false,
      onClose: vi.fn(),
      onOpenChanges: vi.fn(),
      onOpenSubagents: vi.fn(),
      onOpenSource: vi.fn()
    }))
    expect(html).toBe('')
  })

  it('matches the compact recorded state when no agents or sources exist', () => {
    const html = renderToStaticMarkup(createElement(ProjectSummaryPopover, {
      projectName: 'codex-app',
      changesCount: 1,
      subagents: [],
      sources: [],
      open: true,
      onClose: vi.fn(),
      onOpenChanges: vi.fn(),
      onOpenSubagents: vi.fn(),
      onOpenSource: vi.fn()
    }))
    expect(html).toContain('aria-label="查看变更，1 个文件"')
    expect(html).not.toContain('>子智能体<')
    expect(html).not.toContain('>来源<')
    expect(html).not.toContain('role="separator"')
  })
})

describe('project summary aggregation', () => {
  it('treats failed and interrupted agents as finished rather than running', () => {
    expect(projectSummarySubagentCounts([
      ...subagents,
      { threadId: 'failed', name: 'Failure audit', status: 'failed' },
      { threadId: 'stopped', name: 'Stopped audit', status: 'interrupted' }
    ])).toEqual({ running: 2, completed: 3 })
  })

  it('limits the compact source list without mutating source order', () => {
    expect(projectSummaryVisibleSources(sources).map((source) => source.id)).toEqual([
      'four',
      'one',
      'two'
    ])
    expect(projectSummaryVisibleSources(sources, 0)).toEqual([])
  })

  it('hydrates image thumbnails, opens local sources, and preserves right-shell interaction', () => {
    expect(popoverSource).toContain('window.codex.readThreadImage(path)')
    expect(popoverSource).toContain('[data-app-shell-tab-strip-controller="right"]')
    expect(appSource).toContain("if (source.kind === 'image') dispatchWorkspaceSourceImage(source.path)")
    expect(appSource).toContain("else dispatchWorkspaceFileLink({ path: source.path, line: null })")
    expect(workspaceSource).toContain('OPEN_WORKSPACE_SOURCE_IMAGE_EVENT')
    expect(workspaceSource).toContain("data-app-shell-tab-panel-controller={unifiedChrome ? 'right' : undefined}")
  })
})
