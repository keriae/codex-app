import type { ThreadItem, Turn } from './protocol'
import type { ThreadSession } from './state/sessionReducer'
import { safeToolResourceUrl, toolResultBlocks } from './toolActivityModel'

export type WorkbenchBrowserRecentKind = 'file' | 'image' | 'website'

export interface WorkbenchBrowserRecentItem {
  id: string
  kind: WorkbenchBrowserRecentKind
  title: string
  subtitle: string
  target: string
  producedAtMs: number | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function fileName(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || path
}

function fileSubtitle(path: string): string {
  const extension = fileName(path).split('.').at(-1)?.toLowerCase()
  if (extension === 'pdf') return 'PDF'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'].includes(extension || '')) return '图片'
  if (['md', 'mdx', 'txt', 'doc', 'docx', 'rtf'].includes(extension || '')) return '文档'
  if (['ppt', 'pptx', 'key'].includes(extension || '')) return '演示文稿'
  if (['csv', 'tsv', 'xls', 'xlsx', 'numbers'].includes(extension || '')) return '电子表格'
  return '文件'
}

function turnTime(turn: Turn): number | null {
  const value = turn.completedAt ?? turn.startedAt
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return value < 10_000_000_000 ? value * 1_000 : value
}

function itemArtifacts(item: ThreadItem, turn: Turn): WorkbenchBrowserRecentItem[] {
  const producedAtMs = turnTime(turn)
  if (item.type === 'imageGeneration') {
    const path = text(item.savedPath)
    return path ? [{
      id: `${turn.id}:${item.id}:generated-image:${path}`,
      kind: 'image',
      title: fileName(path),
      subtitle: '生成图片',
      target: path,
      producedAtMs
    }] : []
  }

  if (item.type === 'fileChange') {
    return (item.changes || []).flatMap((change) => {
      const path = text(change.path)
      if (!path || change.kind?.type === 'delete') return []
      return [{
        id: `${turn.id}:${item.id}:file:${path}`,
        kind: 'file' as const,
        title: fileName(path),
        subtitle: fileSubtitle(path),
        target: path,
        producedAtMs
      }]
    })
  }

  if (item.type !== 'mcpToolCall' && item.type !== 'dynamicToolCall') return []
  return toolResultBlocks(item).flatMap((block, index) => {
    if (block.type !== 'resourceLink') return []
    const url = safeToolResourceUrl(block.uri)
    if (!url) return []
    return [{
      id: `${turn.id}:${item.id}:website:${index}:${url}`,
      kind: 'website' as const,
      title: block.name || new URL(url).hostname,
      subtitle: '网站',
      target: url,
      producedAtMs
    }]
  })
}

export function collectWorkbenchBrowserRecents(
  session: ThreadSession | null | undefined,
  limit = 24
): WorkbenchBrowserRecentItem[] {
  if (!session || limit <= 0) return []
  const recent: WorkbenchBrowserRecentItem[] = []
  const seen = new Set<string>()
  for (let turnIndex = session.turns.length - 1; turnIndex >= 0 && recent.length < limit; turnIndex -= 1) {
    const turn = session.turns[turnIndex]
    for (let itemIndex = turn.items.length - 1; itemIndex >= 0 && recent.length < limit; itemIndex -= 1) {
      const artifacts = itemArtifacts(turn.items[itemIndex], turn)
      for (let artifactIndex = artifacts.length - 1; artifactIndex >= 0 && recent.length < limit; artifactIndex -= 1) {
        const artifact = artifacts[artifactIndex]
        const key = `${artifact.kind}:${artifact.target}`
        if (seen.has(key)) continue
        seen.add(key)
        recent.push(artifact)
      }
    }
  }
  return recent
}

export function formatWorkbenchBrowserRecentTime(
  producedAtMs: number | null,
  now = new Date()
): { dateTime: string; label: string } | null {
  if (producedAtMs === null || !Number.isFinite(producedAtMs)) return null
  const date = new Date(producedAtMs)
  if (Number.isNaN(date.getTime())) return null
  const sameDay = date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  const label = sameDay
    ? new Intl.DateTimeFormat('zh-CN', { hour: 'numeric', minute: '2-digit', hour12: false }).format(date)
    : new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date)
  return { dateTime: date.toISOString(), label }
}
