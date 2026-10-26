import { SquareTerminal } from 'lucide-react'
import type { ReactNode } from 'react'

export function TerminalGlyph(): ReactNode {
  return <SquareTerminal width={16} height={16} strokeWidth={1.65} aria-hidden="true" />
}
