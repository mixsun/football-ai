import { analyzeHalfGoal, deVigTwoWay, FIRST_HALF_MODEL_END } from './analysis'
import type { LiveMatch, MatchDetailResponse } from '../types'

export interface PressurePoint {
  minute: number
  home: number
  away: number
}

export interface PressureIndicator {
  label: string
  value: number
}

export interface RealtimePressureMetric {
  label: string
  home: number
  away: number
}

export interface RealtimePressure {
  available: boolean
  home: number | null
  away: number | null
  metrics: RealtimePressureMetric[]
  homeRedCards: number
  awayRedCards: number
  homePenalties: number
  awayPenalties: number
}

export interface LiveGoalStructure {
  probability: number | null
  remainingMinutes: number
  tempoLabel: string
  scoreShape: string
  marketSignal: string
  homeShare: number
  awayShare: number
  homePressure: number
  awayPressure: number
  pressureTimeline: PressurePoint[]
  pressureIndicators: PressureIndicator[]
  marketCoverage: number
  homeHistoryRate: number | null
  awayHistoryRate: number | null
  favoredSide: 'home' | 'away' | 'balanced'
  favoredText: string
  confidence: '较高' | '中' | '低'
  knownFacts: string[]
  limitations: string[]
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const roundPair = (home: number): [number, number] => {
  const roundedHome = Math.round(home * 100)
  return [roundedHome, 100 - roundedHome]
}

function buildPressureTimeline(match: LiveMatch, minute: number, homePressure: number, awayPressure: number): PressurePoint[] {
  if (minute <= 0) return [{ minute: 0, home: homePressure, away: awayPressure }]
  const points = Array.from({ length: Math.ceil(minute / 2) + 1 }, (_, index) => Math.min(minute, index * 2))
  if (points.at(-1) !== minute) points.push(minute)

  return [...new Set(points)].map((currentMinute) => {
    const progress = currentMinute / Math.max(1, minute)
    const goalPulse = (side: 'home' | 'away') => (match.goalEvents ?? []).reduce((sum, goal) => {
      const distance = currentMinute - goal.minute
      if (distance < -2 || distance > 8) return sum
      const sideWeight = goal.side === side ? 20 : goal.side === 'unknown' ? 9 : 5
      return sum + sideWeight * Math.max(0, 1 - Math.abs(distance - 1) / 9)
    }, 0)
    const homeWave = Math.sin((currentMinute + match.id % 11) * .42) * 9 + Math.cos(currentMinute * .19) * 5
    const awayWave = Math.cos((currentMinute + match.id % 7) * .38) * 8 + Math.sin(currentMinute * .23) * 5
    return {
      minute: currentMinute,
      home: Math.round(clamp(homePressure * (.48 + progress * .52) + homeWave + goalPulse('home'), 0, 100)),
      away: Math.round(clamp(awayPressure * (.48 + progress * .52) + awayWave + goalPulse('away'), 0, 100)),
    }
  }).map((point, index, all) => index === all.length - 1 ? { ...point, home: homePressure, away: awayPressure } : point)
}

function marketCoverage(match: LiveMatch): number {
  if (!match.markets) return 0
  const markets = [match.markets.europe, match.markets.asian, match.markets.total, match.markets.halfEurope, match.markets.halfAsian, match.markets.halfTotal]
  return markets.filter((market) => market?.current && [market.current.left, market.current.line, market.current.right].some((value) => value != null)).length
}

function historyRate(sample: number | undefined, withGoal: number | undefined): number | null {
  if (!sample || withGoal == null) return null
  return Math.round(withGoal / sample * 100)
}

const statisticValue = (value: string) => {
  const parsed = Number.parseFloat(value.replace('%', ''))
  return Number.isFinite(parsed) ? parsed : null
}

export function buildRealtimePressure(match: LiveMatch, detail: MatchDetailResponse | null): RealtimePressure {
  const definitions = [
    { kind: 5, label: '射正', weight: 5 },
    { kind: 4, label: '射门', weight: 2 },
    { kind: 7, label: '危险进攻', weight: .35 },
    { kind: 0, label: '角球', weight: 1.5 },
    { kind: 6, label: '进攻', weight: .08 },
  ]
  const weighted = { home: 0, away: 0 }
  const metrics = definitions.flatMap((definition) => {
    const statistic = detail?.stats.find((item) => item.kind === definition.kind)
    if (!statistic) return []
    const home = statisticValue(statistic.home)
    const away = statisticValue(statistic.away)
    if (home == null || away == null) return []
    weighted.home += home * definition.weight
    weighted.away += away * definition.weight
    return [{ label: definition.label, home, away }]
  })
  const events = detail?.events ?? []
  const homeRedCards = events.filter((event) => event.side === 'home' && [2, 9].includes(event.kind)).length
  const awayRedCards = events.filter((event) => event.side === 'away' && [2, 9].includes(event.kind)).length
  const homePenalties = events.filter((event) => event.side === 'home' && [7, 13].includes(event.kind)).length
  const awayPenalties = events.filter((event) => event.side === 'away' && [7, 13].includes(event.kind)).length
  const available = metrics.length >= 2
  if (!available) return { available, home: null, away: null, metrics, homeRedCards, awayRedCards, homePenalties, awayPenalties }
  const minute = Math.max(5, match.minute ?? 0)
  const score = (raw: number, ownRedCards: number, opponentRedCards: number, penalties: number) => {
    const base = (1 - Math.exp(-((raw + penalties * 5) / minute) * 1.55)) * 100
    return Math.round(clamp(base * Math.pow(.82, ownRedCards) + opponentRedCards * 6, 0, 100))
  }
  return {
    available,
    home: score(weighted.home, homeRedCards, awayRedCards, homePenalties),
    away: score(weighted.away, awayRedCards, homeRedCards, awayPenalties),
    metrics,
    homeRedCards,
    awayRedCards,
    homePenalties,
    awayPenalties,
  }
}

function directionShare(match: LiveMatch): [number, number, boolean] {
  const europe = match.markets?.europe.current
  const homePrice = europe?.left
  const awayPrice = europe?.right
  let homeShare = 0.5
  let marketReady = false

  if (homePrice != null && awayPrice != null && homePrice > 1 && awayPrice > 1) {
    const homeStrength = 1 / homePrice
    const awayStrength = 1 / awayPrice
    homeShare = homeStrength / (homeStrength + awayStrength)
    marketReady = true
  } else if (match.markets?.asian.current.line != null) {
    homeShare = 0.5 + clamp(match.markets.asian.current.line, -2, 2) * 0.1
    marketReady = true
  }

  const scoreDelta = match.homeScore - match.awayScore
  if (scoreDelta > 0) homeShare -= 0.07
  if (scoreDelta < 0) homeShare += 0.07
  const [home, away] = roundPair(clamp(homeShare, 0.24, 0.76))
  return [home, away, marketReady]
}

export function buildLiveGoalStructure(match: LiveMatch): LiveGoalStructure {
  const analysis = analyzeHalfGoal(match)
  const minute = clamp(match.minute ?? 0, 0, FIRST_HALF_MODEL_END)
  const remainingMinutes = Math.max(0, FIRST_HALF_MODEL_END - minute)
  const [homeShare, awayShare, marketReady] = directionShare(match)
  const totalGoals = match.homeScore + match.awayScore
  const halfLine = match.markets?.halfTotal.current.line ?? null
  const halfOver = deVigTwoWay(match.markets?.halfTotal.current.left ?? null, match.markets?.halfTotal.current.right ?? null)?.[0]
  const favoredSide = Math.abs(homeShare - awayShare) < 8 ? 'balanced' : homeShare > awayShare ? 'home' : 'away'
  const favoredText = favoredSide === 'balanced' ? '两队压力接近' : `${favoredSide === 'home' ? match.home : match.away}方向更强`
  const probability = analysis.probability
  const pressureBase = probability ?? 25
  const homePressure = Math.round(clamp(pressureBase * (0.55 + homeShare / 100), 0, 100))
  const awayPressure = Math.round(clamp(pressureBase * (0.55 + awayShare / 100), 0, 100))
  const pressureTimeline = buildPressureTimeline(match, minute, homePressure, awayPressure)
  const averagePressure = Math.round(pressureTimeline.reduce((sum, point) => sum + (point.home + point.away) / 2, 0) / pressureTimeline.length)
  const recentPoints = pressureTimeline.filter((point) => point.minute >= Math.max(0, minute - 10))
  const recentPressure = Math.round(recentPoints.reduce((sum, point) => sum + Math.max(point.home, point.away), 0) / recentPoints.length)
  const pressureIndicators: PressureIndicator[] = [
    { label: '全段压力', value: Math.round(Math.max(homePressure, awayPressure)) },
    { label: '平均压力', value: averagePressure },
    { label: '近10分钟压力', value: recentPressure },
  ]
  const tempoLabel = probability == null ? '数据不足' : probability >= 70 ? '高压推进' : probability >= 58 ? '中高节奏' : probability >= 45 ? '均衡观察' : '低速阶段'
  const scoreShape = totalGoals === 0 ? '尚未进球，等待首个破局点' : `${totalGoals}球后进入下一球续判`
  const marketSignal = halfLine == null ? '半场盘口缺失' : `半场剩余盘 ${halfLine.toFixed(2)}；大球去水 ${halfOver == null ? '—' : `${Math.round(halfOver * 100)}%`}`
  const knownFacts = [
    `当前 ${minute}′，比分 ${match.homeScore}-${match.awayScore}，半场剩余约 ${remainingMinutes} 分钟（含预计补时）`,
    match.goalMinutes.filter((goal) => goal <= 45).length ? `已知上半场进球时间：${match.goalMinutes.filter((goal) => goal <= 45).map((goal) => `${goal}′`).join('、')}` : '当前数据未记录上半场进球',
    marketSignal,
  ]
  const limitations = ['球权位置热区由盘口、比分和进攻压力推导，颜色表示连续活动区域，不是固定点位，也不是真实射门或触球坐标']
  if (!marketReady) limitations.push('缺少可用欧赔/亚盘方向，主客热区按均衡基线绘制')
  if (!match.goalEvents?.length && match.goalMinutes.length) limitations.push('已知进球时间但缺少完整进球队伍事件')
  const confidence: LiveGoalStructure['confidence'] = probability == null || !marketReady ? '低' : match.markets?.halfTotal.current.line != null && match.halfGoalHistory ? '较高' : '中'

  return {
    probability, remainingMinutes, tempoLabel, scoreShape, marketSignal, homeShare, awayShare, homePressure, awayPressure,
    pressureTimeline, pressureIndicators, marketCoverage: marketCoverage(match),
    homeHistoryRate: historyRate(match.halfGoalHistory?.home.sample, match.halfGoalHistory?.home.withGoal),
    awayHistoryRate: historyRate(match.halfGoalHistory?.away.sample, match.halfGoalHistory?.away.withGoal),
    favoredSide, favoredText, confidence, knownFacts, limitations,
  }
}
