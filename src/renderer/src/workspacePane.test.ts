import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  CodeViewer,
  FileTreeView,
  WorkspacePane,
  collectVisibleWorkspaceTreeItems,
  workspaceTreeKeyboardAction,
  type DirectoryLoadState
} from './WorkspacePane'
import type { ThreadSession } from './state/sessionReducer'

const workspacePaneStyles = readFileSync(new URL('./WorkspacePane.css', import.meta.url), 'utf8')
const appStyles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const workspacePaneSource = readFileSync(new URL('./WorkspacePane.tsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

describe('WorkspacePane primary surface rendering', () => {
  it('keeps the tab context menu keyboard-operable and reports clipboard failures', () => {
    expect(workspacePaneSource).toContain('aria-label="标签页操作"')
    expect(workspacePaneSource).toContain("event.key !== 'ArrowDown' && event.key !== 'ArrowUp'")
    expect(workspacePaneSource).toContain('navigator.clipboard.writeText(path)')
    expect(workspacePaneSource).toContain('setFileActionError(workspaceErrorMessage(error))')
    expect(workspacePaneSource).toContain('aria-expanded={entry.isDirectory ? isExpanded : undefined}')
  })

  it('uses the measured workspace width for the legacy titlebar portal', () => {
    expect(appStyles).toContain(
      'var(--workspace-titlebar-width, var(--right-workbench-width))'
    )
  })

  it('maps the complete workspace surface onto the light appearance palette', () => {
    const lightTheme = workspacePaneStyles.slice(
      workspacePaneStyles.indexOf(":root[data-theme='light'] .workspace-pane.workspace-pane-collapsed")
    )

    expect(workspacePaneStyles).not.toContain('var(--hover)')
    expect(lightTheme).toContain(":root[data-theme='light'] .workspace-pane.workspace-pane-collapsed")
    expect(lightTheme).toContain('background: var(--main-raised)')
    expect(lightTheme).toContain(":root[data-theme='light'] .workspace-navigator")
    expect(lightTheme).toContain('border-left-color: var(--border)')
    expect(lightTheme).toContain(":root[data-theme='light'] .workspace-token.is-keyword")
    expect(lightTheme).toContain('color: #af00db')
    expect(lightTheme).toContain(":root[data-theme='light'] .workspace-tree-row.is-selected")
    expect(lightTheme).toContain(":root[data-theme='light'] .workspace-file-context-menu")
  })

  it('full default leaves unopened content collapsed', () => {
    const html = renderToStaticMarkup(createElement(WorkspacePane, { session: undefined, cwd: '/synthetic/workspace', layoutMode: 'full' }))
    expect(html).toContain('data-workspace-layout="full"')
    expect(html).toContain('data-workspace-primary="chat"')
    expect(html).toContain('workspace-pane-collapsed')
    expect(html).toContain('data-summary-panel-density="compact"')
    expect(html).toContain('data-summary-kind="changes"')
    expect(html).toContain('data-summary-tab="changes"')
    expect(html).not.toContain('workspace-pane-expanded')
    expect(html).not.toContain('Back to chat')
  })

  it('renders the recorded rich summary sections from live workspace activity', () => {
    const session: ThreadSession = {
      activeTurnId: 'turn-1',
      running: true,
      error: null,
      turns: [{
        id: 'turn-1',
        status: 'inProgress',
        items: [
          {
            type: 'userMessage',
            id: 'user-1',
            content: [
              { type: 'localImage', path: '/tmp/codex-clipboard-one.png' },
              { type: 'mention', name: 'notes', path: '/tmp/project-notes.md' }
            ]
          },
          {
            type: 'webSearch',
            id: 'search-1',
            query: 'Codex workspace summary'
          },
          {
            type: 'fileChange',
            id: 'change-1',
            status: 'completed',
            changes: [{ path: 'src/App.tsx', kind: { type: 'update', move_path: null }, diff: '-old\n+new' }]
          },
          {
            type: 'collabAgentToolCall',
            id: 'agents-1',
            status: 'inProgress',
            agentsStates: {
              agentA: { status: 'running' },
              agentB: { status: 'pendingInit' },
              agentC: { status: 'completed' }
            }
          },
          {
            type: 'commandExecution',
            id: 'command-1',
            command: 'npm test',
            status: 'completed',
            aggregatedOutput: 'ok'
          }
        ]
      }]
    }

    const html = renderToStaticMarkup(createElement(WorkspacePane, { session, cwd: '/synthetic/workspace' }))
    expect(html).toContain('data-summary-panel-density="detailed"')
    expect(html).toContain('data-summary-kind="changes"')
    expect(html).toContain('data-summary-kind="collaboration"')
    expect(html).toContain('data-summary-kind="sources"')
    expect(html).not.toContain('data-summary-kind="output"')
    expect(html).toContain('data-summary-tab="changes"')
    expect(html).toContain('data-summary-tab="subagents"')
    expect(html).toContain('data-summary-tab="sources"')
    expect(html).not.toContain('data-summary-tab="output"')
    expect(html).toContain('2 个运行中')
    expect(html).toContain('1 完成')
    expect(html).toContain('codex-clipboard-one.png')
    expect(html).toContain('project-notes.md')
    expect(html).toContain('Codex workspace summary')
    expect(html).toContain('查看全部')
  })

  it('adapts the compact card across the recorded and installed output-track geometry', () => {
    const compactRule = workspacePaneStyles.match(/\.workspace-pane\.workspace-pane-collapsed \{[\s\S]*?\n\}/)?.[0] || ''
    const detailedRule = workspacePaneStyles.match(/\.workspace-pane\.workspace-pane-collapsed\.is-detailed \{[\s\S]*?\n\}/)?.[0] || ''

    expect(compactRule).toContain('--workspace-summary-card-inset: clamp(5px, calc(300px - var(--output-track-width)), 8px)')
    expect(compactRule).toContain('284px,')
    expect(compactRule).toContain('300px')
    expect(compactRule).toContain('--workspace-summary-card-height: clamp(75px, calc(var(--output-track-width) - 227px), 78px)')
    expect(compactRule).toContain('--workspace-summary-card-radius: clamp(16px, calc(var(--output-track-width) - 287px), 18px)')
    expect(compactRule).toContain('height: var(--workspace-summary-card-height)')
    expect(detailedRule).toContain('height: auto')
    expect(detailedRule).toContain('max-height: calc(100vh - 16px)')
    expect(detailedRule).toContain('overscroll-behavior: contain')
  })

  it('opened full content exposes returning to chat and switching layout', () => {
    const html = renderToStaticMarkup(createElement(WorkspacePane, { session: undefined, layoutMode: 'full', initialExpanded: true }))
    expect(html).toContain('workspace-pane-expanded')
    expect(html).toContain('data-workspace-primary="content"')
    expect(html).toContain('aria-label="Back to chat"')
    expect(html).toContain('aria-label="Toggle workspace full view" aria-pressed="true"')
    expect(html).toContain('title="Split view"')
  })

  it('opened split content retains its separate close and full-view controls', () => {
    const html = renderToStaticMarkup(createElement(WorkspacePane, {
      session: undefined,
      layoutMode: 'split',
      initialExpanded: true,
      resizeHandle: createElement('span', {'data-workspace-resize-handle': 'true'})
    }))
    expect(html).toContain('data-workspace-layout="split"')
    expect(html).toContain('data-workspace-primary="content"')
    expect(html).toContain('data-workspace-resize-handle="true"')
    expect(html).toContain('aria-label="Close workspace"')
    expect(html).toContain('title="Full view"')
    expect(html).not.toContain('aria-label="Back to chat"')
  })

  it('does not render the split separator in workspace full view', () => {
    const html = renderToStaticMarkup(createElement(WorkspacePane, {
      session: undefined,
      layoutMode: 'full',
      initialExpanded: true,
      resizeHandle: createElement('span', {'data-workspace-resize-handle': 'true'})
    }))
    expect(html).not.toContain('data-workspace-resize-handle="true"')
  })

  it.each(['hidden right workbench', 'full-view chat tab'])(
    'keeps expanded workspace content mounted but inactive for %s',
    () => {
      const html = renderToStaticMarkup(createElement(WorkspacePane, {
        session: undefined,
        layoutMode: 'full',
        initialExpanded: true,
        integratedChrome: true,
        workbenchVisible: false
      }))

      expect(html).toContain('workspace-pane-expanded')
      expect(html).toContain('workspace-pane-unified')
      expect(html).toContain('is-workbench-inactive')
      expect(html).toContain('data-workspace-primary="content"')
      expect(html).not.toContain('workspace-pane-collapsed')
    }
  )

  it.each(['hidden right workbench', 'full-view chat tab'])(
    'retains the collapsed workspace summary while %s owns the conversation surface',
    () => {
      const html = renderToStaticMarkup(createElement(WorkspacePane, {
        session: undefined,
        cwd: '/synthetic/workspace',
        layoutMode: 'full',
        integratedChrome: true,
        workbenchVisible: true
      }))

      expect(html).toContain('workspace-pane-collapsed')
      expect(html).toContain('data-workspace-primary="chat"')
      expect(html).toContain('data-summary-panel-variant="summary"')
      expect(html).not.toContain('is-workbench-inactive')
      expect(html).not.toContain('workspace-pane-expanded')
    }
  )

  it('wires expanded content visibility separately from the always-available collapsed summary', () => {
    expect(appSource).toContain('workbenchVisible={workspaceOpen')
    expect(appSource).toContain(
      "? rightWorkbenchOpen && !rightWorkbenchChatSelected && visibleRightSurface === 'workspace'"
    )
    expect(appSource).toContain(': projectSummaryInlineVisible}')
  })
})

describe('WorkspacePane code preview', () => {
  it('renders the validated raster returned by the workspace bridge', () => {
    const html = renderToStaticMarkup(createElement(CodeViewer, {
      cwd: '/project', path: '/project/image.png', file: {status: 'ready', result: {
        path: '/project/image.png', kind: 'image', mimeType: 'image/png', dataBase64: 'fixture', sizeBytes: 10
      }}, targetLine: null, onRetry: () => {}
    }))
    expect(html).toContain('src="data:image/png;base64,fixture"')
    expect(html).toContain('alt="image.png"')
    expect(html).not.toContain('源码工作区不会显示二进制内容')
  })
  it('marks the requested source line as the scroll target', () => {
    const html = renderToStaticMarkup(
      createElement(CodeViewer, {
        cwd: '/workspace/codex-app',
        path: '/workspace/codex-app/src/App.tsx',
        file: {
          status: 'ready',
          result: {
            path: '/workspace/codex-app/src/App.tsx',
            kind: 'text',
            mimeType: 'text/typescript',
            text: 'first line\nconst target = true\nthird line',
            sizeBytes: 48
          }
        },
        targetLine: 2,
        onRetry: () => undefined
      })
    )

    expect(html).toContain('class="workspace-source-line is-target-line"')
    expect(html).toContain('data-line="2"')
    expect(html).toContain('data-target-line="true"')
    expect(html).toContain('class="workspace-token is-keyword">const</span>')
    expect(html).toContain('class="workspace-token is-plain">target</span>')
  })

  it('keeps a linked line in the rendered window for long files', () => {
    const text = Array.from({ length: 5_000 }, (_, index) => `line-${index + 1}`).join('\n')
    const html = renderToStaticMarkup(
      createElement(CodeViewer, {
        cwd: '/workspace/codex-app',
        path: '/workspace/codex-app/src/large.ts',
        file: {
          status: 'ready',
          result: {
            path: '/workspace/codex-app/src/large.ts',
            kind: 'text',
            mimeType: 'text/typescript',
            text,
            sizeBytes: text.length
          }
        },
        targetLine: 4_500,
        onRetry: () => undefined
      })
    )

    expect(html).toContain('data-line="4500" data-target-line="true"')
    expect(html).toContain('data-line="1001"')
    expect(html).not.toContain('data-line="1"')
  })
})

describe('WorkspacePane file tree accessibility', () => {
  const directories: Record<string, DirectoryLoadState> = {
    '/project': {
      status: 'ready',
      truncated: false,
      entries: [
        { fileName: 'src', path: '/project/src', isDirectory: true, isFile: false },
        { fileName: 'README.md', path: '/project/README.md', isDirectory: false, isFile: true }
      ]
    },
    '/project/src': {
      status: 'ready',
      truncated: false,
      entries: [
        { fileName: 'App.tsx', path: '/project/src/App.tsx', isDirectory: false, isFile: true }
      ]
    }
  }
  const expanded = new Set(['/project', '/project/src'])

  it('renders the root and visible descendants as a roving ARIA tree', () => {
    const html = renderToStaticMarkup(createElement(FileTreeView, {
      cwd: '/project',
      directories,
      expandedDirectories: expanded,
      selectedFile: '/project/src/App.tsx',
      filter: '',
      onToggleDirectory: () => undefined,
      onSelectFile: () => undefined,
      onRetryDirectory: () => undefined,
      onContextMenu: () => undefined
    }))

    expect(html).toContain('role="tree" aria-label="Workspace files"')
    expect(html).toContain('role="treeitem" class="workspace-tree-root" aria-expanded="true"')
    expect(html).toContain('aria-level="1" aria-posinset="1" aria-setsize="1" tabindex="-1"')
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-level="2" aria-posinset="1" aria-setsize="2"')
    expect(html).toContain('aria-level="3" aria-posinset="1" aria-setsize="1" tabindex="0"')
    expect(html).toContain('aria-selected="true"')
  })

  it('models standard visible-tree keyboard navigation and activation', () => {
    const items = collectVisibleWorkspaceTreeItems('/project', directories, expanded, '')
    expect(items.map((item) => item.path)).toEqual([
      '/project',
      '/project/src',
      '/project/src/App.tsx',
      '/project/README.md'
    ])
    expect(workspaceTreeKeyboardAction(items, '/project', 'ArrowDown')).toEqual({ type: 'focus', path: '/project/src' })
    expect(workspaceTreeKeyboardAction(items, '/project', 'ArrowRight')).toEqual({ type: 'focus', path: '/project/src' })
    expect(workspaceTreeKeyboardAction(items, '/project/src', 'ArrowRight')).toEqual({ type: 'focus', path: '/project/src/App.tsx' })
    expect(workspaceTreeKeyboardAction(items, '/project/src/App.tsx', 'ArrowLeft')).toEqual({ type: 'focus', path: '/project/src' })
    expect(workspaceTreeKeyboardAction(items, '/project/src', 'ArrowLeft')).toEqual({ type: 'collapse', path: '/project/src' })
    expect(workspaceTreeKeyboardAction(items, '/project/src/App.tsx', 'Home')).toEqual({ type: 'focus', path: '/project' })
    expect(workspaceTreeKeyboardAction(items, '/project', 'End')).toEqual({ type: 'focus', path: '/project/README.md' })
    expect(workspaceTreeKeyboardAction(items, '/project/src/App.tsx', 'Enter')).toEqual({ type: 'activate', path: '/project/src/App.tsx' })
    expect(workspaceTreeKeyboardAction(items, '/project/src', ' ')).toEqual({ type: 'collapse', path: '/project/src' })
  })

  it('expands collapsed folders before moving into their children', () => {
    const items = collectVisibleWorkspaceTreeItems(
      '/project',
      directories,
      new Set(['/project']),
      ''
    )
    expect(items.map((item) => item.path)).toEqual([
      '/project',
      '/project/src',
      '/project/README.md'
    ])
    expect(workspaceTreeKeyboardAction(items, '/project/src', 'ArrowRight')).toEqual({ type: 'expand', path: '/project/src' })
  })
})
