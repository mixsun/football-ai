import { describe, expect, it } from 'vitest'
import { buildPressureGoalMarkers, buildPressureTimeline, matchClockMinute, pressureSummary } from './pressure'
import type { LiveMatch } from '../types'

const match = (overrides: Partial<LiveMatch> = {}): LiveMatch => ({
  id: 21, league: '中U21', home: '河南U21', away: '武汉三镇U21', scheduledAt: '', actualStart: '', state: 1, minute: 43,
  homeScore: 1, awayScore: 1, homeHalfScore: 1, awayHalfScore: 1, goalMinutes: [23, 42],
  goalEvents: [{ minute: 23, side: 'home' }, { minute: 42, side: 'away' }], markets: null, sameMarketCount: 1, ...overrides,
})

describe('attack pressure timeline', () => {
  it('builds bounded two-minute pressure samples through the current minute', () => {
    const points = buildPressureTimeline(match())
    expect(points[0].minute).toBe(0)
    expect(points.at(-1)?.minute).toBe(43)
    expect(points.length).toBe(23)
    expect(points.every((point) => point.home >= 0 && point.home <= 100 && point.away >= 0 && point.away <= 100)).toBe(true)
  })
  it('uses supplied live pressure data without replacing it', () => {
    const supplied = [{ minute: 5, home: 80, away: 20 }]
    expect(buildPressureTimeline(match({ pressureTimeline: supplied }))).toEqual([{ minute: 0, home: 80, away: 20 }, ...supplied])
  })
  it('summarizes the most recent five points', () => {
    expect(pressureSummary([{ minute: 1, home: 80, away: 20 }])).toEqual({ home: 80, away: 20, leader: '主队' })
  })
  it('adds a clearly inferred goal marker when the score exists without event minutes', () => {
    expect(buildPressureGoalMarkers(match({ minute: 10, homeScore: 1, awayScore: 0, goalMinutes: [], goalEvents: [] }))).toEqual([
      { minute: null, side: 'home', inferred: true },
    ])
  })
  it('keeps real goal minutes instead of adding inferred markers', () => {
    expect(buildPressureGoalMarkers(match()).map(({ minute, inferred }) => ({ minute, inferred }))).toEqual([
      { minute: 23, inferred: false }, { minute: 42, inferred: false },
    ])
  })
  it('prefers a more complete minute list when browser score events are incomplete', () => {
    const markers = buildPressureGoalMarkers(match({ goalEvents: [{ minute: 23, side: 'home' }], goalMinutes: [23, 42] }))
    expect(markers.map(({ minute, inferred }) => ({ minute, inferred }))).toEqual([
      { minute: 23, inferred: false }, { minute: 42, inferred: false },
    ])
  })
  it('converts a relative second-half minute into the full match clock', () => {
    const secondHalf = match({ state: 3, minute: 11, homeScore: 2, awayScore: 1 })
    expect(matchClockMinute(secondHalf)).toBe(56)
    expect(buildPressureTimeline(secondHalf).at(-1)?.minute).toBe(56)
  })
  it('places an inferred second-half goal on the full match clock', () => {
    const markers = buildPressureGoalMarkers(match({ state: 3, minute: 11, homeScore: 1, awayScore: 0, goalMinutes: [], goalEvents: [] }))
    expect(markers).toEqual([{ minute: null, side: 'home', inferred: true }])
  })
})
