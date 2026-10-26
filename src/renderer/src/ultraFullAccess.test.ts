import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { PermissionProfile } from './protocol'
import { UltraFullAccessDialog, trappedUltraDialogTabTarget } from './UltraFullAccessDialog'
import {
  needsUltraFullAccessConfirmation,
  restrictedPermissionFallback
} from './ultraFullAccess'

const profile = (id: string, allowed = true): PermissionProfile => ({ id, allowed, description: null })

describe('Ultra with Full access selection guard', () => {
  it('only confirms a transition into Ultra while Full access is already active', () => {
    expect(needsUltraFullAccessConfirmation(':danger-full-access', 'high', 'ultra')).toBe(true)
    expect(needsUltraFullAccessConfirmation(':danger-full-access', 'ultra', 'ultra')).toBe(false)
    expect(needsUltraFullAccessConfirmation(':workspace', 'high', 'ultra')).toBe(false)
    expect(needsUltraFullAccessConfirmation(':danger-full-access', 'high', 'max')).toBe(false)
  })

  it('prefers the allowed workspace profile, then the first allowed restricted profile', () => {
    expect(restrictedPermissionFallback([
      profile(':read-only'),
      profile(':danger-full-access'),
      profile(':workspace')
    ])).toBe(':workspace')
    expect(restrictedPermissionFallback([
      profile(':workspace', false),
      profile(':custom'),
      profile(':danger-full-access')
    ])).toBe(':custom')
    expect(restrictedPermissionFallback([
      profile(':workspace', false),
      profile(':danger-full-access')
    ])).toBeNull()
  })
})

describe('Ultra with Full access confirmation dialog', () => {
  const render = (canContinue: boolean): string => renderToStaticMarkup(createElement(UltraFullAccessDialog, {
    canContinue,
    onClose: vi.fn(),
    onContinueWithFullAccess: vi.fn(),
    onContinueWithFallback: vi.fn()
  }))

  it('renders the recorded Chinese warning and action order', () => {
    const html = render(true)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('是否启用 Ultra 搭配完整访问权限？')
    expect(html).toContain('你可切换至管控更严格的权限模式，或使用完整访问权限。')
    expect(html.indexOf('使用完整访问权限')).toBeLessThan(html.indexOf('>继续<'))
    expect(html).toContain('class="ultra-full-access-danger"')
    expect(html).toContain('class="ultra-full-access-primary"')
  })

  it('uses the no-fallback copy and disables Continue when no restricted mode exists', () => {
    const html = render(false)
    expect(html).toContain('当前暂无管控更严格的权限模式可供选择。')
    expect(html).toContain('class="ultra-full-access-primary" disabled=""')
  })

  it('cycles focus at both edges and recovers when focus starts outside the dialog', () => {
    const first = {} as HTMLElement
    const middle = {} as HTMLElement
    const last = {} as HTMLElement
    const nodes = [first, middle, last]
    expect(trappedUltraDialogTabTarget(nodes, first, true)).toBe(last)
    expect(trappedUltraDialogTabTarget(nodes, last, false)).toBe(first)
    expect(trappedUltraDialogTabTarget(nodes, middle, false)).toBeNull()
    expect(trappedUltraDialogTabTarget(nodes, null, false)).toBe(first)
    expect(trappedUltraDialogTabTarget(nodes, null, true)).toBe(last)
  })
})
