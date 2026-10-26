export interface WorkspaceMarkdownMetadataEntry { key: string; value: string | string[] }
export interface WorkspaceMarkdownFrontmatter { to: number; entries: WorkspaceMarkdownMetadataEntry[] }

// Recovered from the installed app's BJn/VJn parser. This intentionally displays
// its supported scalar/list subset rather than interpreting YAML objects.
export function workspaceMarkdownFrontmatter(content: string): WorkspaceMarkdownFrontmatter | null {
  const lines = content.split('\n')
  if (!/^-{3,}$/.test(lines[0]?.replace(/^\uFEFF/, '').trim() ?? '')) return null
  const closing = lines.findIndex((line, index) => index > 0 && /^-{3,}$/.test(line.trim()))
  if (closing === -1) return null
  const entries: WorkspaceMarkdownMetadataEntry[] = []
  let hasMetadataSyntax = false
  for (let index = 1; index < closing; index++) {
    const line = lines[index], trimmed = line.trim(), separator = line.indexOf(':')
    if (!trimmed || trimmed.startsWith('#') || /^[ \t]/.test(line) || separator <= 0) continue
    const key = line.slice(0, separator).trim()
    if (!key || key.startsWith('-')) continue
    hasMetadataSyntax = true
    const raw = line.slice(separator + 1).trim()
    if (!raw) {
      const values: string[] = []
      let next = index + 1
      for (; next < closing; next++) {
        const item = /^[ \t]*-[ \t]*(.*)$/.exec(lines[next])
        if (!item) break
        const value = scalar(item[1].trim(), true)
        if (value !== null) values.push(value)
      }
      if (next > index + 1) { if (values.length) entries.push({key, value: values}); index = next - 1; continue }
      if (lines[index + 1] && /^[ \t]/.test(lines[index + 1]) && lines[index + 1].trim()) continue
      entries.push({key, value: ''}); continue
    }
    const value = raw.startsWith('[') ? inlineList(raw) : scalar(raw)
    if (value !== null && (!Array.isArray(value) || value.length)) entries.push({key, value})
  }
  return hasMetadataSyntax ? {to: lines.slice(0, closing + 1).join('\n').length, entries} : null
}

function scalar(value: string, list = false): string | null {
  if (value.startsWith('[') || value.startsWith('{') || /^[>|][+-]?$/.test(value) || (list && (value.startsWith('-') || /:\s/.test(value)))) return null
  if (value[0] === '"' || value[0] === "'") {
    const quoted = quotedValue(value, 0)
    return quoted && !value.slice(quoted.next).trim() ? quoted.value : null
  }
  return value
}

function quotedValue(source: string, start: number): {value: string; next: number} | null {
  const quote = source[start]
  let value = ''
  for (let index = start + 1; index < source.length; index++) {
    const char = source[index]
    if (quote === '"' && char === '\\') {
      const escaped = source[++index]
      if (escaped === undefined) return null
      value += escaped === 'n' ? '\n' : escaped === 'r' ? '\r' : escaped === 't' ? '\t' : escaped
    } else if (quote === "'" && char === "'" && source[index + 1] === "'") { value += "'"; index++ }
    else if (char === quote) return {value, next: index + 1}
    else value += char
  }
  return null
}

function inlineList(source: string): string[] | null {
  const values: string[] = []
  let index = 1
  for (;;) {
    while (/\s/.test(source[index] ?? '') && index < source.length) index++
    if (source[index] === ']') return !source.slice(index + 1).trim() ? values : null
    if (index >= source.length || source[index] === '[' || source[index] === '{') return null
    if (source[index] === '"' || source[index] === "'") {
      const result = quotedValue(source, index)
      if (!result) return null
      values.push(result.value); index = result.next
    } else {
      let end = index
      while (end < source.length && source[end] !== ',' && source[end] !== ']') end++
      const value = source.slice(index, end).trim()
      if (!value || value.startsWith('-') || /:\s/.test(value)) return null
      values.push(value); index = end
    }
    while (/\s/.test(source[index] ?? '') && index < source.length) index++
    if (source[index] === ',') { index++; continue }
    return source[index] === ']' && !source.slice(index + 1).trim() ? values : null
  }
}
