export interface TeamStructureInput {
  shortForm: number
  longForm: number
  boxEntries: number
  boxShots: number
  shotGoals: number
  redCards: number
  penalties: number
}

export interface TeamStructureMetrics {
  entryToShotRatio: number | null
  shotToGoalRatio: number | null
  entryToGoalRatio: number | null
  baseXgPlus: number
  xgPlus: number
  heat: number[]
  adjustments: string[]
}

export interface GoalStructureResult {
  home: TeamStructureMetrics
  away: TeamStructureMetrics
  probability: number | null
  noGoalProbability: number | null
  windowStart: number
  windowEnd: number
  windowMinutes: number
  homeShare: number | null
  awayShare: number | null
  level: 'insufficient' | 'low' | 'watch' | 'high'
  label: string
  confidence: '数据不足' | '低' | '中' | '高'
  eventAdjusted: boolean
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0))
const ratio = (value: number, total: number) => total > 0 ? Math.round(value / total * 100) : null

function teamMetrics(input: TeamStructureInput, opponentRedCards: number): TeamStructureMetrics {
  const shortForm = clamp(input.shortForm, 0, 100)
  const longForm = clamp(input.longForm, 0, 100)
  const boxEntries = clamp(input.boxEntries, 0, 99)
  const boxShots = clamp(input.boxShots, 0, 99)
  const shotGoals = clamp(input.shotGoals, 0, 20)
  const redCards = clamp(input.redCards, 0, 2)
  const penalties = clamp(input.penalties, 0, 5)
  const formMultiplier = .75 + shortForm * .002 + longForm * .0015
  const baseXgPlus = (boxEntries * .025 + boxShots * .13 + shotGoals * .55) * formMultiplier
  const ownRedMultiplier = Math.max(.5, 1 - redCards * .22)
  const opponentRedMultiplier = 1 + clamp(opponentRedCards, 0, 2) * .12
  const xgPlus = (baseXgPlus + penalties * .76) * ownRedMultiplier * opponentRedMultiplier
  const adjustments: string[] = []
  if (redCards) adjustments.push(`本队${redCards}张红牌，进攻强度×${ownRedMultiplier.toFixed(2)}`)
  if (opponentRedCards) adjustments.push(`对手红牌释放空间，进攻强度×${opponentRedMultiplier.toFixed(2)}`)
  if (penalties) adjustments.push(`${penalties}次点球计入 ${(penalties * .76).toFixed(2)} xGPlus`)
  const transition = clamp((shortForm * .55 + longForm * .45) / 100, 0, 1)
  const boxPressure = clamp((boxEntries * 4 + boxShots * 7) / 100, 0, 1)
  const finishPressure = clamp((boxShots * 6 + shotGoals * 24 + penalties * 18) / 100, 0, 1)
  return {
    entryToShotRatio: ratio(boxShots, boxEntries),
    shotToGoalRatio: ratio(shotGoals, boxShots),
    entryToGoalRatio: ratio(shotGoals, boxEntries),
    baseXgPlus: Number(baseXgPlus.toFixed(2)),
    xgPlus: Number(xgPlus.toFixed(2)),
    heat: [transition * .35, transition * .5, boxPressure * .45, boxPressure * .7, finishPressure * .85, finishPressure, transition * .28, boxPressure * .55, finishPressure * .72, transition * .42, boxPressure * .62, finishPressure * .9].map((value) => Number(clamp(value, .06, 1).toFixed(2))),
    adjustments,
  }
}

export function calculateGoalStructure(homeInput: TeamStructureInput, awayInput: TeamStructureInput, minute: number): GoalStructureResult {
  const home = teamMetrics(homeInput, awayInput.redCards)
  const away = teamMetrics(awayInput, homeInput.redCards)
  const evidenceCount = [homeInput.boxEntries, homeInput.boxShots, homeInput.shotGoals, homeInput.penalties, awayInput.boxEntries, awayInput.boxShots, awayInput.shotGoals, awayInput.penalties].filter((value) => value > 0).length
  const total = home.xgPlus + away.xgPlus
  const hasEvidence = evidenceCount > 0 && total > 0
  const windowStart = clamp(minute, 0, 90)
  const windowEnd = Math.min(90, windowStart + 20)
  const windowMinutes = Math.max(0, windowEnd - windowStart)
  const elapsed = Math.max(10, windowStart)
  const windowExpected = hasEvidence ? Math.min(2.4, total / elapsed * windowMinutes * .35) : 0
  const probability = hasEvidence && windowMinutes > 0 ? Math.round((1 - Math.exp(-windowExpected)) * 100) : null
  const noGoalProbability = probability === null ? null : 100 - probability
  const homeShare = hasEvidence ? Math.round(home.xgPlus / total * 100) : null
  const awayShare = homeShare === null ? null : 100 - homeShare
  const level = probability === null ? 'insufficient' : probability >= 60 ? 'high' : probability >= 35 ? 'watch' : 'low'
  const label = probability === null ? '等待结构数据' : probability >= 60 ? '未来20分钟强有球' : probability >= 35 ? '未来20分钟有球观察' : '未来20分钟弱有球'
  const formReady = homeInput.shortForm > 0 && homeInput.longForm > 0 && awayInput.shortForm > 0 && awayInput.longForm > 0
  const confidence = !hasEvidence ? '数据不足' : evidenceCount >= 6 && formReady ? '高' : evidenceCount >= 4 ? '中' : '低'
  return { home, away, probability, noGoalProbability, windowStart, windowEnd, windowMinutes, homeShare, awayShare, level, label, confidence, eventAdjusted: homeInput.redCards + awayInput.redCards + homeInput.penalties + awayInput.penalties > 0 }
}
