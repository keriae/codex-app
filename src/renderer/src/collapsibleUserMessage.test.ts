import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  CollapsibleUserMessage,
  estimateUserMessageLineCount,
  USER_MESSAGE_COLLAPSED_LINE_COUNT,
  userMessageStartsCollapsed
} from './CollapsibleUserMessage'

const styles = readFileSync(new URL('./collapsibleUserMessage.css', import.meta.url), 'utf8')

describe('CollapsibleUserMessage', () => {
  it('uses the shipped twenty-line user-message limit', () => {
    expect(USER_MESSAGE_COLLAPSED_LINE_COUNT).toBe(20)
    expect(estimateUserMessageLineCount('one\ntwo\nthree')).toBe(3)
    expect(userMessageStartsCollapsed(Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n'))).toBe(false)
    expect(userMessageStartsCollapsed(Array.from({ length: 21 }, (_, index) => `line ${index}`).join('\n'))).toBe(true)
  })

  it('renders an ellipsis and localized disclosure for a long prompt', () => {
    const text = Array.from({ length: 21 }, (_, index) => `line ${index}`).join('\n')
    const html = renderToStaticMarkup(createElement(CollapsibleUserMessage, { text }))

    expect(html).toContain('data-collapsible="true"')
    expect(html).toContain('collapsible-user-message-content is-collapsed')
    expect(html).toContain('collapsible-user-message-ellipsis')
    expect(html).toContain('>显示更多<')
    expect(html).toContain('aria-expanded="false"')
  })

  it('leaves short prompts uncollapsed without disclosure chrome', () => {
    const html = renderToStaticMarkup(createElement(CollapsibleUserMessage, { text: 'short prompt' }))

    expect(html).toContain('data-collapsible="false"')
    expect(html).not.toContain('is-collapsed')
    expect(html).not.toContain('显示更多')
    expect(html).not.toContain('collapsible-user-message-ellipsis')
  })

  it('reserves one of the twenty visible lines for the ellipsis', () => {
    expect(styles).toMatch(
      /\.collapsible-user-message-content\.is-collapsed\s*\{[^}]*max-height: 19lh;[^}]*overflow: hidden;/s
    )
  })
})
