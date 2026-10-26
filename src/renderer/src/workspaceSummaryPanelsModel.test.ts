import { describe, expect, it } from 'vitest'
import type { ThreadSession } from './state/sessionReducer'
import type { WorkspacePaneSnapshot } from './workspacePaneModel'
import {
  collectWorkspaceSummaryPanelsModel,
  workspacePanelSubagentIsDone,
  workspacePanelSubagentsFromSnapshot
} from './workspaceSummaryPanelsModel'

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

describe('workspace summary side-panel model', () => {
  it('derives actionable files, images, web results, and their uses', () => {
    const session: ThreadSession = {
      activeTurnId: null,
      running: false,
      error: null,
      turns: [{
        id: 'turn-1',
        status: 'completed',
        items: [
          {
            type: 'userMessage',
            id: 'user-1',
            content: [
              { type: 'localImage', path: '/tmp/codex-clipboard.png' },
              { type: 'mention', name: 'Plan', path: '/workspace/docs/plan.md' }
            ]
          },
          { type: 'imageView', id: 'image-1', path: '/tmp/codex-clipboard.png' },
          { type: 'imageGeneration', id: 'generated-1', status: 'completed', savedPath: '/workspace/generated/diagram.png' },
          {
            type: 'webSearch',
            id: 'search-1',
            query: 'REA evidence workflow',
            result: {
              content: [{ type: 'resource_link', uri: 'https://rea.tools/guides/evidence', name: 'Evidence guide' }]
            }
          }
        ]
      }]
    }

    const value = collectWorkspaceSummaryPanelsModel(session, snapshot({
      sources: [
        { id: 'turn-1:user-1:image:/tmp/codex-clipboard.png', turnId: 'turn-1', kind: 'image', label: 'codex-clipboard.png' },
        { id: 'turn-1:user-1:attachment:/workspace/docs/plan.md', turnId: 'turn-1', kind: 'attachment', label: 'plan.md' },
        { id: 'turn-1:search-1:web', turnId: 'turn-1', kind: 'web', label: 'REA evidence workflow' }
      ]
    }))
    expect(value.sources).toHaveLength(4)
    expect(value.sources.find((source) => source.path === '/tmp/codex-clipboard.png')).toMatchObject({
      kind: 'image',
      title: 'codex-clipboard.png',
      metadata: '图片 · PNG',
      purpose: '附加到用户消息 · 由 Codex 查看'
    })
    expect(value.sources.find((source) => source.path === '/workspace/docs/plan.md')).toMatchObject({
      kind: 'attachment', title: 'Plan', purpose: '在用户消息中提及'
    })
    expect(value.sources.find((source) => source.path === '/workspace/generated/diagram.png')).toMatchObject({
      kind: 'image', metadata: '生成图片 · completed', purpose: '由 Codex 生成'
    })
    expect(value.sources.find((source) => source.url === 'https://rea.tools/guides/evidence')).toMatchObject({
      kind: 'web', title: 'Evidence guide', metadata: 'rea.tools/guides/evidence', purpose: '搜索结果 · REA evidence workflow'
    })
  })

  it('keeps the latest state per subagent and separates active from terminal states', () => {
    const session: ThreadSession = {
      activeTurnId: 'turn-1',
      running: true,
      error: null,
      turns: [{
        id: 'turn-1',
        status: 'inProgress',
        items: [{
          type: 'collabAgentToolCall',
          id: 'agents-1',
          status: 'inProgress',
          receiverThreadIds: ['agent-layout', 'agent-tests'],
          agentsStates: {
            'agent-layout': { status: 'running', agentNickname: 'Layout Agent', summary: 'Comparing the split workspace geometry', model: 'gpt-6.1-sol' },
            'agent-tests': { status: 'completed', agentNickname: 'Test Agent', lastAgentMessage: 'All focused tests passed' }
          }
        }]
      }]
    }
    const value = collectWorkspaceSummaryPanelsModel(session, snapshot({
      collaboration: { calls: 1, agents: 2, activeAgents: 1, completedAgents: 1 },
      updating: true
    }))

    expect(value.subagents).toHaveLength(2)
    expect(value.subagents.find((entry) => entry.threadId === 'agent-layout')).toMatchObject({
      name: 'Layout Agent', status: 'active', preview: 'Comparing the split workspace geometry', model: 'gpt-6.1-sol', selectable: true
    })
    const completed = value.subagents.find((entry) => entry.threadId === 'agent-tests')
    expect(completed).toMatchObject({ name: 'Test Agent', status: 'completed', preview: 'All focused tests passed' })
    expect(completed && workspacePanelSubagentIsDone(completed)).toBe(true)
  })

  it('uses non-actionable aggregate rows when only snapshot counts are available', () => {
    const entries = workspacePanelSubagentsFromSnapshot(snapshot({
      collaboration: { calls: 2, agents: 5, activeAgents: 2, completedAgents: 3 }
    }))
    expect(entries).toEqual([
      expect.objectContaining({ threadId: '__workspace-active-agents__', preview: '2 个运行中', selectable: false }),
      expect.objectContaining({ threadId: '__workspace-completed-agents__', preview: '3 完成', selectable: false })
    ])
  })
})
