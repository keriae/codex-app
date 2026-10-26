import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Thread } from './protocol'
import {
  buildProjectList,
  filterMarketplaceCatalog,
  formatProjectUpdatedAt,
  groupMarketplaceCatalog
} from './discoveryPages'

const styles = readFileSync(new URL('./DiscoveryPages.css', import.meta.url), 'utf8')

function thread(cwd: string, updatedAt: number, id: string): Thread {
  return {
    id,
    cwd,
    updatedAt,
    createdAt: updatedAt - 10,
    preview: '',
    turns: []
  }
}

describe('discovery page models', () => {
  it('orders projects by the newest thread activity and keeps folder metadata compact', () => {
    expect(
      buildProjectList(
        ['/workspace/current/', '/workspace/older', '/workspace/current'],
        [
          thread('/workspace/older', 20, 'older'),
          thread('/workspace/current', 50, 'current-one'),
          thread('/workspace/current', 80, 'current-two')
        ],
        '/workspace/current'
      )
    ).toEqual([
      {
        path: '/workspace/current',
        name: 'current',
        updatedAt: 80,
        threadCount: 2,
        current: true
      },
      {
        path: '/workspace/older',
        name: 'older',
        updatedAt: 20,
        threadCount: 1,
        current: false
      }
    ])
  })

  it('formats the compact Chinese recency labels used by the upstream list', () => {
    expect(formatProjectUpdatedAt(9_970, 10_000)).toBe('刚刚')
    expect(formatProjectUpdatedAt(9_400, 10_000)).toBe('10 分钟前')
    expect(formatProjectUpdatedAt(2_800, 10_000)).toBe('2 小时前')
    expect(formatProjectUpdatedAt(null, 10_000)).toBe('—')
  })

  it('filters the public catalog and preserves category order for the two-column view', () => {
    const installed = new Set(['latex'])
    expect(filterMarketplaceCatalog('', installed).map((item) => item.name)).toEqual(['LaTeX'])
    expect(filterMarketplaceCatalog('design').map((item) => item.name)).toEqual([
      'Figma',
      'Canva',
      'Product Design',
      'Game Studio'
    ])
    expect(groupMarketplaceCatalog(filterMarketplaceCatalog('Slack'))).toEqual([
      {
        category: 'Communication',
        items: [expect.objectContaining({ id: 'slack' })]
      }
    ])
  })

  it('matches the native 30px sidebar row rounding and subtle light selection', () => {
    expect(styles).toMatch(/\.marketplace-sidebar-nav > button\s*\{[^}]*height: 30px;[^}]*border-radius: 12\.5px;/s)
    expect(styles).toMatch(/:root\[data-theme='light'\] \.marketplace-sidebar-nav > button:hover,\s*:root\[data-theme='light'\] \.marketplace-sidebar-nav > button\.active\s*\{[^}]*background: rgb\(0 0 0 \/ 6%\);/s)
  })
})
