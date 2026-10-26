import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GitMetadata, GitMetadataFailure } from '../../shared/api'
import { EmptyConversationHeading, EmptyConversationProjectHero, heroRepositoryKind } from './EmptyConversationHero'

const git: GitMetadata = {
  requestedPath: '/project', isRepository: true, root: '/project', branch: 'main', head: 'a1', detached: false,
  dirty: null, remotes: [], remoteCount: 0, remoteNamesRedacted: true, worktrees: []
}
const render = (props: Parameters<typeof EmptyConversationHeading>[0]): string => renderToStaticMarkup(createElement(EmptyConversationHeading, props))

afterEach(() => { vi.unstubAllGlobals() })

describe('empty conversation project heading', () => {
  it('uses the recovered no-project message without inventing a selected project', () => {
    expect(render({ cwd: null, workspaceName: '', onPickProject: vi.fn() })).toBe('<h2>我们要构建什么？</h2>')
  })

  it('uses the recovered project message with an accessible project action', () => {
    expect(render({ cwd: '/work/codex-app', workspaceName: 'codex-app', repositoryKind: 'git', onPickProject: vi.fn() }))
      .toBe('<h2>你想让我们在 <button type="button" aria-label="选择项目，当前为 codex-app">codex-app</button> 中构建什么？</h2>')
  })

  it.each(['directory', 'unknown'] as const)('uses the neutral work message for %s metadata', (repositoryKind) => {
    expect(render({ cwd: '/work/notes', workspaceName: 'notes', repositoryKind, onPickProject: vi.fn() }))
      .toBe('<h2>我们应该在<button type="button" aria-label="选择项目，当前为 notes">notes</button>中做些什么？</h2>')
  })

  it('falls back to a directory name and escapes names as ordinary text', () => {
    expect(render({ cwd: '/work/<draft>/', workspaceName: ' ', repositoryKind: 'git' }))
      .toBe('<h2>你想让我们在 <span>&lt;draft&gt;</span> 中构建什么？</h2>')
  })

  it('recognizes detached Git repositories without relying on a branch name', () => {
    expect(heroRepositoryKind(git)).toBe('git')
    expect(heroRepositoryKind({ ...git, branch: null, detached: true })).toBe('git')
  })

  it('distinguishes a verified non-repository from unavailable Git metadata', () => {
    expect(heroRepositoryKind({ requestedPath: '/project', isRepository: false, reason: 'not-repository' })).toBe('directory')
    for (const reason of ['invalid-path', 'not-directory', 'timeout', 'git-unavailable', 'unavailable'] satisfies GitMetadataFailure[]) {
      expect(heroRepositoryKind({ requestedPath: '/project', isRepository: false, reason })).toBe('unknown')
    }
  })

  it('defers native metadata access until the mounted renderer effect', () => {
    const nativeAccess = vi.fn(() => { throw new Error('Native bridge must remain deferred during SSR') })
    vi.stubGlobal('window', { codex: new Proxy({}, { get: nativeAccess }) })
    expect(renderToStaticMarkup(createElement(EmptyConversationProjectHero, { cwd: '/project', workspaceName: 'project', onPickProject: vi.fn() })))
      .toContain('我们应该在<button')
    expect(nativeAccess).not.toHaveBeenCalled()
  })
})
