import { describe, expect, it } from 'vitest'
import { buildLiveGoalStructure, buildRealtimePressure } from './live-goal-structure'
import type { LiveMatch, Market, Markets, MatchDetailResponse } from '../types'

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
  it('keeps the remaining first-half duration available for the summary', () => {
    const result = buildLiveGoalStructure(match)
    expect(result.remainingMinutes).toBe(29)
    expect(result.probability).not.toBeNull()
  })

  it('uses market strength and trailing urgency without claiming shot coordinates', () => {
    const result = buildLiveGoalStructure(match)
    expect(result.homeShare).toBeGreaterThan(result.awayShare)
    expect(result.homePressure).toBeGreaterThan(result.awayPressure)
    expect(result.homePressure).toBeLessThanOrEqual(100)
    expect(result.pressureTimeline.at(-1)).toMatchObject({ minute: 20, home: result.homePressure, away: result.awayPressure })
    expect(result.pressureIndicators).toHaveLength(3)
    expect(result.marketCoverage).toBe(6)
    expect(result.homeHistoryRate).toBe(70)
    expect(result.limitations.join(' ')).toContain('不是真实射门或触球坐标')
    expect(result.confidence).toBe('较高')
  })
})

describe('buildRealtimePressure', () => {
  const detail: MatchDetailResponse = {
    fetchedAt: '',
    source: 'test',
    events: [],
    stats: [
      { kind: 5, label: '射正', home: '4', away: '1', homePercent: 80, awayPercent: 20 },
      { kind: 4, label: '射门', home: '8', away: '4', homePercent: 67, awayPercent: 33 },
      { kind: 7, label: '危险进攻', home: '24', away: '12', homePercent: 67, awayPercent: 33 },
      { kind: 0, label: '角球', home: '3', away: '1', homePercent: 75, awayPercent: 25 },
      { kind: 6, label: '进攻', home: '40', away: '30', homePercent: 57, awayPercent: 43 },
    ],
  }

  it('uses source statistics and recalculates after red-card and penalty events', () => {
    const base = buildRealtimePressure(match, detail)
    const adjusted = buildRealtimePressure(match, {
      ...detail,
      events: [
        { kind: 2, label: '红牌', minute: 15, extraMinute: 0, side: 'home', player: '', assist: '', note: '' },
        { kind: 7, label: '点球', minute: 18, extraMinute: 0, side: 'away', player: '', assist: '', note: '' },
      ],
    })

    expect(base.available).toBe(true)
    expect(base.home).toBeGreaterThan(base.away ?? 0)
    expect(adjusted.home).toBeLessThan(base.home ?? 0)
    expect(adjusted.away).toBeGreaterThan(base.away ?? 0)
  })
})
