import { describe, expect, it } from 'vitest'
import {
  backgroundTerminalStatus,
  mergeBackgroundTerminals,
  normalizeBackgroundTerminalsPage,
  normalizeTerminateResponse,
  shouldRefreshBackgroundTerminals
} from './backgroundTerminals'

describe('background terminal protocol helpers', () => {
  it('normalizes the local 0.163.0 experimental list shape', () => {
    expect(
      normalizeBackgroundTerminalsPage({
        data: [
          {
            itemId: 'synthetic-item',
            processId: 'synthetic-process',
            command: 'synthetic command',
            cwd: '/synthetic/workspace',
            osPid: 123,
            cpuPercent: null,
            rssKb: 456
          }
        ],
        nextCursor: 'opaque-cursor'
      })
    ).toEqual({
      data: [
        {
          itemId: 'synthetic-item',
          processId: 'synthetic-process',
          command: 'synthetic command',
          cwd: '/synthetic/workspace',
          osPid: 123,
          cpuPercent: null,
          rssKb: 456
        }
      ],
      nextCursor: 'opaque-cursor'
    })
    expect(backgroundTerminalStatus()).toBe('Running')
  })

  it('rejects malformed process identities and terminate responses', () => {
    expect(() =>
      normalizeBackgroundTerminalsPage({
        data: [{ itemId: 'item', processId: '', command: '', cwd: '' }]
      })
    ).toThrow('processId')
    expect(() => normalizeTerminateResponse({ terminated: 'yes' })).toThrow(
      'terminate response'
    )
  })

  it('deduplicates paginated results by opaque process id', () => {
    const first = normalizeBackgroundTerminalsPage({
      data: [
        {
          itemId: 'item-a',
          processId: 'process-a',
          command: 'first synthetic command',
          cwd: '/synthetic'
        }
      ]
    }).data
    const second = normalizeBackgroundTerminalsPage({
      data: [
        {
          itemId: 'item-a',
          processId: 'process-a',
          command: 'updated synthetic command',
          cwd: '/synthetic'
        },
        {
          itemId: 'item-b',
          processId: 'process-b',
          command: 'second synthetic command',
          cwd: '/synthetic'
        }
      ]
    }).data

    expect(mergeBackgroundTerminals(first, second).map((terminal) => terminal.command)).toEqual([
      'updated synthetic command',
      'second synthetic command'
    ])
    expect(normalizeTerminateResponse({ terminated: true })).toEqual({ terminated: true })
  })

  it('refreshes only for this thread background command lifecycle', () => {
    expect(
      shouldRefreshBackgroundTerminals(
        {
          method: 'item/completed',
          params: {
            threadId: 'synthetic-thread',
            item: {
              type: 'commandExecution',
              processId: 'synthetic-process'
            }
          }
        },
        'synthetic-thread'
      )
    ).toBe(true)
    expect(
      shouldRefreshBackgroundTerminals(
        {
          method: 'item/commandExecution/outputDelta',
          params: {
            threadId: 'synthetic-thread',
            item: { type: 'commandExecution', processId: 'synthetic-process' }
          }
        },
        'synthetic-thread'
      )
    ).toBe(false)
    expect(
      shouldRefreshBackgroundTerminals(
        {
          method: 'item/started',
          params: {
            threadId: 'another-thread',
            item: { type: 'commandExecution', processId: 'synthetic-process' }
          }
        },
        'synthetic-thread'
      )
    ).toBe(false)
  })
})
