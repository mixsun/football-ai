import { analyzeHalfGoal, deVigTwoWay, FIRST_HALF_MODEL_END } from './analysis'
import type { LiveMatch } from '../types'

export interface FutureGoalWindow {
  start: number
  end: number
  probability: number
  intensity: 'peak' | 'high' | 'medium' | 'low'
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
  favoredSide: 'home' | 'away' | 'balanced'
  favoredText: string
  confidence: '较高' | '中' | '低'
  windows: FutureGoalWindow[]
  peakWindow: FutureGoalWindow | null
  knownFacts: string[]
  limitations: string[]
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const roundPair = (home: number): [number, number] => {
  const roundedHome = Math.round(home * 100)
  return [roundedHome, 100 - roundedHome]
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

function futureWindows(minute: number, probability: number | null): FutureGoalWindow[] {
  if (probability == null || minute >= FIRST_HALF_MODEL_END) return []
  const p = clamp(probability / 100, 0.01, 0.95)
  const remaining = Math.max(1, FIRST_HALF_MODEL_END - minute)
  const rate = -Math.log(1 - p) / remaining
  const windows: FutureGoalWindow[] = []
  for (let start = minute; start < FIRST_HALF_MODEL_END; start += 5) {
    const end = Math.min(FIRST_HALF_MODEL_END, start + 5)
    const elapsedStart = start - minute
    const elapsedEnd = end - minute
    const chance = (Math.exp(-rate * elapsedStart) - Math.exp(-rate * elapsedEnd)) * 100
    windows.push({ start, end, probability: Math.max(0, Math.round(chance)), intensity: 'low' })
  }
  const peak = Math.max(1, ...windows.map((item) => item.probability))
  return windows.map((item) => ({
    ...item,
    intensity: item.probability >= peak * 0.85 ? 'peak' : item.probability >= peak * 0.62 ? 'high' : item.probability >= peak * 0.38 ? 'medium' : 'low',
  }))
}

export function buildLiveGoalStructure(match: LiveMatch): LiveGoalStructure {
  const analysis = analyzeHalfGoal(match)
  const minute = clamp(match.minute ?? 0, 0, FIRST_HALF_MODEL_END)
  const remainingMinutes = Math.max(0, FIRST_HALF_MODEL_END - minute)
  const [homeShare, awayShare, marketReady] = directionShare(match)
  const windows = futureWindows(minute, analysis.probability)
  const peakWindow = windows.reduce<FutureGoalWindow | null>((best, item) => !best || item.probability > best.probability ? item : best, null)
  const totalGoals = match.homeScore + match.awayScore
  const halfLine = match.markets?.halfTotal.current.line ?? null
  const halfOver = deVigTwoWay(match.markets?.halfTotal.current.left ?? null, match.markets?.halfTotal.current.right ?? null)?.[0]
  const favoredSide = Math.abs(homeShare - awayShare) < 8 ? 'balanced' : homeShare > awayShare ? 'home' : 'away'
  const favoredText = favoredSide === 'balanced' ? '两队压力接近' : `${favoredSide === 'home' ? match.home : match.away}方向更强`
  const probability = analysis.probability
  const pressureBase = probability ?? 25
  const homePressure = Math.round(clamp(pressureBase * (0.55 + homeShare / 100), 0, 100))
  const awayPressure = Math.round(clamp(pressureBase * (0.55 + awayShare / 100), 0, 100))
  const tempoLabel = probability == null ? '数据不足' : probability >= 70 ? '高压推进' : probability >= 58 ? '中高节奏' : probability >= 45 ? '均衡观察' : '低速阶段'
  const scoreShape = totalGoals === 0 ? '尚未进球，等待首个破局点' : `${totalGoals}球后进入下一球续判`
  const marketSignal = halfLine == null ? '半场盘口缺失' : `半场剩余盘 ${halfLine.toFixed(2)}；大球去水 ${halfOver == null ? '—' : `${Math.round(halfOver * 100)}%`}`
  const knownFacts = [
    `当前 ${minute}′，比分 ${match.homeScore}-${match.awayScore}，半场剩余约 ${remainingMinutes} 分钟（含预计补时）`,
    match.goalMinutes.filter((goal) => goal <= 45).length ? `已知上半场进球时间：${match.goalMinutes.filter((goal) => goal <= 45).map((goal) => `${goal}′`).join('、')}` : '当前数据未记录上半场进球',
    marketSignal,
  ]
  const limitations = ['球场热区为盘口与比赛状态推导的压力示意，不是真实射门或触球坐标']
  if (!marketReady) limitations.push('缺少可用欧赔/亚盘方向，主客热区按均衡基线绘制')
  if (!match.goalEvents?.length && match.goalMinutes.length) limitations.push('已知进球时间但缺少完整进球队伍事件')
  const confidence: LiveGoalStructure['confidence'] = probability == null || !marketReady ? '低' : match.markets?.halfTotal.current.line != null && match.halfGoalHistory ? '较高' : '中'

  return { probability, remainingMinutes, tempoLabel, scoreShape, marketSignal, homeShare, awayShare, homePressure, awayPressure, favoredSide, favoredText, confidence, windows, peakWindow, knownFacts, limitations }
}
