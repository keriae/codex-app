import { describe, expect, it } from 'vitest'
import { subagentActivityEntries, subagentAvatarIndex, subagentDisplayName, subagentNames } from './subagentActivityModel'
import type { ThreadItem } from './protocol'

describe('original subagent activity identity', () => {
  it('normalizes only the final non-root path segment', () => {
    expect(subagentDisplayName('/root/REA_audit')).toBe('Rea audit')
    expect(subagentDisplayName('/root/resource-provenance')).toBe('Resource provenance')
    expect(subagentDisplayName('/root')).toBeNull()
  })
  it('uses the original modulo hash and palette order', () => {
    expect(subagentAvatarIndex('a')).toBe(13)
    expect(subagentAvatarIndex('abc')).toBe(6)
    expect(subagentAvatarIndex('')).toBe(0)
  })
  it('preserves a known name when wait results only contain a thread ID', () => {
    const items: ThreadItem[] = [{ type: 'collabAgentToolCall', id: 'spawn', tool: 'spawnAgent', receiverThreads: [{ threadId: 'child', agentNickname: 'Ada' }] }]
    expect(subagentActivityEntries({ type: 'collabAgentToolCall', id: 'wait', agentsStates: { child: { status: 'completed' } } }, subagentNames(items)))
      .toEqual([{ threadId: 'child', name: 'Ada', status: 'completed' }])
  })
})
