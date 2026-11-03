import { describe, expect, it } from 'vitest'
import { buildLiveGoalStructure } from './live-goal-structure'
import type { LiveMatch, Market, Markets } from '../types'

const market = (left: number, line: number, right: number): Market => ({ opening: { left, line, right }, current: { left, line, right } })
const markets: Markets = {
  asian: market(0.9, 0.5, 0.96), europe: market(1.8, 3.6, 4.2), total: market(0.86, 2.75, 1.02),
  halfAsian: market(0.9, 0.25, 0.94), halfTotal: market(0.84, 1.25, 1.02), halfEurope: market(2.1, 2.2, 4.8),
}
const match: LiveMatch = {
  id: 7, league: '测试联赛', home: '主队', away: '客队', scheduledAt: '', actualStart: '', state: 1, minute: 20,
  homeScore: 1, awayScore: 0, homeHalfScore: 1, awayHalfScore: 0, goalMinutes: [12], goalEvents: [{ minute: 12, side: 'home' }],
  halfGoalHistory: { home: { sample: 20, withGoal: 14 }, away: { sample: 20, withGoal: 12 } }, markets, sameMarketCount: 4,
}

describe('buildLiveGoalStructure', () => {
  it('keeps next-goal windows inside the remaining first half', () => {
    const result = buildLiveGoalStructure(match)
    expect(result.windows[0]?.start).toBe(20)
    expect(result.windows.at(-1)?.end).toBe(49)
    expect(result.windows.reduce((sum, item) => sum + item.probability, 0)).toBeCloseTo(result.probability ?? 0, -1)
  })

  it('uses market strength and trailing urgency without claiming shot coordinates', () => {
    const result = buildLiveGoalStructure(match)
    expect(result.homeShare).toBeGreaterThan(result.awayShare)
    expect(result.homePressure).toBeGreaterThan(result.awayPressure)
    expect(result.homePressure).toBeLessThanOrEqual(100)
    expect(result.limitations.join(' ')).toContain('不是真实射门或触球坐标')
    expect(result.confidence).toBe('较高')
  })
})
