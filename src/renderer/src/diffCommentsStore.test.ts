import { describe, expect, it, vi } from 'vitest'
import { DiffCommentsStore } from './diffCommentsStore'
import type { DiffCommentAttachment } from './diffComments'

const comment = (id: string, text = id): DiffCommentAttachment => ({ id, type: 'comment',
  position: { path: 'src/a.ts', side: 'right', line: 4 }, content: [{ content_type: 'text', text }], localWorkspaceRoot: '/project' })

describe('conversation and draft comment attachment store', () => {
  it('isolates independent drafts and conversations, with stable immutable snapshots', () => {
    const store = new DiffCommentsStore()
    const changed = vi.fn()
    const unsubscribe = store.subscribe(changed)
    store.set('draft:first', [comment('a')])
    store.set('draft:second', [comment('b')])
    store.set('thread:one', [comment('c')])
    const first = store.getSnapshot('draft:first')
    expect(store.getSnapshot('draft:first')).toBe(first)
    expect(first.map((item) => item.id)).toEqual(['a'])
    expect(store.getSnapshot('draft:second').map((item) => item.id)).toEqual(['b'])
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first[0])).toBe(true)
    expect(Object.isFrozen(first[0].position)).toBe(true)
    expect(Object.isFrozen(first[0].content)).toBe(true)
    store.set('draft:first', [comment('a')])
    expect(changed).toHaveBeenCalledTimes(3)
    unsubscribe(); store.clear('thread:one')
    expect(changed).toHaveBeenCalledTimes(3)
  })

  it('updates and deletes only the requested attachment in its scope', () => {
    const store = new DiffCommentsStore()
    store.set('one', [comment('a'), comment('b')])
    store.set('two', [comment('a')])
    store.upsert('one', comment('a', 'Edited'))
    store.remove('one', 'b')
    expect(store.getSnapshot('one')).toEqual([comment('a', 'Edited')])
    expect(store.getSnapshot('two')).toEqual([comment('a')])
  })

  it('copies without consuming the source and deduplicates identity and content', () => {
    const store = new DiffCommentsStore()
    store.set('draft', [comment('same-id', 'Old'), comment('duplicate-content', 'Existing'), comment('new')])
    store.set('thread', [comment('same-id', 'Newer target edit'), comment('target-copy', 'Existing')])
    store.merge('draft', 'thread')
    expect(store.getSnapshot('thread').map((item) => item.id)).toEqual(['same-id', 'target-copy', 'new'])
    expect(store.getSnapshot('thread')[0].content[0].text).toBe('Newer target edit')
    expect(store.getSnapshot('draft')).toHaveLength(3)
  })

  it('atomically moves a consumed draft into its final thread, preserving another draft', () => {
    const store = new DiffCommentsStore()
    store.set('draft:first', [comment('a')]); store.set('draft:second', [comment('b')])
    store.set('thread', [comment('c')])
    const source = store.getSnapshot('draft:first')[0]
    const target = store.getSnapshot('thread')[0]
    const observed: string[][] = []
    store.subscribe(() => observed.push([...store.getSnapshot('draft:first'), ...store.getSnapshot('thread')].map((item) => item.id)))
    store.move('draft:first', 'thread')
    expect(store.getSnapshot('draft:first')).toEqual([])
    expect(store.getSnapshot('thread').map((item) => item.id)).toEqual(['c', 'a'])
    expect(store.getSnapshot('thread')[0]).toBe(target)
    expect(store.getSnapshot('thread')[1]).toBe(source)
    expect(store.getSnapshot('draft:second').map((item) => item.id)).toEqual(['b'])
    expect(observed).toEqual([['c', 'a']])
    store.move('draft:first', 'thread'); store.move('thread', 'thread')
    expect(observed).toHaveLength(1)
  })

  it('clears only the submitted snapshot and retains edits or new comments made during send', () => {
    const store = new DiffCommentsStore()
    store.set('thread', [comment('unchanged'), comment('edited')])
    const submitted = store.getSnapshot('thread')
    store.upsert('thread', comment('edited', 'Changed while waiting'))
    store.upsert('thread', comment('new'))
    expect(store.getSnapshot('thread')[0]).toBe(submitted[0])
    expect(store.getSnapshot('thread')[1]).not.toBe(submitted[1])
    store.removeSubmitted('thread', submitted)
    expect(store.getSnapshot('thread')).toEqual([comment('edited', 'Changed while waiting'), comment('new')])
    store.removeSubmitted('thread', submitted)
    expect(store.getSnapshot('thread')).toHaveLength(2)
  })

  it('removes a successfully submitted draft snapshot from its migrated scope', () => {
    const store = new DiffCommentsStore()
    store.set('draft', [comment('submitted')])
    const submitted = store.getSnapshot('draft')
    store.move('draft', 'thread')
    store.upsert('thread', comment('new'))
    store.removeSubmitted('thread', submitted)
    expect(store.getSnapshot('thread').map((item) => item.id)).toEqual(['new'])
  })

  it.each([false, true])('preserves identical source comments during move with an existing target: %s', (withTarget) => {
    const store = new DiffCommentsStore()
    store.set('draft', [comment('submitted', 'Same body')])
    const submitted = store.getSnapshot('draft')
    store.upsert('draft', comment('new-id', 'Same body'))
    const addedWhileWaiting = store.getSnapshot('draft')[1]
    if (withTarget) store.set('thread', [comment('target', 'Unrelated body')])
    store.move('draft', 'thread')
    const expectedTarget = withTarget ? ['target'] : []
    expect(store.getSnapshot('thread').map((item) => item.id)).toEqual([...expectedTarget, 'submitted', 'new-id'])
    expect(store.getSnapshot('thread').find((item) => item.id === 'submitted')).toBe(submitted[0])
    expect(store.getSnapshot('thread').find((item) => item.id === 'new-id')).toBe(addedWhileWaiting)
    expect(store.getSnapshot('draft')).toEqual([])
    store.removeSubmitted('thread', submitted)
    expect(store.getSnapshot('thread').map((item) => item.id)).toEqual([...expectedTarget, 'new-id'])
    expect(store.getSnapshot('thread').at(-1)).toBe(addedWhileWaiting)
  })

  it.each([false, true])('preserves identical source comments during merge with an existing target: %s', (withTarget) => {
    const store = new DiffCommentsStore()
    store.set('draft', [comment('first', 'Same body'), comment('second', 'Same body')])
    if (withTarget) store.set('thread', [comment('target', 'Unrelated body')])
    store.merge('draft', 'thread')
    expect(store.getSnapshot('thread').map((item) => item.id)).toEqual([...(withTarget ? ['target'] : []), 'first', 'second'])
    expect(store.getSnapshot('draft').map((item) => item.id)).toEqual(['first', 'second'])
  })

  it('clears a migration-deduplicated equivalent attachment under its target identity', () => {
    const store = new DiffCommentsStore()
    store.set('draft', [comment('source-id', 'Same body')])
    store.set('thread', [comment('target-id', 'Same body')])
    const submitted = store.getSnapshot('draft')
    const target = store.getSnapshot('thread')[0]
    store.move('draft', 'thread')
    expect(store.getSnapshot('thread').map((item) => item.id)).toEqual(['target-id'])
    expect(store.getSnapshot('thread')[0]).toBe(target)
    store.removeSubmitted('thread', submitted)
    expect(store.getSnapshot('thread')).toEqual([])
  })

  it('preserves a new identity with identical content after the submitted comment is deleted', () => {
    const store = new DiffCommentsStore()
    store.set('thread', [comment('submitted', 'Same body')])
    const submitted = store.getSnapshot('thread')
    store.remove('thread', 'submitted')
    store.upsert('thread', comment('new-id', 'Same body'))
    store.removeSubmitted('thread', submitted)
    expect(store.getSnapshot('thread')).toEqual([comment('new-id', 'Same body')])
  })

  it('preserves an unsubmitted comment edited to match submitted content while waiting', () => {
    const store = new DiffCommentsStore()
    store.set('thread', [comment('submitted', 'Same body')])
    const submitted = store.getSnapshot('thread')
    store.upsert('thread', comment('new-id', 'Different body'))
    store.upsert('thread', comment('new-id', 'Same body'))
    store.removeSubmitted('thread', submitted)
    expect(store.getSnapshot('thread')).toEqual([comment('new-id', 'Same body')])
  })

  it('preserves the same id deleted and recreated with identical content while waiting', () => {
    const store = new DiffCommentsStore()
    store.set('thread', [comment('submitted', 'Same body')])
    const submitted = store.getSnapshot('thread')
    store.remove('thread', 'submitted')
    store.upsert('thread', comment('submitted', 'Same body'))
    expect(store.getSnapshot('thread')[0]).not.toBe(submitted[0])
    store.removeSubmitted('thread', submitted)
    expect(store.getSnapshot('thread')).toEqual([comment('submitted', 'Same body')])
  })

  it('preserves a submitted id edited away and back to its original content', () => {
    const store = new DiffCommentsStore()
    store.set('thread', [comment('submitted', 'Original body')])
    const submitted = store.getSnapshot('thread')
    store.upsert('thread', comment('submitted', 'Changed body'))
    store.upsert('thread', comment('submitted', 'Original body'))
    store.removeSubmitted('thread', submitted)
    expect(store.getSnapshot('thread')).toEqual([comment('submitted', 'Original body')])
  })

  it('does not clear copies placed into another independent scope', () => {
    const store = new DiffCommentsStore()
    store.set('original', [comment('submitted')])
    const submitted = store.getSnapshot('original')
    store.set('independent', submitted)
    expect(store.getSnapshot('independent')[0]).not.toBe(submitted[0])
    store.removeSubmitted('independent', submitted)
    expect(store.getSnapshot('independent')).toEqual([comment('submitted')])
    store.removeSubmitted('original', submitted)
    expect(store.getSnapshot('original')).toEqual([])
  })

  it('follows equivalent migration aliases through multiple destination identities', () => {
    const store = new DiffCommentsStore()
    store.set('draft', [comment('source-id', 'Same body')])
    store.set('intermediate', [comment('intermediate-id', 'Same body')])
    store.set('thread', [comment('target-id', 'Same body')])
    const submitted = store.getSnapshot('draft')
    store.move('draft', 'intermediate')
    store.move('intermediate', 'thread')
    store.upsert('thread', comment('new-id', 'Same body'))
    store.removeSubmitted('thread', submitted)
    expect(store.getSnapshot('thread')).toEqual([comment('new-id', 'Same body')])
  })

  it('preserves an equivalent migration target deleted and recreated while waiting', () => {
    const store = new DiffCommentsStore()
    store.set('draft', [comment('source-id', 'Same body')])
    store.set('thread', [comment('target-id', 'Same body')])
    const submitted = store.getSnapshot('draft')
    store.move('draft', 'thread')
    store.remove('thread', 'target-id')
    store.upsert('thread', comment('target-id', 'Same body'))
    store.removeSubmitted('thread', submitted)
    expect(store.getSnapshot('thread')).toEqual([comment('target-id', 'Same body')])
  })

  it('does not alias a newer destination edit with the same submitted id', () => {
    const store = new DiffCommentsStore()
    store.set('draft', [comment('same-id', 'Original body')])
    store.set('thread', [comment('same-id', 'Newer body')])
    const submitted = store.getSnapshot('draft')
    store.move('draft', 'thread')
    store.removeSubmitted('thread', submitted)
    expect(store.getSnapshot('thread')).toEqual([comment('same-id', 'Newer body')])
  })
})
