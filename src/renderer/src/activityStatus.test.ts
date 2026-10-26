import { describe, expect, it } from 'vitest'
import {
  completedActivityStatusLabel,
  formatTurnDuration,
  liveActivityStatusLabel,
  workedForActivityStatusLabel
} from './activityStatus'

describe('conversation activity status copy', () => {
  it('uses the original first-second and elapsed working labels', () => {
    expect(liveActivityStatusLabel(0, 'zh-CN')).toBe('处理中')
    expect(liveActivityStatusLabel(999, 'zh-CN')).toBe('处理中')
    expect(liveActivityStatusLabel(1_000, 'zh-CN')).toBe('已处理 1秒')
    expect(liveActivityStatusLabel(61_000, 'zh-CN')).toBe('已处理 1分钟 1秒')
  })

  it('distinguishes completed and user-stopped turns', () => {
    expect(completedActivityStatusLabel(2_000, 'completed', 'zh-CN')).toBe('用时 2秒')
    expect(completedActivityStatusLabel(2_000, 'interrupted', 'zh-CN')).toBe('你在 2秒 后停止了')
    expect(completedActivityStatusLabel(2_000, 'failed', 'zh-CN')).toBe('用时 2秒')
  })

  it('matches the shipped compact-unit trimming and day rollover', () => {
    expect(formatTurnDuration(0, 'zh-CN')).toBe('0秒')
    expect(formatTurnDuration(60_000, 'zh-CN')).toBe('1分钟')
    expect(formatTurnDuration(3_600_000, 'zh-CN')).toBe('1小时')
    expect(formatTurnDuration(3_661_000, 'zh-CN')).toBe('1小时 1分钟 1秒')
    expect(formatTurnDuration(90_061_000, 'zh-CN')).toBe('1天 1小时 1分钟 1秒')
  })

  it('uses locale-sensitive narrow units', () => {
    expect(formatTurnDuration(61_000)).toBe('1m 1s')
    expect(formatTurnDuration(3_661_000, 'en-US')).toBe('1h 1m 1s')
    expect(formatTurnDuration(61_000, 'de-DE')).toBe('1 Min. 1 Sek.')
    expect(formatTurnDuration(61_000, 'hu-HU')).toBe('1p 1mp')
  })

  it('prefers the worked-for lifecycle and timestamps over the turn fallback', () => {
    expect(workedForActivityStatusLabel({ status: 'worked', startedAtMs: 1_000, completedAtMs: 62_000 }, 9_000, 'completed', Date.now(), 'zh-CN')).toBe('用时 1分钟 1秒')
    expect(workedForActivityStatusLabel({ status: 'stopped', startedAtMs: 0, completedAtMs: 2_000 }, 9_000, 'completed', Date.now(), 'zh-CN')).toBe('你在 2秒 后停止了')
    expect(workedForActivityStatusLabel({ status: 'working', startedAtMs: 1_000 }, 9_000, 'inProgress', 1_500, 'zh-CN')).toBe('处理中')
    expect(workedForActivityStatusLabel({ status: 'working', startedAtMs: 1_000 }, 9_000, 'inProgress', 4_000, 'zh-CN')).toBe('已处理 3秒')
    expect(workedForActivityStatusLabel({ status: 'paused', startedAtMs: 1_000 }, 9_000, 'completed', Date.now(), 'zh-CN')).toBe('已暂停')
    expect(workedForActivityStatusLabel({ status: 'unknown' }, 9_000, 'completed', Date.now(), 'zh-CN')).toBe('活动')
  })
})
