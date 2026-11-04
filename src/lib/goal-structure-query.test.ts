import { describe, expect, it } from 'vitest'
import { calculateGoalStructure, type TeamStructureInput } from './goal-structure-query'

const team = (overrides: Partial<TeamStructureInput> = {}): TeamStructureInput => ({
  shortForm: 70, longForm: 60, boxEntries: 12, boxShots: 6, shotGoals: 1, redCards: 0, penalties: 0, ...overrides,
})

describe('goal structure query', () => {
  it('calculates the three requested ratios', () => {
    const result = calculateGoalStructure(team(), team(), 30)
    expect(result.home.entryToShotRatio).toBe(50)
    expect(result.home.shotToGoalRatio).toBe(17)
    expect(result.home.entryToGoalRatio).toBe(8)
  })

  it('recalculates both teams after a red card', () => {
    const baseline = calculateGoalStructure(team(), team(), 30)
    const adjusted = calculateGoalStructure(team({ redCards: 1 }), team(), 30)
    expect(adjusted.home.xgPlus).toBeLessThan(baseline.home.xgPlus)
    expect(adjusted.away.xgPlus).toBeGreaterThan(baseline.away.xgPlus)
    expect(adjusted.eventAdjusted).toBe(true)
  })

  it('adds penalty xG and marks the event recalculation', () => {
    const baseline = calculateGoalStructure(team(), team(), 30)
    const adjusted = calculateGoalStructure(team({ penalties: 1 }), team(), 30)
    expect(adjusted.home.xgPlus).toBeGreaterThan(baseline.home.xgPlus)
    expect(adjusted.home.adjustments[0]).toContain('点球')
  })

  it('does not invent a probability without structure evidence', () => {
    const empty = team({ boxEntries: 0, boxShots: 0, shotGoals: 0, penalties: 0 })
    expect(calculateGoalStructure(empty, empty, 20).probability).toBeNull()
  })

  it('only evaluates the next 20 minutes and clips at full time', () => {
    const normal = calculateGoalStructure(team(), team(), 30)
    const late = calculateGoalStructure(team(), team(), 82)
    expect([normal.windowStart, normal.windowEnd, normal.windowMinutes]).toEqual([30, 50, 20])
    expect([late.windowStart, late.windowEnd, late.windowMinutes]).toEqual([82, 90, 8])
  })
})
