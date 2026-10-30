import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyTextToClipboard } from './clipboard'

afterEach(() => vi.unstubAllGlobals())

describe('native clipboard text service', () => {
  it('copies the exact text through the desktop service when Chromium denies writes', async () => {
    const native = vi.fn().mockResolvedValue(undefined)
    const browser = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    vi.stubGlobal('window', { codex: { copyText: native } })
    vi.stubGlobal('navigator', { clipboard: { writeText: browser } })
    const text = '  printf "$value"\nsecond line\n'
    await copyTextToClipboard(text)
    expect(native).toHaveBeenCalledWith(text)
    expect(browser).not.toHaveBeenCalled()
  })
  it('propagates native failures so the control cannot claim success', async () => {
    vi.stubGlobal('window', { codex: { copyText: vi.fn().mockRejectedValue(new Error('pasteboard error')) } })
    await expect(copyTextToClipboard('value')).rejects.toThrow('pasteboard error')
  })
  it('supports a standalone renderer and reports an unavailable clipboard', async () => {
    vi.stubGlobal('window', {})
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await copyTextToClipboard('standalone')
    expect(writeText).toHaveBeenCalledWith('standalone')
    vi.stubGlobal('navigator', {})
    await expect(copyTextToClipboard('standalone')).rejects.toThrow('unavailable')
  })
})
