import { workspaceCitationMatches } from './workspaceFileLinks'

interface MarkdownNode {
  children?: MarkdownNode[]
  type: string
  url?: string
  value?: string
}

const NON_TEXT_CONTAINERS = new Set(['code', 'html', 'inlineCode', 'link'])

function citationNodes(value: string): MarkdownNode[] | null {
  const matches = workspaceCitationMatches(value)
  if (matches.length === 0) return null

  const nodes: MarkdownNode[] = []
  let offset = 0
  for (const match of matches) {
    if (match.start > offset) nodes.push({ type: 'text', value: value.slice(offset, match.start) })
    nodes.push({
      type: 'link',
      url: match.href,
      children: [{ type: 'text', value: match.label }]
    })
    offset = match.end
  }
  if (offset < value.length) nodes.push({ type: 'text', value: value.slice(offset) })
  return nodes
}

function transformChildren(node: MarkdownNode): void {
  if (!node.children || NON_TEXT_CONTAINERS.has(node.type)) return
  const next: MarkdownNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      next.push(...(citationNodes(child.value) || [child]))
    } else {
      transformChildren(child)
      next.push(child)
    }
  }
  node.children = next
}

export function remarkWorkspaceFileCitations(): (tree: MarkdownNode) => void {
  return transformChildren
}
