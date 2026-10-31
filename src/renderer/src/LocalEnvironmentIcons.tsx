import type { ReactNode } from 'react'
import { ActivityGlyph } from './ActivityGlyph'
import { ShellElementGlyph, type ShellElementGlyphName } from './ShellElementGlyph'

const ICONS = {
  gear: 'gear-light-16',
  worktree: 'arrow-branch-light-16',
  back: 'chevron-left-md-light-16',
  environment: 'gear-light-16',
  branch: 'branch-light-16',
  check: 'checkmark-lg-light-16',
  'open-settings': 'open-link-light-16'
} satisfies Record<string, ShellElementGlyphName>

export function LocalEnvironmentIcon({ name, className }: {
  name: keyof typeof ICONS | 'branch-list' | 'branch-check'
  className?: string
}): ReactNode {
  if (name === 'branch-check') return <ActivityGlyph kind="copied" width={16} height={16} className={className} aria-hidden="true" />
  if (name === 'branch-list') return <svg width={16} height={16} viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
    <circle cx={5.4165} cy={5} r={1.875} stroke="currentColor" strokeWidth={1.33} />
    <circle cx={5.4165} cy={15} r={1.875} stroke="currentColor" strokeWidth={1.33} />
    <circle cx={14.5833} cy={5} r={1.875} stroke="currentColor" strokeWidth={1.33} />
    <path d="M5.4165 6.66664V13.3333" stroke="currentColor" strokeWidth={1.33} strokeLinejoin="round" />
    <path d="M5.41658 12.5V11.6667C5.41658 10.7462 6.16278 10 7.08325 10H12.9166C13.8371 10 14.5833 9.25381 14.5833 8.33333V7.5" stroke="currentColor" strokeWidth={1.33} strokeLinejoin="round" />
  </svg>
  return <ShellElementGlyph name={ICONS[name]} width={16} height={16} className={className} />
}
