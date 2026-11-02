import type { Analysis, LiveMatch, RuleEvidence, RuleStatus, Triple } from '../types'

export function deVigTwoWay(left: number | null, right: number | null): [number, number] | null {
  if (left === null || right === null || left <= 0 || right <= 0) return null
  const l = 1 / (1 + left); const r = 1 / (1 + right); const sum = l + r
  return [l / sum, r / sum]
}

const fmt = (value: number | null) => value === null ? '—' : value.toFixed(2)
const approx = (value: number | null, expected: number) => value !== null && Math.abs(value - expected) < 0.001
const condition = (value: boolean | null): RuleStatus => value === null ? 'unknown' : value ? 'match' : 'miss'
const conditionText = (value: boolean | null) => ({ match: '符合', miss: '不符合', unknown: '未知' })[condition(value)]
const combine = (values: Array<boolean | null>): RuleStatus => values.some((value) => value === false) ? 'miss' : values.some((value) => value === null) ? 'unknown' : 'match'

function scorerIsHome(match: LiveMatch, goals: number): boolean | null {
  const events = (match.goalEvents ?? []).filter((event) => event.minute <= 25).slice(0, goals)
  if (events.length === goals && events.every((event) => event.side !== 'unknown')) return events.every((event) => event.side === 'home')
  if (match.homeScore === goals && match.awayScore === 0) return true
  if (match.awayScore > 0) return false
  return null
}

function law(match: LiveMatch, goals: 1 | 2): RuleEvidence {
  const code = goals === 1 ? '252' : '253'; const maxHalfWater = goals === 1 ? 0.70 : 0.75
  const before25 = match.minute !== null && match.minute <= 25
  const counted = match.goalMinutes.filter((minute) => minute <= 25).length || (before25 ? match.homeScore + match.awayScore : 0)
  const goalShape = before25 ? counted === goals : false
  const upperScored = goalShape ? scorerIsHome(match, goals) : false
  const preLine = match.markets?.asian.current.line ?? null
  const preMatchHomeFav = preLine === null ? null : [0.25, 0.5, 0.75].some((line) => approx(preLine, line))
  const liveFull = match.markets?.liveAsian?.current; const liveHalf = match.markets?.halfAsian.current
  const fullQuarter = liveFull?.line == null ? null : approx(liveFull.line, 0.25)
  const halfLevel = liveHalf?.line == null ? null : approx(liveHalf.line, 0)
  const fullHighWater = liveFull?.left == null ? null : liveFull.left >= 0.90
  const halfLowWater = liveHalf?.left == null ? null : liveHalf.left <= maxHalfWater
  return {
    code, label: `${code}定律`, status: combine([goalShape, upperScored, preMatchHomeFav, fullQuarter, halfLevel, fullHighWater, halfLowWater]),
    details: [
      `25分钟前${goals}球：${conditionText(goalShape)}`, `上盘主队进球：${conditionText(upperScored)}`,
      `赛前主让0.25/0.5/0.75：${preLine === null ? '未知' : fmt(preLine)}`,
      `即时全场主让0.25：${liveFull?.line == null ? '未知' : fmt(liveFull.line)}`,
      `即时半场平手：${liveHalf?.line == null ? '未知' : fmt(liveHalf.line)}`,
      `全场上盘水≥0.90：${liveFull?.left == null ? '未知' : fmt(liveFull.left)}`,
      `半场上盘水≤${maxHalfWater.toFixed(2)}：${liveHalf?.left == null ? '未知' : fmt(liveHalf.left)}`,
    ],
  }
}

function chaseTheory(match: LiveMatch): RuleEvidence {
  const first = (match.goalEvents ?? []).find((event) => event.minute <= 45)
  const strongScored = first ? first.side === 'home' : match.homeScore > 0 && match.awayScore === 0 ? true : null
  const totalLine = match.markets?.total.current.line ?? null; const highTotal = totalLine === null ? null : totalLine > 3
  const firstMinute = first?.minute ?? match.goalMinutes[0] ?? null
  const aroundTen = firstMinute === null ? null : firstMinute >= 6 && firstMinute <= 14
  const pressure: boolean | null = null
  return {
    code: 'CHASE', label: '半场追球', status: combine([strongScored, highTotal, aroundTen, pressure]),
    details: [`强队/上盘进球：${conditionText(strongScored)}`, `全场总进球盘>3：${totalLine === null ? '未知' : fmt(totalLine)}`, `首球约10分钟(6–14′)：${firstMinute ?? '未知'}`, '进攻上升且压力≥60%：数据源未提供'],
  }
}

function halfGoalPattern(match: LiveMatch): RuleEvidence {
  const live = match.markets?.liveAsian; const upperHome = match.markets?.asian.current.line == null ? null : match.markets.asian.current.line > 0
  const lineDown = live?.opening.line != null && live.current.line != null ? live.current.line < live.opening.line : null
  const waterUp = live?.opening.left != null && live.current.left != null ? live.current.left > live.opening.left : null
  const history = match.halfGoalHistory?.home; const historyReady = history ? history.sample > 0 : null
  return {
    code: 'HALF', label: '半场有球特征', status: combine([upperHome, lineDown, waterUp, historyReady]),
    details: [`上盘为主队：${conditionText(upperHome)}`, `即时降盘：${lineDown === null ? '未知' : lineDown ? '是' : '否'}`, `上盘升水：${waterUp === null ? '未知' : waterUp ? '是' : '否'}`, history?.sample ? `主队近${history.sample}场半场有球 ${history.withGoal} 场（${Math.round(history.withGoal / history.sample * 100)}%）` : '最近20场半场数据：无样本'],
  }
}

export function analyzeHalfGoal(match: LiveMatch): Analysis {
  const rules = [law(match, 1), law(match, 2), chaseTheory(match), halfGoalPattern(match)]
  const history = match.halfGoalHistory
  const historySignals = history ? [`${match.home}近${history.home.sample}场半场有球 ${history.home.withGoal} 场`, `${match.away}近${history.away.sample}场半场有球 ${history.away.withGoal} 场`] : ['最近20场半场历史数据未取得']
  if (match.homeHalfScore + match.awayHalfScore > 0 || (match.state === 1 && match.homeScore + match.awayScore > 0)) {
    const hits = rules.filter((rule) => rule.status === 'match').map((rule) => rule.code)
    return { probability: 100, level: 'done', label: hits.length ? `有球·${hits.join('/')}` : '半场有球已达成', reason: `当前比分 ${match.homeScore}:${match.awayScore}`, signals: [`进球时间 ${match.goalMinutes.filter((m) => m <= 45).join('′、') || '已记录'}`, ...historySignals], rules }
  }
  if (match.state !== 1) return { probability: null, level: 'unavailable', label: match.state === 2 ? '半场已结束' : '非上半场', reason: '仅对正在进行且上半场尚未进球的比赛估算', signals: historySignals, rules }
  if (!match.markets || (match.markets.halfTotal.current.line === null && match.markets.total.current.line === null)) return { probability: null, level: 'unavailable', label: '盘口不足', reason: '当前比赛暂无可用大小盘，不能可靠估算', signals: historySignals, rules }
  const minute = Math.min(45, Math.max(0, match.minute ?? 0)); const halfMarket = match.markets.halfTotal; const half: Triple = halfMarket.current; const full: Triple = match.markets.total.current
  const halfProb = deVigTwoWay(half.left, half.right)?.[0] ?? 0.5; const fullProb = deVigTwoWay(full.left, full.right)?.[0] ?? 0.5
  const halfLine = half.line ?? Math.max(0.75, (full.line ?? 2.5) * 0.44); const fullProjection = (full.line ?? halfLine / 0.44) * 0.44
  let expectedHalf = (halfLine + fullProjection) / 2; expectedHalf *= 0.82 + 0.34 * halfProb + 0.14 * (fullProb - 0.5)
  const probability = Math.round((1 - Math.exp(-expectedHalf * Math.pow(Math.max(0, (45 - minute) / 45), 0.88))) * 100)
  const [level, label] = probability >= 70 ? ['high', '高机会'] : probability >= 58 ? ['medium', '中高机会'] : probability >= 45 ? ['watch', '观察'] : ['low', '低机会']
  const movement = halfMarket.opening.line !== null && half.line !== null ? (half.line > halfMarket.opening.line ? '半场升盘' : half.line < halfMarket.opening.line ? '半场降盘' : '半场盘不变') : '半场盘变化未知'
  return { probability, level: level as Analysis['level'], label, reason: `估算未来 ${45 - minute} 分钟至少一球的概率`, signals: [`半场大小 ${fmt(half.line)}，大球去水概率 ${Math.round(halfProb * 100)}%`, `全场大小 ${fmt(full.line)}，大球去水概率 ${Math.round(fullProb * 100)}%`, `${movement}；同盘口当前样本 ${match.sameMarketCount} 场`, ...historySignals], rules }
}
