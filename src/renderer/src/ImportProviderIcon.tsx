import { Code2, ListChecks, MousePointer2, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ExternalAgentProviderId } from '../../shared/api'

const PROVIDER_ICONS = {
  'claude-code': Code2,
  'claude-cowork': ListChecks,
  cursor: MousePointer2
} satisfies Record<ExternalAgentProviderId, LucideIcon>

export function ImportProviderIcon({ provider }: { provider: ExternalAgentProviderId }): ReactNode {
  const Icon = PROVIDER_ICONS[provider]
  return <Icon width={40} height={40} strokeWidth={1.35} aria-hidden="true" />
}
