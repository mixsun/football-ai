import { describe, expect, it } from 'vitest'
import { analyzeHalfGoal, deVigTwoWay } from './analysis'
import type { LiveMatch, Markets } from '../types'
const market = { opening: { left: 0.9, line: 1, right: 0.9 }, current: { left: 0.8, line: 1, right: 1 } }
const markets: Markets = { asian: market, europe: market, total: { ...market, current: { left: 0.82, line: 2.5, right: 1.02 } }, halfAsian: market, halfTotal: market, halfEurope: market }
const match = (minute: number, score = 0): LiveMatch => ({ id: 1, league: '测试', home: 'A', away: 'B', scheduledAt: '', actualStart: '', state: 1, minute, homeScore: score, awayScore: 0, homeHalfScore: score, awayHalfScore: 0, goalMinutes: score ? [12] : [], markets, sameMarketCount: 3 })
describe('half goal model', () => {
  it('removes margin and rewards lower over water', () => { expect(deVigTwoWay(1, 1)?.[0]).toBeCloseTo(0.5); expect(deVigTwoWay(0.7, 1.1)?.[0]).toBeGreaterThan(0.5) })
  it('continues predicting another goal after an early goal', () => {
    const result = analyzeHalfGoal(match(12, 1))
    expect(result.level).not.toBe('done')
    expect(result.probability).toBeLessThan(100)
    expect(result.label).toContain('下一球')
    expect(result.reason).toContain('再进至少一球')
  })
  it('keeps predicting after minute 25 when the first goal was scored early', () => {
    const result = analyzeHalfGoal(match(30, 1))
    expect(result.level).not.toBe('done')
    expect(result.label).toContain('下一球')
  })
  it('marks a first goal after minute 25 as complete', () => {
    const lateGoal = { ...match(30, 1), goalMinutes: [28] }
    expect(analyzeHalfGoal(lateGoal).level).toBe('done')
  })
  it('reduces probability as time runs out', () => expect(analyzeHalfGoal(match(5)).probability!).toBeGreaterThan(analyzeHalfGoal(match(40)).probability!))
})
