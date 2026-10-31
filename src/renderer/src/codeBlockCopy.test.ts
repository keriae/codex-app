import { type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeBlock } from './CodeBlock'
import { copyTextToClipboard } from './clipboard'

// Exercise the real button handlers with persistent hook cells. Native mounting,
// clipboard bridging and tooltip placement remain part of the packaged UI check.
const hooks = vi.hoisted(() => ({
  cells: [] as unknown[],
  index: 0,
  cleanups: [] as Array<() => void>,
  stateWrites: 0
}))
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const index = hooks.index++
    if (!(index in hooks.cells)) hooks.cells[index] = initial
    return [hooks.cells[index], (next: unknown) => {
      hooks.stateWrites++
      hooks.cells[index] = typeof next === 'function' ? next(hooks.cells[index]) : next
    }]
  },
  useRef: (initial: unknown) => {
    const index = hooks.index++
    if (!(index in hooks.cells)) hooks.cells[index] = { current: initial }
    return hooks.cells[index]
  },
  useInsertionEffect: (effect: () => (() => void)) => {
    const index = hooks.index++
    if (!(index in hooks.cells)) {
      hooks.cells[index] = true
      hooks.cleanups.push(effect())
    }
  }
}))
vi.mock('./clipboard', () => ({ copyTextToClipboard: vi.fn() }))

type ButtonProps = {
  'aria-label'?: string
  'aria-busy'?: boolean
  'aria-disabled'?: boolean
  'aria-pressed'?: boolean
  onClick?: (event: { stopPropagation(): void }) => void
  children?: ReactNode
}

function findButton(node: ReactNode, pattern: RegExp): ReactElement<ButtonProps> {
  if (Array.isArray(node)) {
    for (const entry of node) {
      try { return findButton(entry, pattern) } catch { /* Continue through siblings. */ }
    }
  } else if (node && typeof node === 'object' && 'props' in node) {
    const element = node as ReactElement<ButtonProps>
    if (element.type === 'button' && pattern.test(element.props['aria-label'] || '')) return element
    return findButton(element.props.children, pattern)
  }
  throw new Error(`No button matching ${pattern}`)
}

function render(): ReactNode {
  hooks.index = 0
  return CodeBlock({ code: 'const value = 1', language: 'ts' })
}
const copyButton = (): ReactElement<ButtonProps> => findButton(render(), /^(复制代码|已复制)$/)
const click = (button: ReactElement<ButtonProps>): void => button.props.onClick?.({ stopPropagation: vi.fn() })
const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }

beforeEach(() => {
  hooks.cells = []
  hooks.index = 0
  hooks.cleanups = []
  hooks.stateWrites = 0
  vi.useFakeTimers()
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  vi.mocked(copyTextToClipboard).mockReset()
})
afterEach(() => {
  hooks.cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('code toolbar copy interaction', () => {
  it('blocks duplicate pending writes and exposes the asynchronous state', async () => {
    let resolve!: () => void
    vi.mocked(copyTextToClipboard).mockReturnValue(new Promise<void>((done) => { resolve = done }))
    const originalButton = copyButton()
    click(originalButton)
    click(originalButton)
    const pendingButton = copyButton()
    click(pendingButton)
    expect(copyTextToClipboard).toHaveBeenCalledTimes(1)
    expect(copyTextToClipboard).toHaveBeenCalledWith('const value = 1')
    expect(pendingButton.props['aria-busy']).toBe(true)
    expect(pendingButton.props['aria-disabled']).toBe(true)
    resolve()
    await settle()
    expect(copyButton().props['aria-busy']).toBeUndefined()
    expect(copyButton().props['aria-label']).toBe('已复制')
  })

  it('keeps success for two seconds and resumes copying afterward', async () => {
    vi.mocked(copyTextToClipboard).mockResolvedValue(undefined)
    click(copyButton())
    await settle()
    const succeeded = copyButton()
    expect(succeeded.props.onClick).toBeUndefined()
    click(succeeded)
    vi.advanceTimersByTime(1_999)
    expect(copyButton().props['aria-label']).toBe('已复制')
    expect(copyTextToClipboard).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(copyButton().props['aria-label']).toBe('复制代码')
    click(copyButton())
    await settle()
    expect(copyTextToClipboard).toHaveBeenCalledTimes(2)
  })

  it('clears pending state without false success after a failed write', async () => {
    vi.mocked(copyTextToClipboard).mockRejectedValueOnce(new Error('Clipboard unavailable'))
    click(copyButton())
    await settle()
    expect(copyButton().props['aria-label']).toBe('复制代码')
    expect(copyButton().props['aria-busy']).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
    vi.mocked(copyTextToClipboard).mockResolvedValueOnce(undefined)
    click(copyButton())
    await settle()
    expect(copyButton().props['aria-label']).toBe('已复制')
  })

  it('ignores an unresolved write after unmount and cancels feedback timers', async () => {
    let resolve!: () => void
    vi.mocked(copyTextToClipboard).mockReturnValue(new Promise<void>((done) => { resolve = done }))
    click(copyButton())
    hooks.cleanups.splice(0).forEach((cleanup) => cleanup())
    const writesAfterUnmount = hooks.stateWrites
    resolve()
    await settle()
    expect(hooks.stateWrites).toBe(writesAfterUnmount)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('switches wrapping independently while a clipboard write is pending', () => {
    vi.mocked(copyTextToClipboard).mockReturnValue(new Promise<void>(() => {}))
    click(copyButton())
    const wrap = findButton(render(), /^启用自动换行$/)
    click(wrap)
    const unWrap = findButton(render(), /^禁用自动换行$/)
    expect(unWrap.props['aria-pressed']).toBe(true)
    expect(copyButton().props['aria-busy']).toBe(true)
    expect(copyTextToClipboard).toHaveBeenCalledTimes(1)
  })
})
