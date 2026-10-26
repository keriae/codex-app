import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { LocalEnvironmentDialog } from './LocalEnvironmentDialog'
import { ComposerContextStrip } from './ComposerAddMenu'
import { selectLocalBranch } from './localEnvironmentState'
import type { AppContext } from '../../shared/api'

const context: AppContext = { cwd: '/project', folderName: 'project', branch: 'feature/local', platform: 'darwin' }
const renderDialog = (choice: Parameters<typeof LocalEnvironmentDialog>[0]['choice'] = null): string => renderToStaticMarkup(createElement(LocalEnvironmentDialog, {
  cwd: context.cwd, choice, onSave: vi.fn(), onClose: vi.fn()
}))

// Exercise the component's real handlers with synthetic bindings, without native UI access.
const source = ts.createSourceFile('LocalEnvironmentDialog.tsx', readFileSync(new URL('./LocalEnvironmentDialog.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const handlers = new Map<string, string>()
function collect(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isArrowFunction(node.initializer) && ['back', 'onKey', 'chooseBranch'].includes(node.name.text)) handlers.set(node.name.text, node.initializer.getText(source))
  ts.forEachChild(node, collect)
}
collect(source)
const compiled = ts.transpileModule([...handlers].map(([name, body]) => `const ${name} = ${body}`).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function fixture(picker: 'branch' | 'environment' | null = 'branch', windowCloseActive = false) {
  const branchFocus = vi.fn(), environmentFocus = vi.fn(), onClose = vi.fn(), save = vi.fn(), setPicker = vi.fn(), setQuery = vi.fn()
  const bindings = {
    picker, onClose, save, setPicker, setQuery, cwd: context.cwd,
    selection: { cwd: context.cwd, enabled: true, branch: '' }, selectLocalBranch,
    snapshot: { cwd: context.cwd, status: 'ready', branches: { currentBranch: 'feature/local', defaultBranch: 'origin/main', localBranches: ['feature/local'], remoteBranches: ['origin/main'] }, error: null },
    document: { body: { dataset: { windowCloseActive: String(windowCloseActive) } } },
    branchRef: { current: { focus: branchFocus } }, environmentRef: { current: { focus: environmentFocus } },
    requestAnimationFrame: (callback: () => void) => callback()
  }
  const actions = new Function(...Object.keys(bindings), `${compiled}\nreturn { onKey, chooseBranch }`)(...Object.values(bindings)) as {
    onKey(event: { key: string; preventDefault(): void; stopImmediatePropagation(): void }): void
    chooseBranch(branch: string): void
  }
  return { actions, branchFocus, environmentFocus, onClose, save, setPicker, setQuery }
}

describe('local environment popover', () => {
  it('renders compact settings with a switch and picker rows, without modal submit controls', () => {
    const html = renderDialog()
    expect(html).toContain('class="local-environment-popover"')
    expect(html).toContain('role="switch" aria-label="新建工作树" aria-checked="false"')
    expect(html).toContain('aria-label="此聊天应从哪个分支开始？"')
    expect(html).toContain('disabled="" title="启用工作树后才能选择环境"')
    expect(html).toContain('默认分支')
    expect(html).not.toContain('project-dialog-backdrop')
    expect(html).not.toContain('aria-modal')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('取消')
    expect(html).not.toContain('完成')
  })

  it('enables Environment only for the selected directory’s worktree choice', () => {
    expect(renderDialog({ cwd: '/project', enabled: true, branch: 'origin/main' })).not.toContain('启用工作树后才能选择环境')
    expect(renderDialog({ cwd: '/other', enabled: true, branch: 'origin/main' })).toContain('aria-checked="false"')
  })

  it('keeps truthful worktree starting state without an upstream-incompatible gear trigger', () => {
    const render = (startingBranch?: string) => renderToStaticMarkup(createElement(ComposerContextStrip, { context, worktreeSelected: true, startingBranch, onPickDirectory: vi.fn(), onConfigureEnvironment: vi.fn() }))
    expect(render()).not.toContain('data-local-environment-trigger')
    expect(render()).not.toContain('Configure local environment')
    expect(render()).toContain('Default branch')
    expect(render()).not.toContain('feature/local')
    expect(render('origin/main')).toContain('origin/main')
    expect(render('origin/main')).not.toContain('feature/local')
  })

  it('shows only the project chooser before a project is selected', () => {
    const html = renderToStaticMarkup(createElement(ComposerContextStrip, {
      context: { cwd: '/Users/example', folderName: 'example', branch: null, platform: 'darwin', hostId: 'local', projectKind: 'projectless' },
      onPickDirectory: vi.fn()
    }))
    expect(html).toContain('aria-label="选择项目"')
    expect(html).toContain('选择项目')
    expect(html).not.toContain('本地')
  })

  it('saves a real branch immediately and returns to settings without dismissing the popover', () => {
    const test = fixture()
    test.actions.chooseBranch('origin/main')
    expect(test.save).toHaveBeenCalledWith({ cwd: '/project', enabled: true, branch: 'origin/main' })
    expect(test.setPicker).toHaveBeenCalledWith(null)
    expect(test.setQuery).toHaveBeenCalledWith('')
    expect(test.branchFocus).toHaveBeenCalledWith({ preventScroll: true })
    expect(test.onClose).not.toHaveBeenCalled()
    test.actions.chooseBranch('unrecognized')
    expect(test.save).toHaveBeenCalledOnce()
  })

  it('routes Escape to the child picker first, then outer dismissal', () => {
    const event = { key: 'Escape', preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }
    const child = fixture('environment')
    child.actions.onKey(event)
    expect(child.setPicker).toHaveBeenCalledWith(null)
    expect(child.environmentFocus).toHaveBeenCalledWith({ preventScroll: true })
    expect(child.onClose).not.toHaveBeenCalled()
    expect(event.stopImmediatePropagation).toHaveBeenCalled()
    const outer = fixture(null)
    outer.actions.onKey(event)
    expect(outer.onClose).toHaveBeenCalledOnce()
    expect(outer.setPicker).not.toHaveBeenCalled()
  })

  it('does not consume Escape while the native window close confirmation owns input', () => {
    const event = { key: 'Escape', preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }
    const test = fixture('branch', true)
    test.actions.onKey(event)
    expect(test.onClose).not.toHaveBeenCalled()
    expect(test.setPicker).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
