import {
  Archive,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Settings,
  SquarePen,
  type LucideIcon
} from 'lucide-react'
import type { ReactNode } from 'react'

const PROJECT_ICONS = {
  pin: Pin,
  pinned: Pin,
  'new-chat': SquarePen,
  'chevron-down': ChevronDown,
  more: MoreHorizontal,
  edit: Settings,
  archive: Archive,
  folder: Folder,
  'folder-open': FolderOpen,
  'open-chat': ChevronRight,
  'thread-rename': Pencil,
  'thread-unpin': PinOff,
  'thread-pin': Pin,
  'thread-archive': Archive
} satisfies Record<string, LucideIcon>

export function ProjectIcon({ name, className }: {
  name: keyof typeof PROJECT_ICONS
  className?: string
}): ReactNode {
  const Icon = PROJECT_ICONS[name]
  return (
    <Icon
      width={16}
      height={16}
      strokeWidth={1.65}
      fill={name === 'pinned' ? 'currentColor' : 'none'}
      className={className}
      aria-hidden="true"
    />
  )
}
