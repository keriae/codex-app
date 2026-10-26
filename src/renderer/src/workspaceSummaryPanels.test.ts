import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SourcesSidePanel } from './SourcesSidePanel'
import { SubagentsSidePanel, truncateWorkspacePanelPreview } from './SubagentsSidePanel'
import type { WorkspacePaneSnapshot } from './workspacePaneModel'
import type { WorkspacePanelSourceEntry, WorkspacePanelSubagentEntry } from './workspaceSummaryPanelsModel'

function snapshot(overrides: Partial<WorkspacePaneSnapshot> = {}): WorkspacePaneSnapshot {
  return {
    changes: [],
    commands: [],
    sources: [],
    collaboration: { calls: 0, agents: 0, activeAgents: 0, completedAgents: 0 },
    updating: false,
    ...overrides
  }
}

describe('SourcesSidePanel', () => {
  it('renders grouped source metadata and exposes file/image callbacks as controls', () => {
    const sources: WorkspacePanelSourceEntry[] = [
      { id: 'file', turnId: 'turn', kind: 'attachment', title: 'plan.md', metadata: '文件 · MD', purpose: '在用户消息中提及', path: '/workspace/plan.md' },
      { id: 'image', turnId: 'turn', kind: 'image', title: 'diagram.png', metadata: '图片 · PNG', purpose: '由 Codex 查看', path: '/workspace/diagram.png' },
      { id: 'web', turnId: 'turn', kind: 'web', title: 'REA guide', metadata: 'rea.tools/guides', purpose: '搜索结果 · REA', url: 'https://rea.tools/guides' }
    ]
    const html = renderToStaticMarkup(createElement(SourcesSidePanel, {
      snapshot: snapshot({ sources: sources.map(({ id, turnId, kind, title }) => ({ id, turnId, kind, label: title })) }),
      sources,
      onOpenFile: vi.fn(),
      onOpenImage: vi.fn(),
      onOpenWeb: vi.fn(),
      onClose: vi.fn()
    }))

    expect(html).toContain('aria-label="来源"')
    expect(html).toContain('附件与文件')
    expect(html).toContain('Web 搜索')
    expect(html).toContain('打开文件 plan.md')
    expect(html).toContain('打开图片 diagram.png')
    expect(html).toContain('打开网页 REA guide')
    expect(html).toContain('在用户消息中提及')
    expect(html).toContain('搜索结果 · REA')
    expect(html).toContain('aria-label="关闭来源"')
  })

  it('keeps snapshot-only entries visible without inventing an action', () => {
    const html = renderToStaticMarkup(createElement(SourcesSidePanel, {
      snapshot: snapshot({ sources: [{ id: 'source', turnId: 'turn', kind: 'attachment', label: 'unknown.txt' }] })
    }))
    expect(html).toContain('unknown.txt')
    expect(html).toContain('data-actionable="false"')
    expect(html).not.toContain('打开文件 unknown.txt')
  })
})

describe('SubagentsSidePanel', () => {
  it('renders Active and Done groups with avatars, state, previews, and selectable rows', () => {
    const subagents: WorkspacePanelSubagentEntry[] = [
      {
        threadId: 'layout-agent', turnId: 'turn', name: 'Layout Agent', status: 'active', statusLabel: '开始工作',
        preview: 'Comparing the workspace summary card against the recorded split panel geometry', model: 'gpt-6.1-sol', selectable: true
      },
      {
        threadId: 'test-agent', turnId: 'turn', name: 'Test Agent', status: 'completed', statusLabel: '已完成',
        preview: 'Focused tests passed', selectable: true
      }
    ]
    const html = renderToStaticMarkup(createElement(SubagentsSidePanel, {
      snapshot: snapshot({ collaboration: { calls: 2, agents: 2, activeAgents: 1, completedAgents: 1 } }),
      subagents,
      previewCharacters: 36,
      onSelectAgent: vi.fn(),
      onClose: vi.fn()
    }))

    expect(html).toContain('data-agent-group="active"')
    expect(html).toContain('data-agent-group="done"')
    expect(html).toContain('打开子智能体 Layout Agent，开始工作')
    expect(html).toContain('打开子智能体 Test Agent，已完成')
    expect(html).toContain('Comparing the workspace summary car…')
    expect(html).toContain('gpt-6.1-sol')
    expect(html).toContain('aria-label="关闭子智能体"')
    expect(html).not.toContain('disabled=""')
  })

  it('disables aggregate snapshot rows because they do not carry a real thread identity', () => {
    const html = renderToStaticMarkup(createElement(SubagentsSidePanel, {
      snapshot: snapshot({ collaboration: { calls: 1, agents: 1, activeAgents: 1, completedAgents: 0 } }),
      onSelectAgent: vi.fn()
    }))
    expect(html).toContain('正在工作的子智能体')
    expect(html).toContain('disabled=""')
  })

  it('truncates previews at a deterministic character boundary', () => {
    expect(truncateWorkspacePanelPreview('0123456789', 6)).toBe('01234…')
    expect(truncateWorkspacePanelPreview('short', 20)).toBe('short')
  })
})
