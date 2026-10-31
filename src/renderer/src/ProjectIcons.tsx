import type { ReactNode } from 'react'
import { ActivityGlyph } from './ActivityGlyph'
import { ShellElementGlyph, type ShellElementGlyphName } from './ShellElementGlyph'

const ORIGINAL_PROJECT_ICONS = {
  pin: 'pin-light-16',
  pinned: 'pin-fill-light-16',
  'new-chat': 'square-and-pencil-light-16',
  'chevron-down': 'chevron-down',
  more: 'ellipsis-horizontal-light-16',
  folder: 'folder-light-16',
  'folder-open': 'folder-open-light-16',
  edit: 'gear-light-16',
  archive: 'archive-light-16',
  'thread-rename': 'thread-rename-original-21',
  'thread-pin': 'thread-pin-original-20',
  'thread-unpin': 'thread-unpin-original-20',
  'thread-archive': 'thread-archive-original-20'
} satisfies Record<string, ShellElementGlyphName>

export function ProjectIcon({ name, className }: {
  name: keyof typeof ORIGINAL_PROJECT_ICONS | 'open-chat'
  className?: string
}): ReactNode {
  if (name === 'open-chat') return <ActivityGlyph kind="chevron" width={16} height={16} className={className} aria-hidden="true" />
  const size = name.startsWith('thread-') ? 18 : 16
  return <ShellElementGlyph name={ORIGINAL_PROJECT_ICONS[name]} width={size} height={size} className={className}
    style={{ width: size, height: size }} />
}
