import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff, type ParsedDiffLine } from './unifiedDiff'
import { workspaceWordDiffSpans } from './workspaceWordDiff'

function replacement(before: string, after: string): ParsedDiffLine[] {
  return parseUnifiedDiff(`-${before}\n+${after}`).lines
}

function highlighted(lines: ParsedDiffLine[], enabled = true): string[][] {
  const spans = workspaceWordDiffSpans(lines, enabled)
  return lines.map((line) => (spans.get(line) ?? []).map(({ start, length }) => line.content.slice(start, start + length)))
}

describe('workspace word-alt differences', () => {
  it('highlights changed words while retaining UTF-16 span positions', () => {
    const lines = replacement('const greeting = "hello";', 'const greeting = "goodbye";')
    const spans = workspaceWordDiffSpans(lines, true)

    expect(spans.get(lines[0])).toEqual([{ start: 18, length: 5 }])
    expect(spans.get(lines[1])).toEqual([{ start: 18, length: 7 }])
    expect(highlighted(lines)).toEqual([['hello'], ['goodbye']])
    expect(highlighted(lines, false)).toEqual([[], []])
    const astralPrefix = replacement('😀old!', '😀new!')
    expect(workspaceWordDiffSpans(astralPrefix, true).get(astralPrefix[0])).toEqual([{ start: 2, length: 3 }])
  })

  it('treats Chinese characters as individual tokens and joins an internal neutral character', () => {
    expect(highlighted(replacement('旧中甲尾巴', '新中乙尾巴'))).toEqual([['旧中甲'], ['新中乙']])
    expect(highlighted(replacement('你好世界', '你好天地'))).toEqual([['世界'], ['天地']])
  })

  it('retains whitespace differences instead of treating trimmed words as equal', () => {
    expect(highlighted(replacement('a b', 'a  b'))).toEqual([[' '], ['  ']])
    expect(highlighted(replacement('a\tb', 'a b'))).toEqual([['\t'], [' ']])
  })

  it('joins one internal neutral character but keeps the last neutral item separate', () => {
    expect(highlighted(replacement('old-old end', 'new-new end'))).toEqual([['old-old'], ['new-new']])
    expect(highlighted(replacement('old + old end', 'new + new end'))).toEqual([['old', 'old'], ['new', 'new']])
    expect(highlighted(replacement('旧中甲尾', '新中乙尾'))).toEqual([['旧中甲'], ['新中乙']])
    expect(highlighted(replacement('old!', 'new!'))).toEqual([['old'], ['new']])
  })

  it('uses the native shortest-path tie-breaking for repeated tokens', () => {
    expect(highlighted(replacement('甲乙甲', '乙甲乙'))).toEqual([['甲'], ['乙']])
    expect(highlighted(replacement('a b a', 'b a b'))).toEqual([['a '], [' b']])
  })

  it('pairs replacement lines in order and stops at context and metadata boundaries', () => {
    const lines = parseUnifiedDiff('-firstOld\n-secondOld\n+firstNew\n same\n-old!\n+new!\n\\ No newline at end of file\n+added').lines

    expect(highlighted(lines)).toEqual([['firstOld'], [], ['firstNew'], [], ['old'], ['new'], [], []])
    expect(workspaceWordDiffSpans(parseUnifiedDiff('+added\n context\n-removed').lines, true).size).toBe(0)
  })

  it('allows 1000 UTF-16 characters per line and skips longer pairs', () => {
    expect(highlighted(replacement('a'.repeat(1000), 'b'.repeat(1000)))).toEqual([['a'.repeat(1000)], ['b'.repeat(1000)]])
    expect(highlighted(replacement('a'.repeat(1001), 'b'))).toEqual([[], []])
    const lines = replacement('old', 'new')
    lines[0].content += '\r\n'
    lines[1].content += '\n'
    expect(highlighted(lines)).toEqual([['old'], ['new']])
  })

  it('allows 2000 changed lines but disables spans for larger diffs', () => {
    const lines = Array.from({ length: 1000 }, () => replacement('old', 'new')).flat()
    expect(workspaceWordDiffSpans(lines, true).size).toBe(2000)
    expect(workspaceWordDiffSpans([...lines, ...parseUnifiedDiff('+one more').lines], true).size).toBe(0)
  })
})
