import { ChevronDown } from 'lucide-react'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import './collapsibleUserMessage.css'

export const USER_MESSAGE_COLLAPSED_LINE_COUNT = 20
const USER_MESSAGE_VISIBLE_TEXT_LINES = USER_MESSAGE_COLLAPSED_LINE_COUNT - 1
const ESTIMATED_CHARACTERS_PER_LINE = 72

export function estimateUserMessageLineCount(text: string): number {
  return text.split(/\r?\n/).reduce((total, line) => (
    total + Math.max(1, Math.ceil(line.length / ESTIMATED_CHARACTERS_PER_LINE))
  ), 0)
}

export function userMessageStartsCollapsed(text: string): boolean {
  return estimateUserMessageLineCount(text) > USER_MESSAGE_COLLAPSED_LINE_COUNT
}

export function CollapsibleUserMessage({ text }: { text: string }): ReactNode {
  const contentRef = useRef<HTMLDivElement>(null)
  const [collapsible, setCollapsible] = useState(() => userMessageStartsCollapsed(text))
  const [expanded, setExpanded] = useState(false)
  const collapsed = collapsible && !expanded

  useEffect(() => setExpanded(false), [text])

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return

    const measure = (): void => {
      const lineHeight = Number.parseFloat(window.getComputedStyle(content).lineHeight) || 21
      const collapsedHeight = lineHeight * USER_MESSAGE_VISIBLE_TEXT_LINES
      setCollapsible(content.scrollHeight > collapsedHeight + 1)
    }

    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [text])

  return (
    <div
      className="collapsible-user-message"
      data-collapsible={collapsible ? 'true' : 'false'}
      data-expanded={expanded ? 'true' : 'false'}
    >
      <div className="collapsible-user-message-body">
        <div
          ref={contentRef}
          className={`collapsible-user-message-content${collapsed ? ' is-collapsed' : ''}`}
        >
          {text}
        </div>
        {collapsed && <span className="collapsible-user-message-ellipsis" aria-hidden="true">…</span>}
      </div>
      {collapsible && (
        <button
          type="button"
          className="collapsible-user-message-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span>{expanded ? '收起' : '显示更多'}</span>
          <ChevronDown className={expanded ? 'is-expanded' : undefined} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
