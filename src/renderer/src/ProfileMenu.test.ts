import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./ProfileMenu.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./profileMenu.css', import.meta.url), 'utf8')
const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

describe('profile menu parity', () => {
  it('keeps the recovered account menu and help submenu content', () => {
    expect(source).toContain("accountLabel = 'OpenAI using LLM proxy'")
    expect(source).toContain('隐藏 Mini')
    expect(source).toContain('<span>设置</span><kbd>⌘,</kbd>')
    expect(source).toContain('Chrome 扩展程序')
    expect(source).toContain('<span>键盘快捷键</span><kbd>⌘/</kbd>')
    expect(source).toContain('用户指南')
    expect(source).toContain('隐私中心')
  })

  it('matches the measured menu geometry and dismissal behavior', () => {
    expect(styles).toContain('width: 228px;')
    expect(styles).toContain('.profile-help-menu { width: 220px; }')
    expect(styles).toContain('height: 28.5703px;')
    expect(styles).toContain('height: 9px;')
    expect(styles).toContain('border-radius: 20px;')
    expect(styles).toMatch(/:root\[data-theme='light'\] \.profile-menu\s*\{[^}]*background: rgb\(255 255 255 \/ 90%\);[^}]*0 0 0 0\.5px rgb\(26 28 31 \/ 8%\)[^}]*0 8px 16px -4px rgb\(0 0 0 \/ 12%\);/s)
    expect(source).toContain("document.addEventListener('pointerdown', dismiss, true)")
    expect(source).toContain("document.addEventListener('scroll', dismissForWindowChange, true)")
    expect(source).toContain("event.key === 'ArrowRight'")
    expect(source).toContain("event.key === 'ArrowLeft'")
  })

  it('moves focus into the menu and closes the help flyout when another item takes focus', () => {
    expect(source).toContain('actionableItems(menu)[0]?.focus({preventScroll: true})')
    expect(source).toContain('return () => cancelAnimationFrame(frame)')
    expect(source.match(/onFocus=\{\(\) => setHelpOpen\(false\)\}/g)).toHaveLength(2)
    expect(source.match(/onPointerEnter=\{\(\) => setHelpOpen\(false\)\}/g)?.length).toBeGreaterThanOrEqual(3)
    expect(source).toContain('close(true)')
  })

  it('is wired to the bottom rail instead of opening settings directly', () => {
    expect(app).toContain("const [profileOpen, setProfileOpen] = useState(false)")
    expect(app).toContain('ariaHaspopup="menu"')
    expect(app).toContain('ariaExpanded={profileOpen}')
    expect(app).toContain('active={settingsOpen || profileOpen}')
    expect(app).toContain('<ProfileMenu')
    expect(app).toContain("onOpenKeyboardShortcuts={() => openSettings('shortcuts')}")
  })
})
