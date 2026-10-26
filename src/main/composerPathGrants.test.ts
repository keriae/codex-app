import { describe, expect, it } from 'vitest'
import { ComposerPathGrants } from './composerPathGrants'

describe('composer path grants', () => {
  it('allows picker-granted files in turn start, steer, and durable queue requests', () => {
    const grants = new ComposerPathGrants()
    grants.grant(['/synthetic/image.png', '/synthetic/notes.md'])

    expect(() =>
      grants.assertAllowedRpc('turn/start', {
        input: [
          { type: 'text', text: 'Inspect these files' },
          { type: 'localImage', path: '/synthetic/image.png' },
          { type: 'mention', name: 'notes.md', path: '/synthetic/notes.md' }
        ]
      })
    ).not.toThrow()
    expect(() =>
      grants.assertAllowedRpc('turn/steer', {
        input: [{ type: 'mention', name: 'notes.md', path: '/synthetic/notes.md' }]
      })
    ).not.toThrow()
    expect(() =>
      grants.assertAllowedRpc('thread/queue/add', {
        input: [{ type: 'localImage', path: '/synthetic/image.png' }]
      })
    ).not.toThrow()
    expect(() =>
      grants.assertAllowedRpc('thread/queue/update', {
        input: [{ type: 'mention', name: 'notes.md', path: '/synthetic/notes.md' }]
      })
    ).not.toThrow()
  })

  it('rejects arbitrary absolute paths and ignores text-only methods', () => {
    const grants = new ComposerPathGrants()
    grants.grant(['/synthetic/selected.txt'])

    expect(() =>
      grants.assertAllowedRpc('turn/start', {
        input: [{ type: 'mention', name: 'private.txt', path: '/synthetic/private.txt' }]
      })
    ).toThrow('native file picker')
    expect(() =>
      grants.assertAllowedRpc('turn/start', {
        input: [{ type: 'text', text: 'No attachment' }]
      })
    ).not.toThrow()
    expect(() => grants.assertAllowedRpc('thread/read', { threadId: 'synthetic' })).not.toThrow()
  })

  it('bounds remembered paths', () => {
    const grants = new ComposerPathGrants(2)
    grants.grant(['/synthetic/one', '/synthetic/two', '/synthetic/three'])

    expect(() =>
      grants.assertAllowedRpc('turn/start', {
        input: [{ type: 'mention', name: 'one', path: '/synthetic/one' }]
      })
    ).toThrow('native file picker')
    expect(() =>
      grants.assertAllowedRpc('turn/start', {
        input: [{ type: 'mention', name: 'three', path: '/synthetic/three' }]
      })
    ).not.toThrow()
  })

  it('grants a selected directory under its submitted trailing-separator path', () => {
    const grants = new ComposerPathGrants()
    grants.grant(['/synthetic/project/'])

    expect(() =>
      grants.assertAllowedRpc('turn/start', {
        input: [{ type: 'mention', name: 'project', path: '/synthetic/project/' }]
      })
    ).not.toThrow()
    expect(() =>
      grants.assertAllowedRpc('turn/start', {
        input: [{ type: 'mention', name: 'project', path: '/synthetic/project' }]
      })
    ).toThrow('native file picker')
  })
})
