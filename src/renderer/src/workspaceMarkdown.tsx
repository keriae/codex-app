import { StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { createRoot, type Root } from 'react-dom/client'
import { MermaidDiagram } from './MermaidDiagram'
import { dispatchWorkspaceFileLink, parseWorkspaceFileLink, resolveWorkspaceFileLink } from './workspaceFileLinks'
import { workspaceMarkdownFrontmatter } from './workspaceMarkdownFrontmatter'

export const markdownEditorFocus = StateEffect.define<boolean>()

class MarkdownMermaidWidget extends WidgetType {
  private roots = new WeakMap<HTMLElement, Root>()
  constructor(readonly code: string, readonly from: number) { super() }
  eq(other: MarkdownMermaidWidget): boolean { return this.code === other.code && this.from === other.from }
  toDOM(view: EditorView): HTMLElement {
    const dom = view.dom.ownerDocument.createElement('div')
    dom.className = 'workspace-markdown-mermaid'
    const root = createRoot(dom)
    this.roots.set(dom, root)
    root.render(<MermaidDiagram code={this.code} onShowSource={() => { view.dispatch({selection: {anchor: this.from}, effects: markdownEditorFocus.of(true)}); view.focus() }} />)
    return dom
  }
  destroy(dom: HTMLElement): void { const root = this.roots.get(dom); if (root) queueMicrotask(() => root.unmount()); this.roots.delete(dom) }
  ignoreEvent(): boolean { return true }
}

class MarkdownImageWidget extends WidgetType {
  private disposed = new WeakSet<HTMLElement>()
  constructor(readonly path: string, readonly root: string, readonly alt: string) { super() }
  eq(other: MarkdownImageWidget): boolean { return this.path === other.path && this.alt === other.alt && this.root === other.root }
  toDOM(view: EditorView): HTMLElement {
    const image = view.dom.ownerDocument.createElement('img')
    image.alt = this.alt
    image.className = 'workspace-markdown-image'
    void window.codex.readWorkspaceFile(this.root, this.path).then((file) => {
      if (!this.disposed.has(image) && file.kind === 'image') {
        image.src = `data:${file.mimeType};base64,${file.dataBase64}`
        image.onload = () => view.requestMeasure()
      }
    }).catch(() => undefined)
    return image
  }
  destroy(dom: HTMLElement): void { this.disposed.add(dom) }
  ignoreEvent(): boolean { return false }
}

function intersects(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.empty ? range.from >= from && range.from <= to : range.from < to && range.to > from)
}

/** Recovered marker-hiding rules from text-file-editor-extensions' ar/dr/lr. */
export function workspaceMarkdownDecorations(state: EditorState, focused: boolean, root = '', path = ''): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const frontmatter = workspaceMarkdownFrontmatter(state.doc.toString())
  if (frontmatter) ranges.push(Decoration.replace({block: true}).range(0, frontmatter.to))
  const lines = new Set<string>()
  const addLine = (from: number, className: string, attributes?: Record<string, string>): void => {
    const key = `${from}:${className}`
    if (!lines.has(key)) { lines.add(key); ranges.push(Decoration.line({ class: className, attributes }).range(from)) }
  }
  const hide = (from: number, to: number): void => { if (from < to) ranges.push(Decoration.replace({}).range(from, to)) }
  const mark = (from: number, to: number, className: string): void => { if (from < to) ranges.push(Decoration.mark({ class: className }).range(from, to)) }
  syntaxTree(state).iterate({ enter(node) {
    if (frontmatter && node.name !== 'Document' && node.from < frontmatter.to) return false
    const parent = node.node.parent
    const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name)
    if (heading) addLine(state.doc.lineAt(node.from).from, `cm-markdown-heading cm-markdown-heading-${heading[1]}`)
    if (node.name === 'FencedCode') {
      const first = state.doc.lineAt(node.from)
      const last = state.doc.lineAt(node.to)
      const marks = node.node.getChildren('CodeMark')
      if (marks.length !== 2 || last.number <= first.number) return false
      const info = node.node.getChild('CodeInfo')
      const language = info ? state.sliceDoc(info.from, info.to).trim() : ''
      if (language === 'mermaid' && !(focused && intersects(state, node.from, node.to))) {
        const code = state.sliceDoc(first.to + 1, last.from).replace(/\n$/, '')
        ranges.push(Decoration.replace({ block: true, widget: new MarkdownMermaidWidget(code, node.from) }).range(first.from, last.to))
        return false
      }
      hide(first.from, first.to)
      hide(last.from, last.to)
      for (let line = first.number; line <= last.number; line++) {
        addLine(state.doc.line(line).from, `cm-markdown-code-line${line === first.number ? ' cm-markdown-code-line-first' : ''}${line === last.number ? ' cm-markdown-code-line-last' : ''}`,
          line === first.number && language ? {'data-language': language} : undefined)
      }
      return false
    }
    if (node.name === 'Image' && root && !(focused && intersects(state, node.from, node.to))) {
      const url = node.node.getChild('URL')
      const href = url ? state.sliceDoc(url.from, url.to) : ''
      const imagePath = workspaceMarkdownFileLink(root, path, href)?.path ?? null
      if (imagePath) {
        const alt = state.sliceDoc(node.from, node.to).match(/^!\[([^\]]*)\]/)?.[1] || ''
        ranges.push(Decoration.replace({widget: new MarkdownImageWidget(imagePath, root, alt)}).range(node.from, node.to))
        return false
      }
    }
    if (node.name === 'InlineCode') mark(node.from, node.to, 'cm-markdown-inline-code')
    if (node.name === 'StrongEmphasis') mark(node.from, node.to, 'cm-markdown-strong')
    if (node.name === 'Emphasis') mark(node.from, node.to, 'cm-markdown-emphasis')
    if (node.name === 'Strikethrough') mark(node.from, node.to, 'cm-markdown-strikethrough')
    if (node.name === 'Link' || node.name === 'Autolink') mark(node.from, node.to, 'cm-markdown-link')
    if (node.name === 'Blockquote' && parent?.name !== 'Blockquote') {
      for (let line = state.doc.lineAt(node.from).number; line <= state.doc.lineAt(node.to).number; line++) addLine(state.doc.line(line).from, 'cm-markdown-blockquote')
    }
    if ((node.name === 'BulletList' || node.name === 'OrderedList') && parent?.name !== 'ListItem') {
      for (let line = state.doc.lineAt(node.from).number; line <= state.doc.lineAt(node.to).number; line++) addLine(state.doc.line(line).from, 'cm-markdown-list-item')
    }
    if (node.name === 'HorizontalRule') { addLine(state.doc.lineAt(node.from).from, 'cm-markdown-horizontal-rule'); hide(node.from, node.to); return false }
    if (node.name === 'QuoteMark' && parent?.parent?.name !== 'Blockquote') { hide(node.from, /\s/.test(state.sliceDoc(node.to, node.to + 1)) ? node.to + 1 : node.to); return false }
    if (node.name === 'TableHeader' || node.name === 'TableRow') addLine(state.doc.lineAt(node.from).from, `cm-markdown-table-row${node.name === 'TableHeader' ? ' cm-markdown-table-header' : ''}`)
    if (node.name === 'TableCell') mark(node.from, node.to, 'cm-markdown-table-cell')
    if (node.name === 'TableDelimiter') {
      if (parent?.name === 'Table') addLine(state.doc.lineAt(node.from).from, 'cm-markdown-table-separator')
      if (!(focused && intersects(state, node.from, node.to))) hide(node.from, node.to)
    }
    if (!parent) return
    const hiddenMark = node.name === 'HeaderMark' || node.name === 'EmphasisMark' || node.name === 'StrikethroughMark' ||
      (node.name === 'CodeMark' && parent.name === 'InlineCode') ||
      ((node.name === 'LinkMark' || node.name === 'URL') && parent.name === 'Link') ||
      (node.name === 'LinkMark' && parent.name === 'Autolink')
    if (!hiddenMark || (parent.name === 'Link' && (parent.getChild('URL') === null || parent.getChild('LinkTitle') !== null))) return
    const to = node.name === 'HeaderMark' && state.sliceDoc(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
    if (!(focused && intersects(state, node.name === 'HeaderMark' ? node.from : parent.from, node.name === 'HeaderMark' ? to : parent.to))) hide(node.from, to)
  } })
  return Decoration.set(ranges, true)
}

export function workspaceMarkdownFileLink(root: string, path: string, href: string) {
  const link = parseWorkspaceFileLink(href)
  if (!link) return null
  const resolved = resolveWorkspaceFileLink(root, link.path.startsWith('/') ? link.path : `${path.slice(0, path.lastIndexOf('/'))}/${link.path}`)
  return resolved ? {...link, path: resolved} : null
}

export function workspaceMarkdownLinkAt(state: EditorState, position: number): string | null {
  if (position < 0 || position > state.doc.length) return null
  for (let node = syntaxTree(state).resolveInner(position, 1); ; ) {
    const url = node.name === 'URL' ? node : node.name === 'Link' || node.name === 'Autolink' ? node.getChild('URL') : null
    if (url) return state.sliceDoc(url.from, url.to).replace(/^<|>$/g, '').replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1').replaceAll('&amp;', '&')
    if (!node.parent) return null
    node = node.parent
  }
}

export function workspaceMarkdownExtension(root: string, path: string): Extension {
  const field = StateField.define<{ focused: boolean; decorations: DecorationSet }>({
    create(state) { return { focused: false, decorations: workspaceMarkdownDecorations(state, false, root, path) } },
    update(value, transaction) {
      const focused = transaction.effects.find((effect) => effect.is(markdownEditorFocus))?.value ?? value.focused
      if (!transaction.docChanged && !transaction.selection && focused === value.focused && syntaxTree(transaction.startState) === syntaxTree(transaction.state)) return value
      return { focused, decorations: workspaceMarkdownDecorations(transaction.state, focused, root, path) }
    },
    provide: (value) => EditorView.decorations.from(value, (item) => item.decorations)
  })
  return [field, EditorView.lineWrapping, EditorView.domEventHandlers({
    focus: (_event, view) => { view.dispatch({effects: markdownEditorFocus.of(true)}); return false },
    blur: (_event, view) => { view.dispatch({effects: markdownEditorFocus.of(false)}); return false },
    mousedown: (event, view) => event.button === 0 && event.metaKey && event.detail < 2 && view.state.selection.main.empty && workspaceMarkdownLinkAt(view.state, view.posAtCoords({x: event.clientX, y: event.clientY}) ?? -1) !== null,
    click: (event, view) => {
      if (event.button !== 0 || event.detail > 1 || (event.shiftKey && !event.metaKey) || !view.state.selection.main.empty) return false
      const href = workspaceMarkdownLinkAt(view.state, view.posAtCoords({x: event.clientX, y: event.clientY}) ?? -1)
      if (!href) return false
      const file = workspaceMarkdownFileLink(root, path, href)
      if (file) { event.preventDefault(); dispatchWorkspaceFileLink(file); return true }
      if (/^(https?:\/\/|mailto:)/i.test(href)) { event.preventDefault(); void window.codex.openExternal(href).catch(() => undefined); return true }
      return false
    }
  })]
}
