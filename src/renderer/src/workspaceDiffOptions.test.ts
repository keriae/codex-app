import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { transpileModule, ScriptTarget } from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceDiffControlIcon, WorkspaceDiffOptions } from './WorkspaceDiffControls'
import { WorkspaceDiffViewer } from './WorkspaceDiffViewer'
import { parseWorkspaceDiffPreferences, WORKSPACE_DIFF_PREFERENCES_KEY } from './workspaceDiffModel'
import { resolveWorkspaceDiffLink } from './workspaceDiffLinks'

afterEach(() => vi.unstubAllGlobals())

describe('installed Ue options and preference consumers', () => {
  it('uses the original five persisted defaults and migrates the earlier two-field preference', () => {
    const defaults = { style: 'auto', wrap: false, loadFullFiles: true, richPreview: false,
      wordDiffs: true, hideWhitespace: false, hideImports: false }
    expect(parseWorkspaceDiffPreferences(null)).toEqual(defaults)
    expect(parseWorkspaceDiffPreferences('invalid JSON')).toEqual(defaults)
    expect(parseWorkspaceDiffPreferences('{"style":"split","wrap":true}')).toEqual({ ...defaults, style: 'split', wrap: true })
    const saved = { ...defaults, loadFullFiles: false, richPreview: true, wordDiffs: false, hideWhitespace: true, hideImports: true }
    expect(parseWorkspaceDiffPreferences(JSON.stringify(saved))).toEqual(saved)
  })

  it('retains the six original ordered labels, checked states, and last-turn copy gate', () => {
    const preferences = parseWorkspaceDiffPreferences(null)
    const html = renderToStaticMarkup(createElement(WorkspaceDiffOptions, { preferences, onChange: () => {}, onClose: () => {}, showCopyGitApplyCommand: true }))
    const labels = ['加载完整文件', '渲染预览', '词级差异', '隐藏空白字符', '隐藏导入内容', '复制 git apply 命令']
    expect(labels.map((label) => html.indexOf(label))).toEqual([...labels.map((label) => html.indexOf(label))].sort((a, b) => a - b))
    expect(html.match(/role="menuitemcheckbox"/g)).toHaveLength(5)
    expect(html.match(/aria-checked="true"/g)).toHaveLength(2)
    expect(html).toContain('role="menuitem" disabled=""')
    for (const glyph of ['loadFullFiles', 'richPreview', 'wordDiffs', 'hideWhitespace', 'hideImports', 'copyGitApply']) {
      expect(html).toContain(`data-workspace-diff-control-glyph="${glyph}"`)
    }
  })

  it('calls the real checkbox preference update, closes on select, and preserves all other choices', () => {
    const preferences = parseWorkspaceDiffPreferences(null)
    const onChange = vi.fn(), onClose = vi.fn()
    const element = WorkspaceDiffOptions({ preferences, onChange, onClose }) as ReactElement<{ children: ReactNode }>
    const buttons = Children.toArray(element.props.children).filter(isValidElement) as ReactElement<{ onClick(): void }>[]
    buttons[0].props.onClick()
    expect(onChange).toHaveBeenCalledWith({ ...preferences, loadFullFiles: false })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('honors caller visibility flags while keeping word diffs unconditional', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceDiffOptions, { preferences: parseWorkspaceDiffPreferences(null),
      onChange: () => {}, onClose: () => {}, showLoadFullFiles: false, showRichPreview: false, showHideWhitespace: false, showHideImports: false }))
    expect(html).toContain('词级差异')
    for (const label of ['加载完整文件', '渲染预览', '隐藏空白字符', '隐藏导入内容', '复制 git apply 命令']) expect(html).not.toContain(label)
  })

  it('enables copy only with an available callback and an enabled source, then closes after selection', () => {
    const base = { preferences: parseWorkspaceDiffPreferences(null), onChange: () => {}, onClose: vi.fn(), showCopyGitApplyCommand: true }
    const callback = vi.fn()
    const html = renderToStaticMarkup(createElement(WorkspaceDiffOptions, { ...base, onClickCopyGitApplyCommand: callback }))
    expect(html).not.toContain('disabled=""')
    expect(renderToStaticMarkup(createElement(WorkspaceDiffOptions, { ...base, copyGitApplyCommandDisabled: true,
      onClickCopyGitApplyCommand: callback }))).toContain('role="menuitem" disabled=""')
    const element = WorkspaceDiffOptions({ ...base, onClickCopyGitApplyCommand: callback }) as ReactElement<{ children: ReactNode }>
    const buttons = Children.toArray(element.props.children).filter(isValidElement) as ReactElement<{ onClick(event: { preventDefault(): void }): void }>[]
    const preventDefault = vi.fn()
    buttons.at(-1)!.props.onClick({ preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(base.onClose).toHaveBeenCalledTimes(1)
  })

  it('renders word-alt spans in the actual review and removes them when the preference is disabled', () => {
    const change = resolveWorkspaceDiffLink('/project', { itemId: 'replace', change: {
      path: 'a.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-const label = "Copy"\n+const label = "Copied"'
    } })!
    const render = (wordDiffs: boolean): string => {
      vi.stubGlobal('localStorage', { getItem: (key: string) => key === WORKSPACE_DIFF_PREFERENCES_KEY ? JSON.stringify({ wordDiffs }) : null })
      return renderToStaticMarkup(createElement(WorkspaceDiffViewer, { change, cwd: '/project', onOpenFile: () => {} }))
    }
    expect(render(true)).toContain('data-diff-span="" class="workspace-diff-word">Copied')
    expect(render(false)).not.toContain('data-diff-span')
  })

  it('invalidates both loaded-file and Git caches before retrying an unchanged patch', () => {
    const source = readFileSync(new URL('./WorkspaceDiffViewer.tsx', import.meta.url), 'utf8')
    const body = source.slice(source.indexOf('  const retryFile ='), source.indexOf('  const controls ='))
    const compiled = transpileModule(body, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText
    let revision = 0
    let loaded: unknown = { key: 'unchanged-patch', snapshot: { before: 'old', after: 'new' } }
    let whitespacePatch: unknown = { key: 'unchanged-patch', patch: 'cached' }
    let fileError: unknown = 'previous mismatch', whitespaceError: unknown = 'previous failure'
    const onRefresh = vi.fn()
    const bindings = { setFileRevision: (update: (value: number) => number) => { revision = update(revision) },
      setLoaded: (value: unknown) => { loaded = value }, setWhitespacePatch: (value: unknown) => { whitespacePatch = value },
      setFileError: (value: unknown) => { fileError = value }, setWhitespaceError: (value: unknown) => { whitespaceError = value }, onRefresh }
    const actions = new Function(...Object.keys(bindings), `${compiled}\nreturn { retryFile, refreshDiff }`)(...Object.values(bindings)) as
      { retryFile(): void; refreshDiff(): void }
    actions.refreshDiff()
    expect(revision).toBe(1)
    expect([loaded, whitespacePatch, fileError, whitespaceError]).toEqual([null, null, null, null])
    expect(onRefresh).toHaveBeenCalledTimes(1)
    actions.retryFile()
    expect(revision).toBe(2)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('loads the required snapshot for either filter even with full-file display disabled', () => {
    const source = readFileSync(new URL('./WorkspaceDiffViewer.tsx', import.meta.url), 'utf8')
    const body = source.slice(source.indexOf('  const needsFullFile ='), source.indexOf('  const needsPreviewFile ='))
    const compiled = transpileModule(body, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText
    const evaluate = new Function('preferences', 'change', 'diff', 'collapsedAll', `${compiled}\nreturn needsFullFile`) as
      (preferences: ReturnType<typeof parseWorkspaceDiffPreferences>, change: { kind: string }, diff: { isBinary: boolean; additions: number; deletions: number }, collapsed: boolean) => boolean
    const preferences = { ...parseWorkspaceDiffPreferences(null), loadFullFiles: false }
    const diff = { isBinary: false, additions: 1, deletions: 1 }
    expect(evaluate(preferences, { kind: 'modified' }, diff, false)).toBe(false)
    for (const filter of ['hideWhitespace', 'hideImports'] as const) {
      const filtered = { ...preferences, [filter]: true }
      expect(evaluate(filtered, { kind: 'modified' }, diff, false)).toBe(true)
      expect(evaluate(filtered, { kind: 'modified' }, diff, true)).toBe(true)
      expect(evaluate(filtered, { kind: 'deleted' }, diff, false)).toBe(false)
      expect(evaluate(filtered, { kind: 'added' }, diff, false)).toBe(false)
      expect(evaluate(filtered, { kind: 'modified' }, { ...diff, isBinary: true }, false)).toBe(false)
    }
  })
})

describe('direct-source Changes glyph bodies', () => {
  it('matches the authored payload hashes and canvases independently of the workbench registry', () => {
    const evidence = JSON.parse(readFileSync(new URL('../../../reverse/workbench-changes-controls-evidence-2026-10-31.json', import.meta.url), 'utf8'))
    const names = ['wrap', 'refresh', 'collapse', 'expand', 'busy', 'checkmark', 'loadFullFiles', 'richPreview', 'wordDiffs', 'hideWhitespace', 'hideImports', 'copyGitApply'] as const
    for (const name of names) {
      const html = renderToStaticMarkup(createElement(WorkspaceDiffControlIcon, { name }))
      const glyph = evidence.glyphs.find((record: { name: string }) => record.name === name)
      const body = html.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
      expect(glyph).toBeDefined()
      expect(createHash('sha256').update(body).digest('hex')).toBe(glyph.bodySha256)
      expect(html).toContain(`viewBox="${glyph.canvas.viewBox}"`)
      expect(html).toContain('width="16" height="16"')
    }
  })
})
