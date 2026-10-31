import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActivityTooltip } from './ActivityTooltip'
import { WorkbenchElementGlyph } from './WorkbenchElementGlyph'
import type { WorkspaceChangeEntry } from './workspacePaneModel'
import { workspaceRelativePath } from './workspaceFileModel'

/** review-header-toolbar Ee/we: sort by filename, then parent; filter both display path fields. */
export function workspaceDiffJumpEntries(changes: readonly WorkspaceChangeEntry[], cwd: string | null | undefined, query: string):
  { change: WorkspaceChangeEntry; fileName: string; parentPath: string; displayPath: string }[] {
  const entries = changes.map((change) => {
    const displayPath = (cwd ? workspaceRelativePath(cwd, change.path) : change.path).replaceAll('\\', '/')
    const separator = displayPath.lastIndexOf('/')
    return { change, displayPath, fileName: displayPath.slice(separator + 1), parentPath: separator < 0 ? '' : displayPath.slice(0, separator) }
  })
  const sort = (left: typeof entries[number], right: typeof entries[number]): number =>
    left.fileName.localeCompare(right.fileName) || left.parentPath.localeCompare(right.parentPath)
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return entries.sort(sort)
  return entries.filter((entry) => entry.displayPath.toLocaleLowerCase().includes(normalized)).sort(sort)
}

/** Original Re Pe/Oe opens a changed-file picker rather than the selected file's source editor. */
export function WorkspaceDiffJumpToFile({ changes, cwd, onSelectChange }: {
  changes: readonly WorkspaceChangeEntry[]
  cwd: string | null | undefined
  onSelectChange(change: WorkspaceChangeEntry): void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const entries = useMemo(() => workspaceDiffJumpEntries(changes, cwd, query), [changes, cwd, query])
  const close = (): void => { setOpen(false); trigger.current?.focus() }
  const select = (index: number): void => {
    const entry = entries[index]
    if (entry) { onSelectChange(entry.change); close() }
  }
  useLayoutEffect(() => { if (open) input.current?.focus() }, [open])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && container.current?.contains(event.target)) return
      setOpen(false)
    }
    const blur = (): void => setOpen(false)
    window.addEventListener('pointerdown', outside); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('blur', blur) }
  }, [open])
  return <div className="workspace-diff-jump-control" ref={container}>
    <ActivityTooltip variant="copy" openDelay={250} content={open ? undefined : '跳转到文件'}>
      <button type="button" ref={trigger} aria-label="跳转到文件" aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? id : undefined} onClick={() => { setQuery(''); setSelected(0); setOpen((value) => !value) }}
        onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setQuery(''); setSelected(0); setOpen(true) } }}>
        <WorkbenchElementGlyph name="document-badge-magnifyingglass-light-16" size={16} />
      </button>
    </ActivityTooltip>
    {open && <div className="workspace-diff-jump-menu" id={id} role="dialog" aria-label="跳转到文件"
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setSelected((value) => entries.length ? (value + (event.key === 'ArrowDown' ? 1 : entries.length - 1)) % entries.length : 0)
        } else if (event.key === 'Enter') { event.preventDefault(); select(selected) }
        else if (event.key === 'Tab') setOpen(false)
      }}>
      <input ref={input} aria-label="跳转到文件" placeholder="跳转到文件" value={query} role="combobox"
        aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={entries[selected] ? `${id}-entry-${selected}` : undefined}
        onChange={(event) => { setQuery(event.target.value); setSelected(0) }} />
      <div role="listbox" id={`${id}-list`} aria-label="变更的文件">
        {entries.length === 0 ? <p className="workspace-diff-jump-empty">没有匹配的文件</p> : entries.map((entry, index) =>
          <button key={entry.change.id} id={`${id}-entry-${index}`} role="option" aria-selected={selected === index} type="button"
            onPointerMove={() => setSelected(index)} onClick={() => select(index)}>
            <span>{entry.fileName}</span>{entry.parentPath && <small>{entry.parentPath}</small>}
          </button>)}
      </div>
    </div>}
  </div>
}
