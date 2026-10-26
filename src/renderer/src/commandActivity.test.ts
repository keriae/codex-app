import { describe, expect, it } from 'vitest'
import {
  commandActivityCopy,
  commandElapsedLabel,
  commandActivityRows,
  completedActivityBatches,
  completedActivitySummary,
  completedCommandActivityBatches,
  completedCommandActivitySummary,
  conversationActivityUnits
} from './commandActivity'
import type { CommandItem, ThreadItem } from './protocol'

function command(overrides: Partial<CommandItem>): CommandItem {
  return {
    type: 'commandExecution',
    id: 'command-1',
    command: 'zsh -lc true',
    status: 'inProgress',
    ...overrides
  }
}

describe('command activity presentation', () => {
  it('uses the structured read action instead of exposing the shell command', () => {
    expect(
      commandActivityCopy(
        command({
          commandActions: [
            {
              type: 'read',
              command: "sed -n '1,120p' src/renderer/src/App.tsx",
              name: 'App.tsx',
              path: '/repo/src/renderer/src/App.tsx'
            }
          ]
        })
      )
    ).toEqual({ kind: 'read', action: '正在读取', detail: 'App.tsx' })
  })

  it('matches the recorded folder-search wording', () => {
    expect(
      commandActivityCopy(
        command({
          commandActions: [
            {
              type: 'search',
              command: "rg --files src",
              query: null,
              path: '/repo/src'
            }
          ]
        })
      )
    ).toEqual({
      kind: 'search',
      action: '正在搜索',
      detail: '/repo/src 文件夹中的文件'
    })
  })

  it('uses the parsed inner command for generic command details', () => {
    expect(
      commandActivityCopy(
        command({
          command: 'zsh',
          commandActions: [
            { type: 'unknown', command: 'zsh' },
            { type: 'unknown', command: 'npm run build' }
          ]
        })
      )
    ).toEqual({ kind: 'command', action: '正在运行', detail: 'npm run build' })
  })

  it('preserves all parsed actions in order with their original completed copy and raw commands', () => {
    const item = command({
      status: 'completed',
      durationMs: 1250,
      commandActions: [
        { type: 'unknown', command: '/bin/zsh -lc echo' },
        { type: 'read', command: 'cat ./src/a.ts', name: './src/a.ts', path: '/repo/src/a.ts' },
        { type: 'search', command: 'rg name src', query: 'name', path: 'src' },
        { type: 'listFiles', command: 'ls src', path: 'src' },
        { type: 'unknown', command: '  npm test  ' }
      ]
    })
    expect(commandActivityRows(item)).toEqual([
      { kind: 'read', action: '已读取', detail: 'src/a.ts', command: 'cat ./src/a.ts', durationMs: 1250, path: '/repo/src/a.ts' },
      { kind: 'search', action: '已在', detail: 'src 中搜索“name”', command: 'rg name src', durationMs: 1250, path: 'src' },
      { kind: 'listFiles', action: '已列出', detail: 'src 中的文件', command: 'ls src', durationMs: 1250, path: 'src' },
      { kind: 'command', action: '已在 1s 内运行', detail: 'npm test', command: '  npm test  ', durationMs: 1250, path: null }
    ])
  })

  it('keeps active path normalization distinct from the completed read name', () => {
    const item = command({
      commandActions: [{ type: 'read', command: 'cat a', name: './src\\different-name.ts', path: './src\\actual-name.ts' }]
    })
    expect(commandActivityCopy(item).detail).toBe('actual-name.ts')
    expect(commandActivityRows({ ...item, status: 'completed' })[0].detail).toBe('src/different-name.ts')
    expect(commandActivityCopy(command({ commandActions: [{ type: 'listFiles', command: 'ls 1', path: '1' }] }))).toEqual({
      kind: 'listFiles', action: '正在列出', detail: '1 文件夹中的文件'
    })
  })

  it('uses completed query-only and generic-list wording exactly', () => {
    const item = command({ status: 'completed', commandActions: [
      { type: 'search', command: 'rg hello', query: 'hello' },
      { type: 'search', command: 'rg --files src', path: 'src' },
      { type: 'listFiles', command: 'ls' }
    ] })
    expect(commandActivityRows(item).map(({ action, detail }) => ({ action, detail }))).toEqual([
      { action: '已对', detail: '“hello”进行搜索' },
      { action: '已搜索', detail: '文件' },
      { action: '已列出的', detail: '文件' }
    ])
  })

  it('handles malformed action snapshots and future classifications as generic commands', () => {
    const item = command({ status: 'completed', durationMs: Number.NaN,
      commandActions: [null, {}, { type: 'search', command: 3 }, { type: 'future', command: 'new-tool --help' }] as unknown as CommandItem['commandActions']
    })
    expect(commandActivityRows(item)).toEqual([
      { kind: 'command', action: '已运行', detail: 'new-tool --help', command: 'new-tool --help', durationMs: null, path: null }
    ])
    expect(completedActivitySummary([item])).toEqual({ kind: 'commands', label: '运行了命令' })
  })

  it('uses the generic command label for blank commands and omits shell-launcher-only rows', () => {
    expect(commandActivityCopy(command({ command: '' }))).toEqual({ kind: 'command', action: '正在运行命令', detail: null })
    expect(commandActivityRows(command({ command: '', status: 'completed' }))[0]).toMatchObject({ action: '已运行命令', detail: null })
    expect(commandActivityRows(command({ commandActions: [{ type: 'unknown', command: '/bin/zsh -lc true' }] }))).toEqual([])
  })

  it.each([[999, null], [1999, '1s'], [60000, '1m 0s'], [3600000, '1h 0m 0s'], [86400000, '1d 0h 0m 0s']] as const)(
    'formats %i ms with the original English narrow elapsed units', (duration, label) => {
      expect(commandElapsedLabel(duration)).toBe(label)
    }
  )

  it('uses elapsed text inside the generic command action rather than an extra trailing label', () => {
    expect(commandActivityRows(command({ command: 'npm test', status: 'completed', durationMs: 2000 }))[0]).toMatchObject({ action: '已在 2s 内运行', detail: 'npm test' })
    expect(commandActivityRows(command({ command: '', status: 'completed', durationMs: 2000 }))[0]).toMatchObject({ action: '命令已在 2s 内运行完成', detail: null })
    expect(commandActivityRows(command({ command: 'npm test', status: 'inProgress', durationMs: 2000 }))[0]).toMatchObject({ action: '命令已运行 2s', detail: null })
  })

  it('aggregates completed exploration and commands like the recorded client', () => {
    const items = [
      command({
        id: 'read',
        status: 'completed',
        commandActions: [
          { type: 'read', command: 'sed App.tsx', name: 'App.tsx', path: '/repo/App.tsx' }
        ]
      }),
      command({
        id: 'run',
        status: 'completed',
        commandActions: [{ type: 'unknown', command: 'npm test' }]
      })
    ]

    expect(completedCommandActivitySummary(items)).toEqual({
      kind: 'exploration',
      label: '已读取文件运行了命令'
    })
  })

  it('uses the fixed exploration-before-commands summary order even when a command came first', () => {
    expect(completedCommandActivitySummary([
      command({ id: 'run', status: 'completed', commandActions: [{ type: 'unknown', command: 'npm test' }] }),
      command({ id: 'read', status: 'completed', commandActions: [{ type: 'read', command: 'cat a', name: 'a', path: '/repo/a' }] })
    ])).toEqual({ kind: 'exploration', label: '已读取文件运行了命令' })
  })

  it('groups mixed file changes and commands and deduplicates edits by change kind and path', () => {
    const run = command({ id: 'run', status: 'completed', commandActions: [{ type: 'unknown', command: 'npm test' }] })
    const read = command({ id: 'read', status: 'completed', commandActions: [{ type: 'read', command: 'cat a', name: 'a', path: '/repo/a' }] })
    const first: ThreadItem = { type: 'fileChange', id: 'patch-a', status: 'completed', changes: [{ path: 'a.ts', kind: { type: 'update', move_path: null }, diff: '+a' }] }
    const repeated: ThreadItem = { type: 'fileChange', id: 'patch-a-again', status: 'completed', changes: [{ path: 'a.ts', kind: { type: 'update', move_path: null }, diff: '+b' }] }
    const items = [run, read, first, repeated]
    expect(completedActivityBatches(items)).toEqual([
      { firstItemId: 'run', itemIds: ['run', 'read', 'patch-a', 'patch-a-again'], items, summary: { kind: 'edits', label: '编辑了一个文件读取文件运行了命令' } }
    ])
    expect(completedActivitySummary([first, { type: 'fileChange', id: 'patch-b', status: 'completed', changes: [{ path: 'b.ts', kind: { type: 'add' }, diff: '+b' }] }])).toEqual({ kind: 'edits', label: '编辑了文件' })
  })

  it('summarizes named integrations, unnamed tools, web search and native dynamic calls in source order', () => {
    const items: ThreadItem[] = [
      { type: 'mcpToolCall', id: 'github', status: 'completed', server: 'codex_apps', tool: 'search_issues', appContext: { appName: 'GitHub' } },
      { type: 'mcpToolCall', id: 'slack', status: 'completed', server: 'codex_apps', tool: 'search', matchingApp: { name: 'Slack' } },
      { type: 'mcpToolCall', id: 'unnamed', status: 'completed', server: 'custom', tool: 'read' },
      { type: 'webSearch', id: 'web', status: 'completed', query: 'Codex' },
      { type: 'dynamicToolCall', id: 'native', status: 'completed', namespace: 'codex_app', tool: 'read_thread_terminal' }
    ]
    expect(completedActivitySummary(items)).toEqual({
      kind: 'tools',
      label: '已使用 GitHub和Slack 集成调用了一个工具已搜索网页已读取终端'
    })
    expect(completedActivityBatches(items)).toEqual([{
      firstItemId: 'github', itemIds: items.map(({ id }) => id), items,
      summary: { kind: 'tools', label: '已使用 GitHub和Slack 集成调用了一个工具已搜索网页已读取终端' }
    }])
  })

  it('projects hidden reasoning through a group and standalone activity as a hard boundary', () => {
    const items: ThreadItem[] = [
      command({ id: 'before', status: 'completed' }),
      { type: 'reasoning', id: 'reasoning', summary: ['Checking'], content: [] },
      { type: 'webSearch', id: 'web', status: 'completed', query: 'Codex' },
      { type: 'contextCompaction', id: 'compaction', status: 'completed' },
      command({ id: 'after', status: 'completed' })
    ]
    expect(conversationActivityUnits(items)).toMatchObject([
      { kind: 'group', items: [{ id: 'before' }, { id: 'web' }] },
      { kind: 'standalone', item: { id: 'compaction' } },
      { kind: 'standalone', item: { id: 'after' } }
    ])
  })

  it('keeps only the latest in-progress groupable row in the live projection', () => {
    const items: ThreadItem[] = [
      command({ id: 'older', status: 'inProgress' }),
      { type: 'webSearch', id: 'latest', status: 'inProgress', query: 'Codex' }
    ]
    expect(conversationActivityUnits(items, true)).toMatchObject([
      { kind: 'standalone', item: { id: 'latest' } }
    ])
  })

  it.each([
    ['web search', { type: 'webSearch', id: 'completed-web-search', status: 'completed', query: 'Codex' }],
    ['MCP call', { type: 'mcpToolCall', id: 'completed-mcp', status: 'completed', server: 'example', tool: 'read_info' }],
    ['dynamic tool', { type: 'dynamicToolCall', id: 'completed-dynamic', status: 'completed', namespace: 'codex_app', tool: 'read_thread_terminal' }]
  ] as const)('unwraps a completed singleton %s into a standalone row', (_label, item) => {
    expect(conversationActivityUnits([item as ThreadItem])).toMatchObject([
      { kind: 'standalone', item: { id: item.id } }
    ])
  })

  it('unwraps a completed single-file change into a standalone row', () => {
    const item: ThreadItem = {
      type: 'fileChange',
      id: 'single-file-change',
      status: 'completed',
      changes: [{ path: 'src/a.ts', kind: { type: 'update', move_path: null }, diff: '+a' }]
    }

    expect(conversationActivityUnits([item])).toMatchObject([
      { kind: 'standalone', item: { id: 'single-file-change' } }
    ])
  })

  it('preserves singleton file-change groups for multiple files or visualization activity', () => {
    const multiFile: ThreadItem = {
      type: 'fileChange',
      id: 'multi-file-change',
      status: 'completed',
      changes: [
        { path: 'src/a.ts', kind: { type: 'update', move_path: null }, diff: '+a' },
        { path: 'src/b.ts', kind: { type: 'add' }, diff: '+b' }
      ]
    }
    const visualized = {
      type: 'fileChange',
      id: 'visualized-file-change',
      status: 'completed',
      changes: [{ path: 'src/chart.ts', kind: { type: 'update', move_path: null }, diff: '+chart' }],
      visualizationActivities: [{ id: 'chart-preview' }]
    } as ThreadItem

    expect(conversationActivityUnits([multiFile])).toMatchObject([
      { kind: 'group', items: [{ id: 'multi-file-change' }], summary: { kind: 'edits' } }
    ])
    expect(conversationActivityUnits([visualized])).toMatchObject([
      { kind: 'group', items: [{ id: 'visualized-file-change' }], summary: { kind: 'edits' } }
    ])
  })

  it('keeps completed commands standalone when an image separates them', () => {
    const before = command({
      id: 'before-image',
      status: 'completed',
      durationMs: 1_000,
      commandActions: [{ type: 'unknown', command: 'node capture-before.mjs' }]
    })
    const image: ThreadItem = {
      type: 'imageView',
      id: 'captured-image',
      path: '/tmp/capture.png'
    }
    const after = command({
      id: 'after-image',
      status: 'completed',
      durationMs: 2_000,
      commandActions: [{ type: 'unknown', command: 'node capture-after.mjs' }]
    })

    expect(conversationActivityUnits([before, image, after])).toMatchObject([
      { kind: 'standalone', item: { id: 'before-image' } },
      { kind: 'standalone', item: { id: 'captured-image' } },
      { kind: 'standalone', item: { id: 'after-image' } }
    ])
  })

  it('preserves completed singleton groups when the host context requests it', () => {
    const item = command({
      id: 'preserved-command',
      status: 'completed',
      commandActions: [{ type: 'unknown', command: 'npm test' }]
    })

    expect(conversationActivityUnits([item], false, {
      preserveSingleItemGroups: true
    })).toMatchObject([
      { kind: 'group', items: [{ id: 'preserved-command' }] }
    ])
  })

  it('preserves only the final singleton group when it owns the completed header', () => {
    const before = command({
      id: 'before-completed-header',
      status: 'completed',
      commandActions: [{ type: 'unknown', command: 'npm run before' }]
    })
    const image: ThreadItem = {
      type: 'imageView',
      id: 'completed-header-boundary',
      path: '/tmp/capture.png'
    }
    const after = command({
      id: 'after-completed-header',
      status: 'completed',
      commandActions: [{ type: 'unknown', command: 'npm run after' }]
    })

    expect(conversationActivityUnits([before, image, after], false, {
      completedHeader: true
    })).toMatchObject([
      { kind: 'standalone', item: { id: 'before-completed-header' } },
      { kind: 'standalone', item: { id: 'completed-header-boundary' } },
      { kind: 'group', items: [{ id: 'after-completed-header' }] }
    ])
  })

  it('groups across hidden reasoning and breaks at visible commentary, subagent activity and active edits', () => {
    const completed = (id: string): CommandItem => command({ id, command: 'npm test', status: 'completed' })
    const items: ThreadItem[] = [
      completed('a'),
      { type: 'agentMessage', id: 'commentary', text: '检查', phase: 'commentary' },
      completed('b'),
      { type: 'reasoning', id: 'reasoning', summary: [], content: [] },
      completed('c'),
      { type: 'subAgentActivity', id: 'subagent' },
      completed('d'),
      { type: 'fileChange', id: 'active-edit', status: 'inProgress', changes: [] },
      completed('e')
    ]
    expect(completedActivityBatches(items).map((batch) => batch.itemIds)).toEqual([['a'], ['b', 'c'], ['d'], ['e']])
  })

  it('starts a new completed-command summary after commentary', () => {
    const items: ThreadItem[] = [
      command({
        id: 'read-before-commentary',
        status: 'completed',
        commandActions: [
          { type: 'read', command: 'sed App.tsx', name: 'App.tsx', path: '/repo/App.tsx' }
        ]
      }),
      {
        type: 'agentMessage',
        id: 'commentary',
        text: '接下来检查构建结果。',
        phase: 'commentary'
      },
      command({
        id: 'run-after-commentary',
        status: 'completed',
        commandActions: [{ type: 'unknown', command: 'npm test' }]
      })
    ]

    expect(completedCommandActivityBatches(items)).toEqual([
      {
        firstItemId: 'read-before-commentary',
        itemIds: ['read-before-commentary'],
        summary: { kind: 'exploration', label: '已读取文件' }
      },
      {
        firstItemId: 'run-after-commentary',
        itemIds: ['run-after-commentary'],
        summary: { kind: 'commands', label: '运行了命令' }
      }
    ])
  })

  it('uses an active command as a completed batch boundary', () => {
    const items: ThreadItem[] = [
      command({ id: 'read-1', status: 'completed', commandActions: [{ type: 'read', command: 'cat a', name: 'a', path: '/repo/a' }] }),
      command({ id: 'read-2', status: 'completed', commandActions: [{ type: 'search', command: 'rg x', query: 'x', path: '/repo' }] }),
      { type: 'reasoning', id: 'reasoning', summary: ['继续检查'], content: [] },
      command({ id: 'active', status: 'inProgress' }),
      command({ id: 'run', status: 'completed', commandActions: [{ type: 'unknown', command: 'npm run build' }] })
    ]

    expect(completedCommandActivityBatches(items).map((batch) => batch.itemIds)).toEqual([
      ['read-1', 'read-2'],
      ['run']
    ])
  })
})
