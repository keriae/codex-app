import { describe, expect, it } from 'vitest'
import { reasoningActivityHeading, reasoningBody, reasoningSummaryMarkdown } from './reasoningActivity'

describe('shipped summary reasoning conversion', () => {
  it('uses the displayed summary channel and keeps private raw content out of the activity', () => {
    expect(reasoningSummaryMarkdown({ type: 'reasoning', id: 'r', summary: [], content: ['raw-channel'] })).toBe('')
  })
  it('promotes the first summary part to a title and preserves the remaining paragraphs', () => {
    const markdown = reasoningSummaryMarkdown({ type: 'reasoning', id: 'r', summary: ['Inspecting files', 'First paragraph', 'Second paragraph'], content: [] })
    expect(markdown).toBe('**Inspecting files**\n\nFirst paragraph\n\nSecond paragraph')
    expect(reasoningBody(markdown)).toBe('First paragraph\n\nSecond paragraph')
  })
  it('does not briefly display an unfinished streamed title', () => {
    expect(reasoningBody('**Inspecting')).toBe('')
    expect(reasoningBody('**Inspecting**\nBody')).toBe('Body')
    expect(reasoningBody('## Inspecting\nBody')).toBe('Body')
  })
})

describe('live reasoning activity heading', () => {
  const item = (summary: string[], content: string[] = []) => ({ type: 'reasoning' as const, id: 'r', summary, content })

  it('keeps a sole bold summary title visible', () => {
    expect(reasoningActivityHeading(item(['**Inspecting files**']))).toBe('Inspecting files')
  })

  it('uses the last title rather than the first summary title', () => {
    expect(reasoningActivityHeading(item(['Inspecting files', 'Earlier paragraph\n\n### Latest **title**']))).toBe('Latest title')
  })

  it('uses the last paragraph with Markdown converted to plain text', () => {
    expect(reasoningActivityHeading(item(['Inspecting files', 'Latest [path](file:///tmp/file) with `code` and *emphasis*']))).toBe('Latest path with code and emphasis')
  })

  it('skips empty, comment, and non-text lines after the last meaningful paragraph', () => {
    expect(reasoningActivityHeading(item(['Inspecting files', 'Last meaningful paragraph\r\n\r\n---\r\n<!-- hidden -->\r\n<!-']))).toBe('Last meaningful paragraph')
  })

  it('extracts nested formatting from a strong-only paragraph', () => {
    expect(reasoningActivityHeading(item(['**Checking `files` &amp; *folders***']))).toBe('Checking files & folders')
  })

  it('keeps list text without its list marker', () => {
    expect(reasoningActivityHeading(item(['Inspecting files', '1. Checking the next directory']))).toBe('Checking the next directory')
    expect(reasoningActivityHeading(item(['Inspecting files', '- Checking the next directory']))).toBe('Checking the next directory')
  })

  it('recursively parses the text of a strong-only paragraph', () => {
    expect(reasoningActivityHeading(item(['**- Checking the next directory**']))).toBe('Checking the next directory')
  })

  it('preserves unfinished Markdown as literal summary text', () => {
    expect(reasoningActivityHeading(item(['**Inspecting']))).toBe('**Inspecting')
  })

  it('falls back when there is no meaningful summary', () => {
    expect(reasoningActivityHeading(item([]))).toBeNull()
    expect(reasoningActivityHeading(item(['<!-- incomplete']))).toBeNull()
    expect(reasoningActivityHeading(item(['---']))).toBeNull()
  })

  it('never uses the raw reasoning content channel for the heading', () => {
    expect(reasoningActivityHeading(item([], ['Raw-channel text']))).toBeNull()
  })
})
