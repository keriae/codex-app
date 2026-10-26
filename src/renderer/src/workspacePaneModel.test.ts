import { describe, expect, it } from 'vitest'
import {
  type WorkspacePaneSnapshot,
  workspacePaneCloseAction,
  workspacePaneSummary,
  workspacePaneSummaryItems
} from './workspacePaneModel'

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

describe('workspace pane summary model', () => {
  it('describes changes, live/completed agents, source preview, and command output', () => {
    const value = snapshot({
      changes: [{
        id: 'change',
        itemId: 'change-item',
        turnId: 'turn',
        path: '/project/App.tsx',
        sourcePath: '/project/App.tsx',
        diff: '-old\n+new\n+more',
        kind: 'modified',
        status: 'completed',
        additions: 2,
        deletions: 1
      }],
      commands: [{
        id: 'command',
        turnId: 'turn',
        command: 'npm test',
        status: 'completed',
        output: 'ok'
      }],
      sources: [
        { id: 'one', turnId: 'turn', kind: 'image', label: 'codex-clipboard-one.png' },
        { id: 'two', turnId: 'turn', kind: 'attachment', label: 'notes.md' },
        { id: 'three', turnId: 'turn', kind: 'web', label: 'Codex docs' }
      ],
      collaboration: { calls: 4, agents: 42, activeAgents: 3, completedAgents: 39 }
    })

    expect(workspacePaneSummaryItems(value)).toEqual([
      { kind: 'changes', label: '变更', detail: '1 个文件 · +2 −1' },
      { kind: 'collaboration', label: '子智能体', detail: '3 个运行中 · 39 完成' },
      { kind: 'sources', label: '来源', detail: 'codex-clipboard-one.png 等 3 项' },
      { kind: 'output', label: '输出', detail: '1 条命令' }
    ])
  })

  it('keeps completed collaboration and a single source informative', () => {
    const value = snapshot({
      sources: [{ id: 'source', turnId: 'turn', kind: 'attachment', label: 'brief.md' }],
      collaboration: { calls: 1, agents: 2, activeAgents: 0, completedAgents: 2 }
    })

    expect(workspacePaneSummaryItems(value)).toEqual([
      { kind: 'collaboration', label: '子智能体', detail: '2 完成' },
      { kind: 'sources', label: '来源', detail: 'brief.md' }
    ])
  })

  it('uses stable empty and updating labels for the compact card', () => {
    expect(workspacePaneSummary(snapshot())).toBe('创建文件或站点')
    expect(workspacePaneSummary(snapshot({ updating: true }))).toBe('正在收集工作区活动…')
  })
})

describe('workspace pane close routing', () => {
  it('closes the visible content before collapsing the retained workspace', () => {
    expect(workspacePaneCloseAction({
      activeTab: 'sources',
      hasDisplayedChange: false,
      hasSourceImage: true,
      hasActiveDocument: true
    })).toBe('close-summary')
    expect(workspacePaneCloseAction({
      activeTab: 'changes',
      hasDisplayedChange: true,
      hasSourceImage: true,
      hasActiveDocument: true
    })).toBe('close-change')
    expect(workspacePaneCloseAction({
      activeTab: 'files',
      hasDisplayedChange: false,
      hasSourceImage: true,
      hasActiveDocument: true
    })).toBe('close-source-image')
    expect(workspacePaneCloseAction({
      activeTab: 'files',
      hasDisplayedChange: false,
      hasSourceImage: false,
      hasActiveDocument: true
    })).toBe('close-document')
    expect(workspacePaneCloseAction({
      activeTab: 'output',
      hasDisplayedChange: false,
      hasSourceImage: false,
      hasActiveDocument: true
    })).toBe('collapse')
    expect(workspacePaneCloseAction({
      activeTab: 'changes',
      hasDisplayedChange: false,
      hasSourceImage: true,
      hasActiveDocument: true
    })).toBe('collapse')
  })
})
