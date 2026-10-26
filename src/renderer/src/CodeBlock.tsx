import { Check, CodeXml, Copy, WrapText } from 'lucide-react'
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
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
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
  const [wrapped, setWrapped] = useState(false)
  const resetTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    },
    []
  )

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
      resetTimer.current = window.setTimeout(() => setCopied(false), 1_500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <figure className={`markdown-code-block${wrapped ? ' is-wrapped' : ''}`}>
      <figcaption>
        <span className="markdown-code-language">
          <CodeXml aria-hidden="true" />
          <span>{displayLanguage(resolvedLanguage)}</span>
        </span>
        <span className="markdown-code-actions">
          <button
            type="button"
            className={wrapped ? 'is-active' : undefined}
            aria-label={wrapped ? '关闭代码自动换行' : '开启代码自动换行'}
            aria-pressed={wrapped}
            title={wrapped ? '关闭自动换行' : '自动换行'}
            onClick={() => setWrapped((value) => !value)}
          >
            <WrapText />
          </button>
          {copyable && (
            <button
              type="button"
              aria-label={copied ? '代码已复制' : '复制代码'}
              title={copied ? '已复制' : '复制代码'}
              onClick={() => void copy()}
            >
              {copied ? <Check /> : <Copy />}
            </button>
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
