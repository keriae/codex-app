import {
  Check,
  ChevronLeft,
  GitBranch,
  GitFork,
  Settings,
  type LucideIcon
} from 'lucide-react'
import type { ReactNode } from 'react'

const ICONS = {
  gear: Settings,
  worktree: GitFork,
  back: ChevronLeft,
  environment: Settings,
  branch: GitBranch,
  check: Check
} satisfies Record<string, LucideIcon>

export function LocalEnvironmentIcon({ name, className }: {
  name: keyof typeof ICONS
  className?: string
}): ReactNode {
  const Icon = ICONS[name]
  return <Icon width={16} height={16} strokeWidth={1.65} className={className} aria-hidden="true" />
}
