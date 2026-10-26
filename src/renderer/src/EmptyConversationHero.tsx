import { useEffect, useState, type ReactNode } from 'react'
import type { GitMetadata } from '../../shared/api'

export type HeroRepositoryKind = 'git' | 'directory' | 'unknown'

export function heroRepositoryKind(metadata: GitMetadata): HeroRepositoryKind {
  if (metadata.isRepository) return 'git'
  return metadata.reason === 'not-repository' ? 'directory' : 'unknown'
}

export function EmptyConversationHeading({ cwd, workspaceName, repositoryKind = 'unknown', onPickProject }: {
  cwd: string | null; workspaceName: string; repositoryKind?: HeroRepositoryKind
  onPickProject?(): void
}): ReactNode {
  if (!cwd) return <h2>我们要构建什么？</h2>
  // Exact zh-CN hero messages from the currently installed build 21828.
  const projectName = workspaceName.trim() || cwd.split('/').filter(Boolean).at(-1) || cwd
  const project = onPickProject ? <button type="button" aria-label={`选择项目，当前为 ${projectName}`} onClick={onPickProject}>{projectName}</button> : <span>{projectName}</span>
  return repositoryKind === 'git'
    ? <h2>你想让我们在 {project} 中构建什么？</h2>
    : <h2>我们应该在{project}中做些什么？</h2>
}

export function EmptyConversationProjectHero({ cwd, workspaceName, onPickProject }: {
  cwd: string | null; workspaceName: string; onPickProject?(): void
}): ReactNode {
  const [repository, setRepository] = useState<{ cwd: string | null; kind: HeroRepositoryKind }>({ cwd: null, kind: 'unknown' })
  useEffect(() => {
    if (!cwd) return
    let active = true
    void window.codex.getGitMetadata(cwd, { redactRemoteNames: true }).then((metadata) => {
      if (active) setRepository({ cwd, kind: heroRepositoryKind(metadata) })
    }).catch(() => { if (active) setRepository({ cwd, kind: 'unknown' }) })
    return () => { active = false }
  }, [cwd])
  return <EmptyConversationHeading cwd={cwd} workspaceName={workspaceName}
    repositoryKind={repository.cwd === cwd ? repository.kind : 'unknown'} onPickProject={onPickProject} />
}
