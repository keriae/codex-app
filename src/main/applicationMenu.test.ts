import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { applicationMenuTemplate } from './applicationMenu'

describe('recorded macOS close and window zoom menu commands', () => {
  it('distinguishes menu selection from its accelerator and uses the native window zoom callbacks', () => {
    const close = vi.fn()
    const stepZoom = vi.fn()
    const resetZoom = vi.fn()
    const template = applicationMenuTemplate('Codex', () => {}, () => {}, false, { close, stepZoom, resetZoom })
    const fileItems = template.find((item) => item.label === 'File')!.submenu as MenuItemConstructorOptions[]
    const closeItem = fileItems.find((item) => item.accelerator === 'CmdOrCtrl+W')!
    closeItem.click!({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent)
    closeItem.click!({} as Electron.MenuItem, undefined, { triggeredByAccelerator: true } as Electron.KeyboardEvent)
    expect(close.mock.calls).toEqual([[false], [true]])
    const viewItems = template.find((item) => item.label === 'View')!.submenu as MenuItemConstructorOptions[]
    for (const label of ['Zoom In', 'Zoom Out', 'Actual Size']) {
      viewItems.find((item) => item.label === label)!.click!({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent)
    }
    expect(stepZoom.mock.calls).toEqual([[1], [-1]])
    expect(resetZoom).toHaveBeenCalledTimes(1)
  })
})
