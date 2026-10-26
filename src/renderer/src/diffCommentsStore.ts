import { useCallback, useSyncExternalStore } from 'react'
import { diffCommentFingerprint, type DiffCommentAttachment } from './diffComments'

const EMPTY: readonly DiffCommentAttachment[] = Object.freeze([])

function snapshot(
  comments: readonly DiffCommentAttachment[], current: readonly DiffCommentAttachment[]
): readonly DiffCommentAttachment[] {
  const byId = new Map<string, DiffCommentAttachment>()
  for (const comment of comments) byId.set(comment.id, comment)
  const previousById = new Map(current.map((comment) => [comment.id, comment]))
  const next = [...byId.values()].map((comment) => {
    const previous = previousById.get(comment.id)
    if (previous && diffCommentFingerprint(previous) === diffCommentFingerprint(comment)) return previous
    return Object.freeze({ ...comment, position: Object.freeze({ ...comment.position }),
      content: Object.freeze(comment.content.map((part) => Object.freeze({ ...part }))) })
  })
  return current.length === next.length && current.every((comment, i) => comment === next[i])
    ? current : Object.freeze(next)
}

/** Root-owned state: navigating or hiding a pane does not destroy saved attachments. */
export class DiffCommentsStore {
  private readonly scopes = new Map<string, readonly DiffCommentAttachment[]>()
  private readonly listeners = new Set<() => void>()
  private readonly migrationAliases = new WeakMap<DiffCommentAttachment, DiffCommentAttachment>()

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(scope: string): readonly DiffCommentAttachment[] { return this.scopes.get(scope) ?? EMPTY }

  set(scope: string, comments: readonly DiffCommentAttachment[]): void {
    const current = this.getSnapshot(scope)
    const next = snapshot(comments, current)
    if (current === next) return
    if (next.length) this.scopes.set(scope, next)
    else this.scopes.delete(scope)
    this.emit()
  }

  upsert(scope: string, comment: DiffCommentAttachment): void {
    const comments = this.getSnapshot(scope)
    this.set(scope, comments.some((item) => item.id === comment.id)
      ? comments.map((item) => item.id === comment.id ? comment : item) : [...comments, comment])
  }

  remove(scope: string, id: string): void { this.set(scope, this.getSnapshot(scope).filter((comment) => comment.id !== id)) }
  clear(scope: string): void { this.set(scope, EMPTY) }

  /** Copy into a destination; its newer edits win when the same id already exists. */
  merge(sourceScope: string, targetScope: string): void {
    if (sourceScope === targetScope) return
    const target = this.getSnapshot(targetScope)
    const ids = new Set(target.map((comment) => comment.id))
    const targetFingerprints = new Set(target.map(diffCommentFingerprint))
    const additional = this.getSnapshot(sourceScope).filter((comment) => {
      const fingerprint = diffCommentFingerprint(comment)
      if (ids.has(comment.id) || targetFingerprints.has(fingerprint)) return false
      ids.add(comment.id)
      return true
    })
    this.set(targetScope, [...target, ...additional])
  }

  /** Atomically migrate an independent draft to the server-assigned conversation. */
  move(sourceScope: string, targetScope: string): void {
    if (sourceScope === targetScope) return
    const source = this.getSnapshot(sourceScope)
    const target = this.getSnapshot(targetScope)
    const byId = new Map(target.map((comment) => [comment.id, comment]))
    const byTargetFingerprint = new Map(target.map((comment) => [diffCommentFingerprint(comment), comment]))
    const additional = source.filter((comment) => {
      const fingerprint = diffCommentFingerprint(comment)
      const existing = byId.get(comment.id) ?? byTargetFingerprint.get(fingerprint)
      if (existing) {
        // An equivalent destination attachment represents this submitted object.
        // A newer edit under the same id does not represent the old submission.
        if (existing !== comment && diffCommentFingerprint(existing) === fingerprint) {
          this.migrationAliases.set(comment, existing)
        }
        return false
      }
      byId.set(comment.id, comment)
      return true
    })
    if (additional.length) this.scopes.set(targetScope, Object.freeze([...target, ...additional]))
    const removed = this.scopes.delete(sourceScope)
    if (additional.length || removed) this.emit()
  }

  /** A successful send must preserve comments added or edited while it was pending. */
  removeSubmitted(scope: string, submitted: readonly DiffCommentAttachment[]): void {
    const consumed = new Set<DiffCommentAttachment>()
    for (const comment of submitted) {
      let represented: DiffCommentAttachment | undefined = comment
      while (represented && !consumed.has(represented)) {
        consumed.add(represented)
        represented = this.migrationAliases.get(represented)
      }
    }
    this.set(scope, this.getSnapshot(scope).filter((comment) => !consumed.has(comment)))
  }

  private emit(): void { for (const listener of [...this.listeners]) listener() }
}

export function useDiffComments(store: DiffCommentsStore, scope: string): readonly DiffCommentAttachment[] {
  const getSnapshot = useCallback(() => store.getSnapshot(scope), [store, scope])
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}
