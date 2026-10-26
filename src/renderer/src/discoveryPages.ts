import type { Thread } from './protocol'
import { normalizeProjectPath } from './projects'

export interface ProjectListEntry {
  path: string
  name: string
  updatedAt: number | null
  threadCount: number
  current: boolean
}

export interface MarketplaceCatalogItem {
  id: string
  name: string
  description: string
  category: string
  icon: string
}

export const MARKETPLACE_CATALOG: MarketplaceCatalogItem[] = [
  {
    id: 'slack',
    name: 'Slack',
    description: 'Read and manage Slack',
    category: 'Communication',
    icon: 'slack'
  },
  {
    id: 'remotion',
    name: 'Remotion',
    description: 'Make videos agentically',
    category: 'Creativity',
    icon: 'remotion'
  },
  {
    id: 'hyperframes',
    name: 'HyperFrames by HeyGen',
    description: 'Write HTML, render video',
    category: 'Creativity',
    icon: 'hyperframes'
  },
  {
    id: 'figma',
    name: 'Figma',
    description: 'Figma design-to-code workflows',
    category: 'Creativity',
    icon: 'figma'
  },
  {
    id: 'canva',
    name: 'Canva',
    description: 'Create, review, edit designs',
    category: 'Creativity',
    icon: 'canva'
  },
  {
    id: 'product-design',
    name: 'Product Design',
    description: 'Explore and prototype ideas',
    category: 'Creativity',
    icon: 'product-design'
  },
  {
    id: 'higgsfield',
    name: 'Higgsfield',
    description: 'Every image and video model',
    category: 'Creativity',
    icon: 'higgsfield'
  },
  {
    id: 'mixpanel-headless',
    name: 'Mixpanel Headless',
    description: 'Analyze Mixpanel data with Python',
    category: 'Data & Analytics',
    icon: 'mixpanel'
  },
  {
    id: 'posthog',
    name: 'PostHog',
    description: 'Analyze your product data',
    category: 'Data & Analytics',
    icon: 'posthog'
  },
  {
    id: 'game-studio',
    name: 'Game Studio',
    description: 'Design, prototype, and ship browser games',
    category: 'Developer Tools',
    icon: 'game-studio'
  },
  {
    id: 'superpowers',
    name: 'Superpowers',
    description: 'Plan, develop, and debug code',
    category: 'Developer Tools',
    icon: 'superpowers'
  },
  {
    id: 'circleci',
    name: 'CircleCI',
    description: 'Build, test, and deploy any application',
    category: 'Developer Tools',
    icon: 'circleci'
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Inspect recent Sentry issues and events',
    category: 'Developer Tools',
    icon: 'sentry'
  },
  {
    id: 'build-ios-apps',
    name: 'Build iOS Apps',
    description: 'Build, refine, and debug iOS apps with App Intents, SwiftUI, and Xcode',
    category: 'Developer Tools',
    icon: 'terminal'
  },
  {
    id: 'build-macos-apps',
    name: 'Build macOS Apps',
    description: 'Build, debug, instrument, and implement macOS apps',
    category: 'Developer Tools',
    icon: 'terminal'
  },
  {
    id: 'latex',
    name: 'LaTeX',
    description: 'Compile LaTeX with TeX tools',
    category: 'Education & Research',
    icon: 'latex'
  },
  {
    id: 'life-science-research',
    name: 'Life Science Research',
    description: 'General life-sciences research with routing and evidence',
    category: 'Education & Research',
    icon: 'flask'
  },
  {
    id: 'zotero',
    name: 'Zotero',
    description: 'Search and organize research sources',
    category: 'Education & Research',
    icon: 'zotero'
  },
  {
    id: 'ngs-analysis',
    name: 'Life Sciences NGS Analysis',
    description: 'Analyze sequencing data and research workflows',
    category: 'Education & Research',
    icon: 'dna'
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Search, create, and update Linear issues',
    category: 'Productivity',
    icon: 'linear'
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Search and work with Notion pages',
    category: 'Productivity',
    icon: 'notion'
  }
]

function folderName(path: string): string {
  const pieces = path.split('/').filter(Boolean)
  return pieces.at(-1) || path
}

export function buildProjectList(
  paths: readonly string[],
  threads: readonly Thread[],
  currentPath: string | null
): ProjectListEntry[] {
  const current = normalizeProjectPath(currentPath)
  const recency = new Map<string, { updatedAt: number; count: number }>()

  for (const thread of threads) {
    const path = normalizeProjectPath(thread.cwd)
    if (!path) continue
    const updatedAt = thread.recencyAt ?? thread.updatedAt
    const existing = recency.get(path)
    recency.set(path, {
      updatedAt: Math.max(existing?.updatedAt ?? 0, updatedAt),
      count: (existing?.count ?? 0) + 1
    })
  }

  const seen = new Set<string>()
  const entries: ProjectListEntry[] = []
  for (const value of paths) {
    const path = normalizeProjectPath(value)
    if (!path || seen.has(path)) continue
    seen.add(path)
    const activity = recency.get(path)
    entries.push({
      path,
      name: folderName(path),
      updatedAt: activity?.updatedAt || null,
      threadCount: activity?.count ?? 0,
      current: path === current
    })
  }

  return entries.sort((left, right) => {
    const recencyDelta = (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
    if (recencyDelta !== 0) return recencyDelta
    if (left.current !== right.current) return left.current ? -1 : 1
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  })
}

export function formatProjectUpdatedAt(
  timestamp: number | null,
  nowSeconds = Date.now() / 1000
): string {
  if (!timestamp) return '—'
  const delta = Math.max(0, nowSeconds - timestamp)
  if (delta < 60) return '刚刚'
  if (delta < 3600) return `${Math.floor(delta / 60)} 分钟前`
  if (delta < 86400) return `${Math.floor(delta / 3600)} 小时前`
  if (delta < 604800) return `${Math.floor(delta / 86400)} 天前`
  if (delta < 2_592_000) return `${Math.floor(delta / 604800)} 周前`
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric'
  }).format(new Date(timestamp * 1000))
}

export function filterMarketplaceCatalog(
  query: string,
  installedNames: ReadonlySet<string> | null = null
): MarketplaceCatalogItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return MARKETPLACE_CATALOG.filter((item) => {
    if (installedNames && !installedNames.has(item.name.toLocaleLowerCase())) return false
    if (!normalizedQuery) return true
    return `${item.name} ${item.description} ${item.category}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  })
}

export function groupMarketplaceCatalog(
  items: readonly MarketplaceCatalogItem[]
): Array<{ category: string; items: MarketplaceCatalogItem[] }> {
  const groups = new Map<string, MarketplaceCatalogItem[]>()
  for (const item of items) {
    const group = groups.get(item.category)
    if (group) group.push(item)
    else groups.set(item.category, [item])
  }
  return [...groups].map(([category, groupedItems]) => ({
    category,
    items: groupedItems
  }))
}
