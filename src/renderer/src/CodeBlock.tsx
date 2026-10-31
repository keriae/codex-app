import { copyTextToClipboard } from './clipboard'
import { ActivityGlyph } from './ActivityGlyph'
import { ActivityTooltip } from './ActivityTooltip'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import cpp from 'highlight.js/lib/languages/cpp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import objectivec from 'highlight.js/lib/languages/objectivec'
import php from 'highlight.js/lib/languages/php'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { type ReactNode, useInsertionEffect, useMemo, useRef, useState } from 'react'
import './CodeBlock.css'

const LANGUAGES = {
  bash,
  cpp,
  css,
  diff,
  go,
  java,
  javascript,
  json,
  markdown,
  objectivec,
  php,
  plaintext,
  python,
  ruby,
  rust,
  sql,
  swift,
  typescript,
  xml,
  yaml
} as const

for (const [name, grammar] of Object.entries(LANGUAGES)) {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, grammar)
}

const LANGUAGE_ALIASES: Record<string, keyof typeof LANGUAGES> = {
  c: 'cpp',
  cxx: 'cpp',
  h: 'cpp',
  hpp: 'cpp',
  html: 'xml',
  js: 'javascript',
  jsx: 'javascript',
  kt: 'java',
  md: 'markdown',
  objc: 'objectivec',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  text: 'plaintext',
  ts: 'typescript',
  tsx: 'typescript',
  yml: 'yaml'
}

export function normalizeCodeLanguage(language?: string | null): string {
  const normalized = language?.trim().toLowerCase() || 'plaintext'
  const resolved = LANGUAGE_ALIASES[normalized] || normalized
  return hljs.getLanguage(resolved) ? resolved : 'plaintext'
}

function displayLanguage(language: string): string {
  if (language === 'plaintext') return '纯文本'
  if (language === 'javascript') return 'JavaScript'
  if (language === 'typescript') return 'TypeScript'
  if (language === 'objectivec') return 'Objective-C'
  return language
}

export function highlightCode(code: string, language?: string | null): string {
  const resolved = normalizeCodeLanguage(language)
  return hljs.highlight(code, { language: resolved, ignoreIllegals: true }).value
}

export function CodeBlock({
  code,
  language,
  copyable = true
}: {
  code: string
  language?: string | null
  copyable?: boolean
}): ReactNode {
  const resolvedLanguage = normalizeCodeLanguage(language)
  const highlighted = useMemo(
    () => highlightCode(code, resolvedLanguage),
    [code, resolvedLanguage]
  )
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(false)
  const [wrapped, setWrapped] = useState(false)
  const resetTimer = useRef<number | null>(null)
  const copying = useRef(false)
  const mounted = useRef(false)

  useInsertionEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    }
  }, [])

  const copy = async (): Promise<void> => {
    if (copying.current || copied) return
    copying.current = true
    setPending(true)
    let succeeded = false
    try {
      await copyTextToClipboard(code)
      succeeded = true
    } catch {
      // Failed writes keep the normal glyph and allow another attempt.
    }
    if (!mounted.current) return
    copying.current = false
    setPending(false)
    if (!succeeded) return
    setCopied(true)
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => {
      resetTimer.current = null
      setCopied(false)
    }, 2_000)
  }

  return (
    <figure className={`markdown-code-block${wrapped ? ' is-wrapped' : ''}`}>
      <figcaption>
        <span className="markdown-code-language">
          <ActivityGlyph kind="codeLanguage" aria-hidden="true" />
          <span>{displayLanguage(resolvedLanguage)}</span>
        </span>
        <span className="markdown-code-actions">
          <ActivityTooltip content={wrapped ? '禁用自动换行' : '启用自动换行'} openDelay={200}><button
            type="button"
            aria-label={wrapped ? '禁用自动换行' : '启用自动换行'}
            aria-pressed={wrapped}
            onClick={() => setWrapped((value) => !value)}
          >
            <ActivityGlyph kind={wrapped ? 'codeWrap' : 'codeOverflow'} aria-hidden="true" />
          </button></ActivityTooltip>
          {copyable && (
            <ActivityTooltip content={copied ? '已复制' : '复制代码'} openDelay={150}><button
              type="button"
              aria-label={copied ? '已复制' : '复制代码'}
              aria-busy={pending || undefined}
              aria-disabled={pending || undefined}
              onClick={copied ? undefined : (event) => { event.stopPropagation(); void copy() }}
            >
              <ActivityGlyph kind={copied ? 'checkSmall' : 'copySmall'} aria-hidden="true" />
            </button></ActivityTooltip>
          )}
        </span>
      </figcaption>
      <pre>
        <code
          className={`hljs language-${resolvedLanguage}`}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </figure>
  )
}
