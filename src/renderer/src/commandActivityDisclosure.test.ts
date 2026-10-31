import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandActivity, ConversationActivityItems } from './ConversationActivity'
import type { CommandItem } from './protocol'

// Render the real activity tree at each requested/animated disclosure state.
// Animation timing and native input are covered by the shared hook and UI checks.
const disclosures = vi.hoisted(() => ({
  states: [] as Array<{ expanded: boolean; mounted: boolean; visible: boolean }>,
  index: 0
}))
vi.mock('./useActivityDisclosure', () => ({
  useActivityDisclosure: () => ({
    ...(disclosures.states[disclosures.index++] ?? { expanded: false, mounted: false, visible: false }),
    setOpen: vi.fn()
  })
}))

const closed = { expanded: false, mounted: false, visible: false }
const open = { expanded: true, mounted: true, visible: true }
const item: CommandItem = {
  type: 'commandExecution', id: 'live-command', command: 'sleep 35', status: 'inProgress',
  startedAtMs: 1_000, aggregatedOutput: 'live output',
  commandActions: [{ type: 'unknown', command: 'sleep 35' }]
}

function render(states: typeof disclosures.states, command = item, compact = true): string {
  disclosures.states = states
  disclosures.index = 0
  return renderToStaticMarkup(createElement(CommandActivity, { item: command, compact }))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(10_000)
  disclosures.states = []
  disclosures.index = 0
})
afterEach(() => vi.useRealTimers())

describe('compact command disclosure hierarchy', () => {
  it('keeps the closed live summary timer-free and does not mount output', () => {
    const html = render([closed])
    expect(html).toContain('正在运行')
    expect(html).toContain('sleep 35')
    expect(html).not.toContain('命令已运行')
    expect(html).not.toContain('9s')
    expect(html).not.toContain('live output')
    expect(html.match(/class="conversation-command-toggle"/g)).toHaveLength(1)
  })

  it('opens a detailed timed row before its separate raw-output disclosure', () => {
    const html = render([open, closed])
    const outer = html.slice(0, html.indexOf('conversation-activity-group-collapse'))
    expect(outer).toContain('正在运行')
    expect(outer).not.toContain('9s')
    expect(html).toContain('命令已运行 9s')
    expect(html).toContain('conversation-activity-group-body')
    expect(html.match(/class="conversation-command-toggle"/g)).toHaveLength(2)
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1)
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(1)
    expect(html).not.toContain('conversation-command-output')
    expect(html).not.toContain('live output')
    const outerControl = html.match(/aria-controls="([^"]+)"/)?.[1]
    expect(outerControl).toBeTruthy()
    expect(html).toContain(`class="conversation-activity-group-body" id="${outerControl}"`)
  })

  it('opens raw command output only at the second level, using independent IDs', () => {
    const html = render([open, open])
    expect(html.match(/class="conversation-command-output"/g)).toHaveLength(1)
    expect(html.match(/live output/g)).toHaveLength(1)
    expect(html).toContain('conversation-command-prompt')
    expect(html).not.toContain('成功')
    const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((match) => match[1])
    expect(controls).toHaveLength(2)
    expect(new Set(controls).size).toBe(2)
    expect(html).toContain(`class="conversation-command-output" id="${controls[1]}"`)
  })

  it('uses the selected detailed row rather than the compact summary last action', () => {
    const html = render([open, open], {
      ...item,
      command: 'printf first; printf second',
      commandActions: [
        { type: 'unknown', command: 'printf first' },
        { type: 'unknown', command: 'printf second' }
      ]
    })
    const output = html.slice(html.indexOf('class="conversation-command-output"'))
    expect(output).toContain('printf first')
    expect(output).not.toContain('printf second')
  })

  it('makes the whole nested tree inert immediately while the outer group closes', () => {
    const html = render([{ expanded: false, mounted: true, visible: false }, open])
    expect(html).toContain('class="conversation-activity-group-collapse" aria-hidden="true" inert=""')
    expect(html).toContain('live output')
  })

  it('retains the independent compact file link without adding a command disclosure', () => {
    const html = render([closed], {
      ...item, command: 'cat src/example.ts',
      commandActions: [{ type: 'read', command: 'cat src/example.ts', name: 'src/example.ts', path: 'src/example.ts' }]
    })
    expect(html).toContain('正在读取')
    expect(html).toContain('data-agent-activity-file-link="" title="src/example.ts"')
    expect(html).toContain('example.ts')
    expect(html).not.toContain('conversation-command-toggle')
    expect(html).not.toContain('conversation-activity-group-body')
  })

  it.each(['completed', 'interrupted'] as const)('renders a %s singleton as one detailed row', (status) => {
    const completed: CommandItem = {
      ...item, status: 'completed', durationMs: 3_000, exitCode: 0,
      executionStatus: status === 'interrupted' ? 'interrupted' : undefined
    }
    disclosures.states = [closed]
    const html = renderToStaticMarkup(createElement(ConversationActivityItems, {
      items: [completed], live: status === 'interrupted',
      renderItem: (entry, grouped) => entry.type === 'commandExecution'
        ? createElement(CommandActivity, { item: entry, compact: !grouped })
        : null
    }))
    expect(html).not.toContain('is-compact')
    expect(html).not.toContain('conversation-activity-group-body')
    expect(html.match(/class="conversation-command-toggle"/g)).toHaveLength(1)
    expect(html).toContain('3s')
    expect(html).toContain(status === 'interrupted' ? '后停止' : '已在')
  })
})
