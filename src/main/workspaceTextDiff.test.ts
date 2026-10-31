import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { diffWorkspaceText, validateWorkspaceTextDiff } from './workspaceTextDiff'

describe('full workspace snapshot diff', () => {
  it('uses Git whitespace semantics while retaining real neighboring changes', async () => {
    const before = 'const a = 1;\nconst b = 2;\n'
    const after = 'const   a=1;  \nconst b = 3;\n'
    const ordinary = await diffWorkspaceText(before, after, { ignoreWhitespace: false })
    const filtered = await diffWorkspaceText(before, after, { ignoreWhitespace: true })
    expect(ordinary).toContain('-const a = 1;')
    expect(filtered).not.toContain('-const a = 1;')
    expect(filtered).toContain('-const b = 2;\n+const b = 3;')
    expect(filtered).toContain('--- a/file\n+++ b/file')
    expect(filtered).not.toContain('codex-replica-text-diff-')
  })

  it('returns no hunk for whitespace-only edits and keeps EOF differences', async () => {
    expect(await diffWorkspaceText('a = 1\n', 'a=1 \n', { ignoreWhitespace: true })).toBe('')
    const patch = await diffWorkspaceText('a = 1', 'a = 2\n', { ignoreWhitespace: true })
    expect(patch).toContain('\\ No newline at end of file')
    expect(patch).toContain('+a = 2')
  })

  it('passes text literally and removes private temporary snapshots even after failure', async () => {
    let temporary = ''
    await expect(diffWorkspaceText('$(echo unsafe)\n', '`echo unsafe`\n', { ignoreWhitespace: true },
      async (args, directory) => {
        temporary = directory
        expect(args).toEqual(['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3',
          '--ignore-all-space', '--', 'before', 'after'])
        expect(await readFile(join(directory, 'before'), 'utf8')).toBe('$(echo unsafe)\n')
        throw new Error('fixture runner failure')
      })).rejects.toThrow('fixture runner failure')
    expect(temporary).toContain('codex-replica-text-diff-')
    await expect(access(temporary)).rejects.toThrow()
  })

  it('rejects binary, byte-overlimit and command-shaped options before creating snapshots', () => {
    for (const [before, after, options] of [
      ['\0', '', { ignoreWhitespace: false }],
      ['', '界'.repeat(175_000), { ignoreWhitespace: true }],
      ['', '', { ignoreWhitespace: 'false' }],
      ['', '', { ignoreWhitespace: false, args: ['--output=/tmp/unsafe'] }],
      ['', '', null]
    ]) expect(() => validateWorkspaceTextDiff(before, after, options)).toThrow('Invalid workspace text diff request')
  })
})
