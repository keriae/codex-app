import { type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageCopyButton } from './MessageCopyButton'
import { CommandCopyButton } from './ConversationActivity'
import { copyTextToClipboard } from './clipboard'

// Real handlers with persistent hook cells; native mounting/clipboard is separate.
const hooks = vi.hoisted(() => ({ cells: [] as unknown[], index: 0, cleanups: [] as Array<() => void>, writes: 0 }))
vi.mock('react', async (importOriginal) => {
  const mountEffect = (effect: () => () => void): void => {
    const index = hooks.index++
    if (!(index in hooks.cells)) {
      hooks.cells[index] = true
      hooks.cleanups.push(effect())
    }
  }
  return {
    ...await importOriginal<typeof import('react')>(),
    useState: (initial: unknown) => {
      const index = hooks.index++
      if (!(index in hooks.cells)) hooks.cells[index] = initial
      return [hooks.cells[index], (next: unknown) => {
        hooks.writes++
        hooks.cells[index] = typeof next === 'function' ? next(hooks.cells[index]) : next
      }]
    },
    useRef: (initial: unknown) => {
      const index = hooks.index++
      if (!(index in hooks.cells)) hooks.cells[index] = { current: initial }
      return hooks.cells[index]
    },
    useEffect: mountEffect,
    useInsertionEffect: mountEffect
  }
})
vi.mock('./clipboard', () => ({ copyTextToClipboard: vi.fn() }))

type ButtonProps = {
  'aria-label'?: string
  'aria-busy'?: boolean
  'aria-disabled'?: boolean
  title?: string
  onClick?: (event: { stopPropagation(): void }) => void
  children?: ReactNode
}
type TooltipProps = { content?: string; variant?: string; children: ReactElement<ButtonProps> }
function renderMessageTooltip(variant: 'user' | 'reply'): ReactElement<TooltipProps> {
  hooks.index = 0
  return MessageCopyButton({ text: 'Message text', tooltip: variant === 'user' ? '复制消息' : '复制回复', variant }) as ReactElement<TooltipProps>
}
function renderMessage(variant: 'user' | 'reply'): ReactElement<ButtonProps> {
  return renderMessageTooltip(variant).props.children
}
function renderCommandTooltip(label = '复制命令'): ReactElement<TooltipProps> {
  hooks.index = 0
  return CommandCopyButton({ text: label === '复制输出' ? '/workspace' : 'pwd', label }) as ReactElement<TooltipProps>
}
function renderCommand(label = '复制命令'): ReactElement<ButtonProps> {
  return renderCommandTooltip(label).props.children
}
const click = (button: ReactElement<ButtonProps>): void => button.props.onClick?.({ stopPropagation: vi.fn() })
const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }

beforeEach(() => {
  hooks.cells = []
  hooks.index = 0
  hooks.cleanups = []
  hooks.writes = 0
  vi.useFakeTimers()
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  vi.mocked(copyTextToClipboard).mockReset()
})
afterEach(() => {
  hooks.cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('source-specific message copying', () => {
  it.each([
    ['user', '复制消息', 1_500, undefined],
    ['reply', '复制', 2_000, true]
  ] as const)('keeps %s pending guards, accessibility and feedback duration distinct', async (variant, label, duration, pendingAria) => {
    let resolve!: () => void
    vi.mocked(copyTextToClipboard).mockReturnValue(new Promise<void>((done) => { resolve = done }))
    const original = renderMessage(variant)
    expect(original.props['aria-label']).toBe(label)
    expect(original.props.title).toBeUndefined()
    expect(renderMessageTooltip(variant).props.variant).toBe(variant === 'user' ? 'userCopy' : 'copy')
    expect(renderMessageTooltip(variant).props.content).toBe(variant === 'user' ? '复制消息' : '复制回复')
    click(original)
    click(original)
    const pending = renderMessage(variant)
    click(pending)
    expect(copyTextToClipboard).toHaveBeenCalledTimes(1)
    expect(pending.props['aria-busy']).toBe(pendingAria)
    expect(pending.props['aria-disabled']).toBe(pendingAria)
    resolve()
    await settle()
    const copied = renderMessage(variant)
    expect(copied.props['aria-label']).toBe('已复制')
    expect(renderMessageTooltip(variant).props.content).toBe('已复制')
    expect(copied.props.onClick).toBeUndefined()
    expect(copied.props['aria-busy']).toBeUndefined()
    expect(copied.props['aria-disabled']).toBeUndefined()
    vi.advanceTimersByTime(duration - 1)
    expect(renderMessage(variant).props['aria-label']).toBe('已复制')
    vi.advanceTimersByTime(1)
    expect(renderMessage(variant).props['aria-label']).toBe(label)
  })

  it.each(['user', 'reply'] as const)('lets %s retry a failed write without success feedback', async (variant) => {
    vi.mocked(copyTextToClipboard).mockRejectedValueOnce(new Error('Clipboard unavailable'))
    click(renderMessage(variant))
    await settle()
    expect(renderMessage(variant).props['aria-label']).toBe(variant === 'user' ? '复制消息' : '复制')
    expect(renderMessage(variant).props['aria-busy']).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
    vi.mocked(copyTextToClipboard).mockResolvedValueOnce(undefined)
    click(renderMessage(variant))
    await settle()
    expect(renderMessage(variant).props['aria-label']).toBe('已复制')
  })

  it('does not update an unmounted user copy control when its write resolves', async () => {
    let resolve!: () => void
    vi.mocked(copyTextToClipboard).mockReturnValue(new Promise<void>((done) => { resolve = done }))
    click(renderMessage('user'))
    hooks.cleanups.splice(0).forEach((cleanup) => cleanup())
    const writes = hooks.writes
    resolve()
    await settle()
    expect(hooks.writes).toBe(writes)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['复制命令', '复制输出'])('keeps default copy aria and %s tooltip with Fqn pending attributes', async (label) => {
    let resolve!: () => void
    vi.mocked(copyTextToClipboard).mockReturnValue(new Promise<void>((done) => { resolve = done }))
    const original = renderCommand(label)
    expect(original.props['aria-label']).toBe('复制')
    expect(original.props.title).toBeUndefined()
    expect(renderCommandTooltip(label).props.content).toBe(label)
    expect(renderCommandTooltip(label).props.variant).toBe('copy')
    click(original)
    click(original)
    expect(renderCommand(label).props['aria-busy']).toBe(true)
    expect(renderCommand(label).props['aria-disabled']).toBe(true)
    expect(copyTextToClipboard).toHaveBeenCalledTimes(1)
    resolve()
    await settle()
    expect(renderCommand(label).props['aria-label']).toBe('已复制')
    expect(renderCommandTooltip(label).props.content).toBe('已复制')
    expect(renderCommand(label).props['aria-disabled']).toBeUndefined()
    vi.advanceTimersByTime(2_000)
    expect(renderCommand(label).props['aria-label']).toBe('复制')
    expect(renderCommandTooltip(label).props.content).toBe(label)
  })
})
