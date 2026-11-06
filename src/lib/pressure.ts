import type { GoalSide, LiveMatch, PressurePoint } from '../types'

export interface PressureGoalMarker { minute: number | null; side: GoalSide; inferred: boolean }

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, Math.round(value)))

export function matchClockMinute(match: LiveMatch) {
  const minute = Math.max(0, match.minute ?? (match.state === 2 ? 45 : 0))
  if (match.state === 2) return 45
  if (match.state === 3 && minute <= 45) return Math.min(90, 45 + minute)
  return Math.min(match.state >= 4 ? 120 : 90, minute)
}

function marketBias(match: LiveMatch) {
  const home = match.markets?.europe.current.left
  const away = match.markets?.europe.current.right
  if (home === null || home === undefined || away === null || away === undefined) return 0
  return clamp((away - home) * 7, -16, 16)
}

export function buildPressureTimeline(match: LiveMatch): PressurePoint[] {
  if (match.pressureTimeline?.length) {
    const first = match.pressureTimeline[0]
    return first.minute === 0 ? match.pressureTimeline : [{ minute: 0, home: first.home, away: first.away }, ...match.pressureTimeline]
  }

  const currentMinute = Math.max(1, matchClockMinute(match))
  const sampleMinutes = [0]
  for (let minute = 2; minute < currentMinute; minute += 2) sampleMinutes.push(minute)
  if (sampleMinutes.at(-1) !== currentMinute) sampleMinutes.push(currentMinute)
  const seed = Math.abs(match.id % 97)
  const bias = marketBias(match)
  const homeChasing = match.homeScore < match.awayScore ? 13 : 0
  const awayChasing = match.awayScore < match.homeScore ? 13 : 0

  return sampleMinutes.map((minute) => {
    const lateLift = minute > 30 ? (minute - 30) * 0.55 : 0
    const homeWave = Math.sin((minute + seed % 9) * 0.47) * 13 + Math.cos(minute * 0.19 + seed) * 6
    const awayWave = Math.cos((minute + seed % 7) * 0.43) * 12 + Math.sin(minute * 0.23 + seed) * 7
    let home = 35 + bias + homeWave + homeChasing + lateLift
    let away = 35 - bias + awayWave + awayChasing + lateLift

    for (const event of match.goalEvents ?? []) {
      const distance = Math.abs(event.minute - minute)
      if (distance > 3) continue
      const spike = (4 - distance) * 8
      if (event.side === 'home') home += spike
      else if (event.side === 'away') away += spike
      else { home += spike / 2; away += spike / 2 }
    }

    return { minute, home: clamp(home), away: clamp(away) }
  })
}

export function pressureSummary(points: PressurePoint[]) {
  const recent = points.slice(-5)
  if (!recent.length) return { home: 0, away: 0, leader: '均衡' as const }
  const average = (side: 'home' | 'away') => Math.round(recent.reduce((sum, point) => sum + point[side], 0) / recent.length)
  const home = average('home'); const away = average('away')
  return { home, away, leader: Math.abs(home - away) < 6 ? '均衡' as const : home > away ? '主队' as const : '客队' as const }
}

export function buildPressureGoalMarkers(match: LiveMatch): PressureGoalMarker[] {
  const chartEnd = match.state >= 3 ? 90 : 45
  const explicit = (match.goalEvents ?? []).filter((event) => event.minute <= chartEnd)
    .map((event) => ({ ...event, inferred: false }))
  const minuteOnly = match.goalMinutes.filter((minute) => minute <= chartEnd)
    .map((minute) => ({ minute, side: 'unknown' as const, inferred: false }))
  const markers: PressureGoalMarker[] = minuteOnly.length > explicit.length ? minuteOnly : explicit.length ? explicit : minuteOnly
  const targetHome = match.homeScore
  const targetAway = match.awayScore
  const missingCount = Math.max(0, targetHome + targetAway - markers.length)
  const knownHome = markers.filter((event) => event.side === 'home').length
  const knownAway = markers.filter((event) => event.side === 'away').length
  let homeToAdd = Math.max(0, targetHome - knownHome)
  let awayToAdd = Math.max(0, targetAway - knownAway)
  for (let index = 0; index < missingCount; index++) {
    const side: GoalSide = homeToAdd > 0 ? 'home' : awayToAdd > 0 ? 'away' : 'unknown'
    if (side === 'home') homeToAdd--
    if (side === 'away') awayToAdd--
    markers.push({ minute: null, side, inferred: true })
  }
  return markers.sort((a, b) => (a.minute ?? Number.POSITIVE_INFINITY) - (b.minute ?? Number.POSITIVE_INFINITY))
}
