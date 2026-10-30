import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CommandActivity, CommandOutput } from './ConversationActivity'
import { commandOutputDisplayCommand, commandOutputText } from './commandOutput'
import type { CommandItem } from './protocol'

const item = (overrides: Partial<CommandItem> = {}): CommandItem => ({
  type: 'commandExecution', id: 'output', command: 'pwd', status: 'completed', ...overrides
})
const output = (overrides: Partial<CommandItem> = {}): string => {
  const command = item(overrides)
  return renderToStaticMarkup(createElement(CommandOutput, { item: command, command: command.command }))
}

describe('embedded command output', () => {
  it.each([
    ['$ pwd', 'pwd'],
    ["/bin/zsh -lc 'printf hello'", 'printf hello'],
    ['bash -lc "printf \\"hello\\""', 'printf "hello"'],
    ["zsh -lc $'printf hello'", 'printf hello'],
    ["/bin/bash -lc 'printf '\"'\"'hello'\"'\"''", "printf 'hello'"],
    ['node -e "console.log(1)"', 'node -e "console.log(1)"'],
    ['', '']
  ])('displays %j without shell launcher syntax', (raw, expected) => {
    expect(commandOutputDisplayCommand(raw)).toBe(expected)
  })

  it('preserves real output while distinguishing pending and empty completed output', () => {
    expect(commandOutputText({ aggregatedOutput: '\n  \t', status: 'inProgress' })).toBe('')
    expect(commandOutputText({ aggregatedOutput: '\n  \t', status: 'completed' })).toBe('无输出')
    expect(commandOutputText({ aggregatedOutput: '  ok\n', status: 'completed' })).toBe('  ok\n')
  })

  it('renders the shell prompt and result without a second shell/directory header', () => {
    const html = output({ command: "/bin/zsh -lc 'pwd'", cwd: '/fixture/project', exitCode: 0, aggregatedOutput: '/fixture/project\n' })
    expect(html).toContain('aria-label="$ pwd"')
    expect(html).toContain('成功')
    expect(html).not.toContain('Shell')
    expect(html.match(/\/fixture\/project/g)).toHaveLength(1)
  })

  it('shows interrupted completion even when the process reported exit code zero', () => {
    const html = output({ executionStatus: 'interrupted', exitCode: 0 })
    expect(html).toContain('已停止')
    expect(html).not.toContain('成功')
  })

  it('does not label pending work as successful or failed', () => {
    const html = output({ status: 'inProgress', aggregatedOutput: '' })
    expect(html).not.toContain('退出码')
    expect(html).not.toContain('无输出')
    expect(html).not.toContain('成功')
    expect(output({ status: 'failed', exitCode: 2 })).toContain('退出码 2')
    expect(output({ exitCode: null })).toContain('退出码 未知')
  })

  it('keeps read-file navigation independent of command-output disclosure in both densities', () => {
    const read = item({ command: 'cat README.md', commandActions: [{ type: 'read', command: 'cat README.md', name: 'README.md', path: '/fixture/README.md' }] })
    for (const compact of [false, true]) {
      const html = renderToStaticMarkup(createElement(CommandActivity, { item: read, compact }))
      expect(html).toContain('data-agent-activity-file-link=""')
      expect(html).toContain('title="/fixture/README.md"')
      expect(html).not.toContain('conversation-command-toggle')
      expect(html).not.toContain('activity-command-chevron')
    }
    const html = renderToStaticMarkup(createElement(CommandActivity, { item: item() }))
    expect(html).toContain('conversation-command-toggle')
    expect(html).toContain('aria-expanded="false"')
  })
})
