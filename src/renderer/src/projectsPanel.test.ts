import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ProjectsPanel } from './ProjectsPanel'

describe('ProjectsPanel connected controls', () => {
  it('displays renamed projects and excludes removed current directories', () => {
    const html = renderToStaticMarkup(createElement(ProjectsPanel, {
      paths: ['/work/old', '/work/current'], currentPath: '/work/current',
      hiddenPaths: ['/work/current'], projectNames: { '/work/old': 'Renamed project' }, pinnedPaths: ['/work/old'],
      onAddProject: vi.fn(), onBackToChats: vi.fn(), onSelectProject: vi.fn(),
      onEditProject: vi.fn(), onRenameProject: vi.fn(), onRemoveProject: vi.fn(), onToggleProjectPinned: vi.fn()
    }))
    expect(html).toContain('Renamed project')
    expect(html).not.toContain('/work/current')
    expect(html).toContain('aria-label="展开/收起项目 Renamed project"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-label="在项目 Renamed project 中新建聊天"')
    expect(html).toContain('aria-label="取消固定 Renamed project"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-sort="descending"')
    expect(html).toContain('aria-haspopup="menu"')
  })
})
