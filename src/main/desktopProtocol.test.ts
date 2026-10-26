import { describe, expect, it } from 'vitest'
import {
  DESKTOP_INITIALIZE_ID,
  DESKTOP_INITIALIZE_PARAMS,
  DESKTOP_OPT_OUT_NOTIFICATION_METHODS
} from './desktopProtocol'

describe('desktop protocol identity', () => {
  it('matches the observed desktop initialize identity', () => {
    expect(DESKTOP_INITIALIZE_ID).toBe('__codex_initialize__')
    expect(DESKTOP_INITIALIZE_PARAMS.clientInfo).toEqual({
      name: 'Codex Desktop',
      title: 'Codex Desktop',
      version: '26.1016.61520'
    })
  })

  it('keeps the reviewed opt-out list complete and unique', () => {
    expect(DESKTOP_OPT_OUT_NOTIFICATION_METHODS).toHaveLength(75)
    expect(new Set(DESKTOP_OPT_OUT_NOTIFICATION_METHODS)).toHaveLength(75)
    expect(DESKTOP_OPT_OUT_NOTIFICATION_METHODS).not.toContain('command/exec/outputDelta')
  })
})
