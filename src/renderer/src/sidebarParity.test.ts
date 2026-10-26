import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const hoverCard = readFileSync(new URL('./SidebarHoverCard.tsx', import.meta.url), 'utf8')
const hoverStyles = readFileSync(new URL('./sidebarHoverCard.css', import.meta.url), 'utf8')

function expectContract(source: string, contract: string): void {
  expect(source.includes(contract), `missing sidebar contract: ${contract}`).toBe(true)
}

function expectCssRule(selector: string, declarations: readonly string[]): void {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blocks = [...styles.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'gs'))]
    .map((match) => match[1])
  const matches = blocks.some((block) => declarations.every((declaration) => block.includes(declaration)))
  expect(
    matches,
    `missing CSS contract for ${selector}: ${declarations.join(', ')}`
  ).toBe(true)
}

describe('sidebar parity contracts', () => {
  it('exposes the recovered section, project, and thread instrumentation', () => {
    expectContract(app, 'data-app-action-sidebar-section')
    expectContract(app, 'data-app-action-sidebar-section-heading')
    expectContract(app, 'data-app-action-sidebar-section-collapsed')
    expectContract(app, 'data-app-action-sidebar-section-toggle')
    expectContract(app, 'data-app-action-sidebar-project-row')
    expectContract(app, 'data-app-action-sidebar-project-collapsed')
    expectContract(app, 'data-app-action-sidebar-project-list-id')
    expectContract(app, 'data-app-action-sidebar-thread-row')
    expectContract(app, 'data-app-action-sidebar-thread-active')
    expectContract(app, 'data-app-action-sidebar-thread-pinned')
    expectContract(app, 'data-app-action-sidebar-thread-selected')
  })

  it('renders pinned, projects, and recent as independently collapsible sections', () => {
    expectContract(app, 'sectionId="pinned"')
    expectContract(app, 'sectionId="projects"')
    expectContract(app, 'sectionId="recent"')
    expectContract(app, 'title="置顶"')
    expectContract(app, 'title="项目"')
    expectContract(app, "title={activityView ? '活动' : catalogView === 'archived' ? '已归档' : '最近'}")
    expectContract(app, 'aria-expanded={!collapsed}')
    expectContract(app, 'onCollapsedChange')
  })

  it('provides direct pin and archive hover actions on active thread rows', () => {
    expectContract(app, 'className="thread-row-hover-actions"')
    expectContract(app, "'置顶聊天'")
    expectContract(app, "'取消置顶聊天'")
    expectContract(app, 'aria-label={pinActionLabel}')
    expectContract(app, 'aria-label="归档聊天"')
    expect(app).toMatch(
      /className="thread-row-hover-actions"[\s\S]*?onTogglePin[\s\S]*?onArchive/
    )
  })

  it('provides native delayed information cards, marquee titles, and custom action tooltips', () => {
    expectContract(app, '<SidebarHoverCard')
    expectContract(app, '<SidebarMarqueeText>{title}</SidebarMarqueeText>')
    expectContract(app, '<SidebarTooltip content={pinActionLabel}>')
    expectContract(app, '<SidebarTooltip content="归档聊天">')
    expectContract(hoverCard, 'const HOVER_CARD_DELAY_MS = 200')
    expectContract(hoverCard, 'const HOVER_CARD_WARM_DELAY_MS = 40')
    expectContract(hoverCard, 'const SIDEBAR_SURFACE_SKIP_DELAY_MS = 300')
    expectContract(hoverCard, "window.addEventListener('scroll', hide, true)")
    expectContract(hoverCard, "document.addEventListener('pointerdown', closeOnPointerDown, true)")
    expectContract(hoverCard, "window.addEventListener('blur', hide)")
    expectContract(hoverCard, "if (event.key === 'Escape') hide()")
    expectContract(hoverCard, 'onPointerDownCapture={hide}')
    expectContract(hoverCard, 'bounds.right + 3')
    expectContract(hoverStyles, 'width: 320px;')
    expectContract(hoverStyles, 'border-radius: 15px;')
    expectContract(hoverStyles, '0 8px 16px -4px var(--shadow-soft)')
    expectContract(hoverStyles, 'padding: 0;')
    expectContract(hoverStyles, 'background: #262626;')
    expect(hoverStyles).toMatch(/:root\[data-theme='light'\] \.sidebar-hover-card\s*\{[^}]*background: #fff;[^}]*0 0 0 0\.5px rgb\(26 28 31 \/ 8%\)[^}]*0 8px 16px -4px rgb\(0 0 0 \/ 12%\);/s)
    expectContract(hoverStyles, 'padding: 5px 12px;')
    expectContract(hoverStyles, 'background: #1a1c1f;')
    expectContract(hoverStyles, 'animation: sidebar-marquee-scroll')
    expectContract(app, "`${project.hostLabel} · ${project.threads.length} 次聊天`")
  })

  it('matches the compact native project and chat hover-card structure', () => {
    expectContract(app, 'className="sidebar-project-hover-card-copy"')
    expectContract(app, 'className="sidebar-project-hover-card-pin"')
    expectContract(app, "`${project.hostLabel} · ${project.threads.length} 次聊天`")
    expectContract(app, 'className="sidebar-project-hover-card-row is-path"')
    expectContract(app, 'className="sidebar-project-hover-card-external"')
    expectContract(app, 'className="sidebar-thread-hover-card-copy"')
    expectContract(app, 'className="sidebar-thread-hover-card-header"')
    expectContract(app, 'className="sidebar-thread-hover-card-host-icon"')
    expectContract(app, '<SidebarRemoteGlobeIcon color={hostColor')
    expectContract(app, '<SidebarRemoteFolderIcon globeColor={hostColor')
    expectContract(hoverStyles, '.sidebar-project-hover-card-copy')
    expectContract(hoverStyles, 'gap: 6px;')
    expectContract(hoverStyles, 'padding: 8px;')
    expectContract(hoverStyles, 'grid-template-columns: 16px minmax(0, 1fr) 20px;')
    expectContract(hoverStyles, '.sidebar-thread-hover-card-copy')
    expectContract(hoverStyles, 'padding: 6px 8px;')
  })

  it('matches the recovered project menu content and portal dismissal behavior', () => {
    expectContract(app, 'function SidebarPortalMenu')
    expectContract(app, '在 Finder 中显示')
    expectContract(app, '全部标为已读')
    expectContract(app, '归档聊天')
    expectContract(app, '移除项目')
    expectContract(app, "document.addEventListener('scroll', close, true)")
    expectContract(app, 'left: Math.max(gutter, Math.min(anchor.left + 1')
    expectContract(app, 'aria-controls={menuOpen ? menuId : undefined}')
    expectContract(app, 'requestAnimationFrame(() => menuTriggerRef.current?.focus')
    expect(app.includes('<SidebarTooltip content="项目选项">')).toBe(false)
    expect(app.includes('<SidebarTooltip content="新聊天">')).toBe(false)
    expectCssRule('.sidebar-project-menu', [
      'width: 160px;',
      'padding: 4px;',
      'border-radius: 20px;'
    ])
  })

  it('uses custom rail tooltips and a dismissible exploration dialog', () => {
    expectContract(app, 'tooltip={false}')
    expectContract(app, "active={exploreOpen || (!settingsOpen && activeView === 'projects' && !projectsPinned)}")
    expectContract(app, 'ariaHaspopup="dialog"')
    expectContract(app, 'role="dialog" aria-label="探索"')
    expectContract(app, "data-state={exploreOpen ? 'open' : 'closed'}")
    expectContract(app, '固定到侧边栏')
    expectContract(app, "document.addEventListener('pointerdown', dismiss)")
    expectContract(app, '<SidebarTooltip content={label} placement="right">')
    expect(app.includes('title={label}')).toBe(false)
    expectCssRule('.rail-explore-menu', [
      'width: 228px;',
      'height: 36.5703px;',
      'padding: 4px;',
      'border-radius: 20px;'
    ])
  })

  it('matches the native section action menus and add/new controls', () => {
    expectContract(app, "'置顶选项'")
    expectContract(app, "'项目侧边栏选项'")
    expectContract(app, "'聊天侧边栏选项'")
    expectContract(app, 'aria-label={optionLabel}')
    expectContract(app, 'aria-label="添加新项目"')
    expectContract(app, 'data-app-action-sidebar-project-create')
    expectContract(app, 'aria-label="新聊天"')
    expectContract(app, 'label="整理侧边栏"')
    expectContract(app, 'label="聊天排序方式"')
    expectContract(app, 'label="分项目显示"')
    expectContract(app, 'label="按远程主机"')
    expectContract(app, 'label="合并显示"')
    expectContract(app, 'label="最近更新"')
    expectContract(app, 'label="手动排序"')
    expectContract(app, 'role="menuitemcheckbox"')
    expectContract(app, 'showProjectsInRecent')
  })

  it('offers an expand control only for project groups beyond the five-chat preview', () => {
    expectContract(app, 'projectThreadsForDisplay')
    expectContract(app, 'SIDEBAR_PROJECT_PREVIEW_LIMIT')
    expectContract(app, '展开显示')
  })

  it('matches native recent pagination and loading status behavior', () => {
    expectContract(app, 'const SIDEBAR_RECENT_INITIAL_LIMIT = 20')
    expectContract(app, 'const SIDEBAR_RECENT_PAGE_SIZE = 10')
    expectContract(app, 'data-app-action-sidebar-load-sentinel')
    expectContract(app, 'new IntersectionObserver')
    expectContract(app, 'role="status" aria-label="处理中"')
    expectContract(app, 'threadHasActiveSidebarTurn(thread)')
    expect(app.includes('className="sidebar-load-more"')).toBe(false)
  })

  it('keeps the measured native sidebar typography and row geometry', () => {
    expectCssRule('.section-title', [
      'height: 30px;',
      'padding: 0 6px 0 8px;',
      'color: var(--text-faint);',
      'font-size: 14px;',
      'font-weight: 500;',
      'line-height: 21px;'
    ])
    expectCssRule('.section-title-toggle', [
      'height: 25px;',
      'gap: 4px;',
      'margin-left: -4px;',
      'padding: 2px 4px;'
    ])
    expectCssRule('.section-title-toggle svg', [
      'width: 14px;',
      'height: 14px;',
      'transform: rotate(-90deg);'
    ])
    expectCssRule('.section-title-actions', [
      'width: 0;',
      'overflow: hidden;',
      'opacity: 0;',
      'pointer-events: none;'
    ])
    expectCssRule('.section-title .section-title-action', [
      'width: 24px;',
      'height: 24px;',
      'border-radius: 9.375px;',
      'background: transparent;'
    ])
    expectCssRule('.sidebar-section-menu', [
      'width: 220px;',
      'padding: 4px;',
      'border-radius: 20px;',
      'font-size: 13px;'
    ])
    expectCssRule('.sidebar-section-submenu', [
      'width: 180px;',
      'left: calc(100% + 8px);'
    ])
    expectCssRule('.sidebar-menu-item', [
      'height: 28.5703px;',
      'padding: 5px 8px;',
      'border-radius: 15px;'
    ])
    expectCssRule('.section-title .section-title-toggle', [
      'display: flex;',
      'align-items: center;',
      'justify-content: flex-start;',
      'border-radius: 10px;'
    ])
    expectCssRule('.sidebar-project-heading', [
      'height: 30px;',
      'font-size: 13px;',
      'font-weight: 430;',
      'line-height: 18.5714px;'
    ])
    expectCssRule('.sidebar-project-label', [
      'font-size: 14px;',
      'font-weight: 430;',
      'line-height: 21px;'
    ])
    expectCssRule('.thread-row', [
      'height: 30px;',
      'padding: 5px 5px 5px 8px;',
      'border-radius: 12.5px;',
      'color: color-mix(in oklab, var(--text) 85%, transparent);',
      'font-size: 13px;',
      'font-weight: 430;',
      'line-height: 18.5714px;'
    ])
    expectCssRule('.thread-row-copy > span', [
      'font-size: 14px;',
      'font-weight: 430;',
      'line-height: 20px;'
    ])
    expectCssRule('.thread-row:hover', [
      'background: var(--hover);',
      'color: color-mix(in oklab, var(--text) 85%, transparent);'
    ])
    expectCssRule('.sidebar-expand', [
      'width: fit-content;',
      'height: 24px;',
      'margin: 0 0 0 24px;',
      'padding: 0 8px;',
      'border-radius: 9.375px;',
      'color: var(--text-faint);',
      'font-size: 13px;',
      'font-weight: 400;',
      'line-height: 13px;'
    ])
    expectCssRule('.thread-row-hover-actions button', [
      'width: 20px;',
      'height: 20px;',
      'border-radius: 9999px;',
      'background: transparent;'
    ])
    expectCssRule('.thread-row-wrap:hover .thread-row,\n.thread-row-wrap.menu-open .thread-row', [
      'padding-right: 56px;'
    ])
    expectCssRule('.sidebar-project-hover-actions,\n.thread-row-hover-actions', [
      'right: 8px;',
      'gap: 8px;'
    ])
    expectCssRule('.sidebar-section-content', [
      'display: flex;',
      'flex-direction: column;',
      'gap: 1px;'
    ])
    expectCssRule('.thread-row-spinner', [
      'width: 16px;',
      'height: 16px;',
      'animation: spin 2s steps(60) infinite;'
    ])
    expectCssRule('.sidebar-load-sentinel', [
      'width: 100%;',
      'height: 8px;',
      'flex: 0 0 8px;'
    ])
  })
})
