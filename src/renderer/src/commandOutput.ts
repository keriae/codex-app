import type { CommandItem } from './protocol'

/** The installed shell block removes launcher/quoting syntax for display only. */
export function commandOutputDisplayCommand(command: string): string {
  const unquote = (value: string): string => {
    let text = value.trim()
    let changed = true
    while (changed) {
      changed = false
      if (text.startsWith("$'") && text.endsWith("'")) {
        text = text.slice(2, -1).replace(/\\'/g, "'")
        changed = true
        continue
      }
      if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
        const doubleQuoted = text.startsWith('"')
        text = text.slice(1, -1).replace(/'"'"'/g, "'")
        if (doubleQuoted) text = text.replace(/\\"/g, '"')
        changed = true
      }
    }
    return text
  }
  const normalize = (value: string): string => {
    let text = value.trim().replace(/^\$\s+/, '')
    if (text.startsWith("'") && text.endsWith("'\"'\"")) text += "''"
    text = text.replace(/'"'"'/g, "'")
    while ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
      text = text.slice(1, -1).trim()
    }
    return text.trim()
  }
  const text = unquote(normalize(command))
  const launcher = text.match(/^(?:\/bin\/zsh|\/bin\/bash|zsh|bash)\s+-lc\s+([\s\S]+)$/)
  if (launcher) return normalize(unquote(launcher[1]?.trim() ?? ''))
  const nestedLauncher = command.match(/(?:\/bin\/zsh|\/bin\/bash|zsh|bash)\s+-lc\s+([\s\S]+)$/)
  return normalize(nestedLauncher ? unquote(nestedLauncher[1]?.trim() ?? '') : text)
}

export function commandOutputText(item: Pick<CommandItem, 'aggregatedOutput' | 'status'>): string {
  const output = item.aggregatedOutput || ''
  return /\S/.test(output) ? output : item.status === 'inProgress' ? '' : '无输出'
}
