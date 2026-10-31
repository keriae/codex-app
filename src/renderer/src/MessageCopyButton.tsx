import { useInsertionEffect, useRef, useState, type ReactNode } from 'react'
import { ActivityGlyph } from './ActivityGlyph'
import { copyTextToClipboard } from './clipboard'
import { ActivityTooltip } from './ActivityTooltip'

/** User-message copy has 1.5s feedback; reply copy follows Fqn's 2s default. */
export function MessageCopyButton({ text, tooltip, className, variant = 'reply' }: {
  text: string
  tooltip: string
  className?: string
  variant?: 'user' | 'reply'
}): ReactNode {
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(false)
  const copying = useRef(false)
  const mounted = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useInsertionEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearTimeout(timer.current)
    }
  }, [])

  const copy = async (): Promise<void> => {
    if (copying.current || copied) return
    copying.current = true
    if (variant === 'reply') setPending(true)
    let succeeded = false
    try {
      await copyTextToClipboard(text)
      succeeded = true
    } catch {
      // The shipped copy control keeps its normal glyph when clipboard writing fails.
    }
    if (!mounted.current) return
    copying.current = false
    if (variant === 'reply') setPending(false)
    if (!succeeded) return
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = undefined
      setCopied(false)
    }, variant === 'user' ? 1500 : 2000)
  }

  return <ActivityTooltip variant={variant === 'user' ? 'userCopy' : 'copy'} content={copied ? '已复制' : tooltip}><button type="button" className={`${className || ''}${copied ? ' is-copied' : ''}`.trim() || undefined}
    aria-label={copied ? '已复制' : variant === 'user' ? '复制消息' : '复制'}
    aria-busy={variant === 'reply' && pending || undefined} aria-disabled={variant === 'reply' && pending || undefined}
    onClick={copied ? undefined : (event) => { event.stopPropagation(); void copy() }}>
    <ActivityGlyph kind={copied ? 'copied' : 'copy'} aria-hidden="true" />
  </button></ActivityTooltip>
}
