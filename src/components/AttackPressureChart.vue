<script setup lang="ts">
import { computed } from 'vue'
import { buildPressureGoalMarkers, buildPressureTimeline, matchClockMinute, pressureSummary, type PressureGoalMarker } from '../lib/pressure'
import type { LiveMatch, PressurePoint, TechnicalStats } from '../types'
import goalBallIcon from '../goal-ball.png'

const props = defineProps<{ match: LiveMatch }>()
const points = computed(() => buildPressureTimeline(props.match))
const summary = computed(() => pressureSummary(points.value))
const chart = { width: 720, height: 330, left: 48, right: 18, top: 20, bottom: 286 }
const plotWidth = chart.width - chart.left - chart.right
const plotHeight = chart.bottom - chart.top
const axisMax = computed(() => props.match.state >= 3 ? 90 : 45)
const currentMinute = computed(() => matchClockMinute(props.match))
const x = (minute: number) => chart.left + (minute / axisMax.value) * plotWidth
const y = (value: number) => chart.bottom - value / 100 * plotHeight
const xTicks = computed(() => axisMax.value === 90 ? [0, 15, 30, 45, 60, 75, 90] : [0, 10, 20, 30, 40, 45])
const yTicks = [0, 20, 40, 60, 80, 100]
const chartId = computed(() => `pressure-${String(props.match.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`)
const homeAreaId = computed(() => `${chartId.value}-home-area`)
const awayAreaId = computed(() => `${chartId.value}-away-area`)
const homeGlowId = computed(() => `${chartId.value}-home-glow`)
const awayGlowId = computed(() => `${chartId.value}-away-glow`)

const linePath = (side: 'home' | 'away') => {
  const series = points.value.map((point) => ({ x: x(point.minute), y: y(point[side]) }))
  if (!series.length) return ''
  if (series.length === 1) return `M ${series[0].x} ${series[0].y}`
  const clampY = (value: number) => Math.max(chart.top, Math.min(chart.bottom, value))
  return series.slice(0, -1).reduce((path, point, index) => {
    const previous = series[Math.max(0, index - 1)]
    const next = series[index + 1]
    const afterNext = series[Math.min(series.length - 1, index + 2)]
    const control1 = {
      x: point.x + (next.x - previous.x) / 6,
      y: clampY(point.y + (next.y - previous.y) / 6),
    }
    const control2 = {
      x: next.x - (afterNext.x - point.x) / 6,
      y: clampY(next.y - (afterNext.y - point.y) / 6),
    }
    return `${path} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${next.x} ${next.y}`
  }, `M ${series[0].x} ${series[0].y}`)
}
const areaPath = (side: 'home' | 'away') => {
  const series = points.value
  if (!series.length) return ''
  return `M ${x(series[0].minute)} ${chart.bottom} L ${x(series[0].minute)} ${y(series[0][side])} ${linePath(side).replace(/^M\s+[^C]+/, '')} L ${x(series.at(-1)!.minute)} ${chart.bottom} Z`
}

const latest = computed(() => points.value.at(-1) ?? { minute: 0, home: 0, away: 0 })
const currentShare = computed(() => {
  const total = Math.max(1, latest.value.home + latest.value.away)
  return { home: Math.round(latest.value.home / total * 100), away: Math.round(latest.value.away / total * 100) }
})
const average = (series: PressurePoint[], side: 'home' | 'away') => series.length ? Math.round(series.reduce((sum, point) => sum + point[side], 0) / series.length) : 0
const metrics = computed(() => {
  const all = points.value; const recent = all.slice(-5)
  const homeAverage = average(all, 'home'); const awayAverage = average(all, 'away')
  const homeRecent = average(recent, 'home'); const awayRecent = average(recent, 'away')
  const combinedAverage = Math.round((homeAverage + awayAverage) / 2)
  const recentAverage = Math.round((homeRecent + awayRecent) / 2)
  const peak = Math.max(0, ...all.flatMap((point) => [point.home, point.away]))
  const total = Math.max(1, all.reduce((sum, point) => sum + point.home + point.away, 0))
  return {
    gauges: [{ label: '全场峰值', value: peak }, { label: '平均压力', value: combinedAverage }, { label: '近10分钟', value: recentAverage }],
    home: { average: homeAverage, recent: homeRecent, peak: Math.max(0, ...all.map((point) => point.home)), share: Math.round(all.reduce((sum, point) => sum + point.home, 0) / total * 100) },
    away: { average: awayAverage, recent: awayRecent, peak: Math.max(0, ...all.map((point) => point.away)), share: Math.round(all.reduce((sum, point) => sum + point.away, 0) / total * 100) },
  }
})
const goalEvents = computed(() => buildPressureGoalMarkers(props.match))
const plottedGoalEvents = computed(() => goalEvents.value.filter((event): event is PressureGoalMarker & { minute: number } => event.minute !== null))
const unknownGoalCount = computed(() => goalEvents.value.filter((event) => event.minute === null).length)
const goalY = (minute: number, side: 'home' | 'away' | 'unknown') => {
  const nearest = points.value.reduce((best, point) => Math.abs(point.minute - minute) < Math.abs(best.minute - minute) ? point : best, points.value[0] ?? { minute: 0, home: 50, away: 50 })
  return y(side === 'away' ? nearest.away : nearest.home)
}
const goalLabelBelow = (minute: number, side: 'home' | 'away' | 'unknown') => goalY(minute, side) < chart.top + 46
const goalTeam = (side: 'home' | 'away' | 'unknown') => side === 'home' ? props.match.home : side === 'away' ? props.match.away : '进球队伍待确认'
const technicalRows: { key: keyof TechnicalStats; label: string; percent?: boolean }[] = [
  { key: 'shots', label: '射门' },
  { key: 'shotsOnTarget', label: '射正' },
  { key: 'possession', label: '控球率', percent: true },
  { key: 'dangerousAttacks', label: '危险进攻' },
]
const hasTechnicalStats = computed(() => technicalRows.some(({ key }) => {
  const item = props.match.technicalStats?.[key]
  return item?.home !== null && item?.home !== undefined || item?.away !== null && item?.away !== undefined
}))
const technicalValue = (key: keyof TechnicalStats, side: 'home' | 'away', percent = false) => {
  const value = props.match.technicalStats?.[key]?.[side]
  return value === null || value === undefined ? '—' : `${value}${percent ? '%' : ''}`
}
const technicalShare = (key: keyof TechnicalStats, side: 'home' | 'away') => {
  const item = props.match.technicalStats?.[key]
  const home = item?.home ?? 0; const away = item?.away ?? 0
  const total = home + away
  if (!total) return 0
  return Math.round((side === 'home' ? home : away) / total * 100)
}
</script>

<template>
  <section class="pressure-panel pressure-reference" :aria-label="`${match.home}与${match.away}进攻压力图`">
    <header class="pressure-header">
      <div>
        <span class="pressure-eyebrow">ATTACK PRESSURE · 0–{{ currentMinute }}′</span>
        <h3>{{ match.home }} <b>{{ match.homeScore }} : {{ match.awayScore }}</b> {{ match.away }}</h3>
        <p>依据比分、进球节点与即时欧赔生成的走势估算，非源站实时技术统计。</p>
      </div>
      <strong class="pressure-leader">{{ summary.leader === '均衡' ? '双方攻势均衡' : `${summary.leader}攻势占优` }}</strong>
    </header>

    <div class="current-pressure" aria-label="当前进攻压力占比">
      <div class="pressure-side home-side"><span>主队压力</span><b>{{ currentShare.home }}%</b></div>
      <div class="pressure-balance"><i class="home-fill" :style="{ width: `${currentShare.home}%` }"></i><i class="away-fill" :style="{ width: `${currentShare.away}%` }"></i></div>
      <div class="pressure-side away-side"><b>{{ currentShare.away }}%</b><span>客队压力</span></div>
    </div>

    <div class="pressure-dashboard">
      <div class="pressure-chart-column">
        <div class="pressure-chart-wrap line-chart-wrap">
          <div v-if="unknownGoalCount" class="unknown-goal-notice" role="note"><img :src="goalBallIcon" alt=""><span>另有 {{ unknownGoalCount }} 个进球时间待源站补充</span></div>
          <svg class="pressure-chart line-pressure-chart" :viewBox="`0 0 ${chart.width} ${chart.height}`" role="img" :aria-label="`${match.home}与${match.away}上半场进攻压力曲线；最近十分钟${summary.leader === '均衡' ? '双方均衡' : summary.leader + '占优'}`">
            <defs>
              <linearGradient :id="homeAreaId" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#e11d48" stop-opacity=".24"/><stop offset=".7" stop-color="#e11d48" stop-opacity=".08"/><stop offset="1" stop-color="#e11d48" stop-opacity="0"/>
              </linearGradient>
              <linearGradient :id="awayAreaId" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#2563eb" stop-opacity=".22"/><stop offset=".7" stop-color="#2563eb" stop-opacity=".07"/><stop offset="1" stop-color="#2563eb" stop-opacity="0"/>
              </linearGradient>
              <filter :id="homeGlowId" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
              <filter :id="awayGlowId" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            </defs>
            <rect class="plot-surface" :x="chart.left" :y="chart.top" :width="plotWidth" :height="plotHeight" rx="8" />
            <g class="line-grid">
              <line v-for="tick in yTicks" :key="`y-${tick}`" :x1="chart.left" :x2="chart.width-chart.right" :y1="y(tick)" :y2="y(tick)" />
              <line v-for="tick in xTicks" :key="`x-${tick}`" :x1="x(tick)" :x2="x(tick)" :y1="chart.top" :y2="chart.bottom" />
            </g>
            <g v-if="points.length" class="live-edge">
              <line :x1="x(latest.minute)" :x2="x(latest.minute)" :y1="chart.top" :y2="chart.bottom" />
              <text :x="x(latest.minute)" :y="chart.top + 12" text-anchor="middle">实时 {{ latest.minute }}′</text>
            </g>
            <path :d="areaPath('away')" :fill="`url(#${awayAreaId})`" class="pressure-area away-area" />
            <path :d="areaPath('home')" :fill="`url(#${homeAreaId})`" class="pressure-area home-area" />
            <path :d="linePath('away')" class="pressure-line away-line" :style="{ filter: `url(#${awayGlowId})` }" />
            <path :d="linePath('home')" class="pressure-line home-line" :style="{ filter: `url(#${homeGlowId})` }" />
            <g v-if="points.length" class="latest-points" aria-hidden="true">
              <circle :cx="x(latest.minute)" :cy="y(latest.away)" r="4.5" class="away-latest" />
              <circle :cx="x(latest.minute)" :cy="y(latest.home)" r="4.5" class="home-latest" />
            </g>
            <g v-for="point in points" :key="`point-${point.minute}`" class="pressure-hit-points">
              <circle :cx="x(point.minute)" :cy="y(point.home)" r="7"><title>{{ point.minute }}′ {{ match.home }}压力 {{ point.home }}</title></circle>
              <circle :cx="x(point.minute)" :cy="y(point.away)" r="7"><title>{{ point.minute }}′ {{ match.away }}压力 {{ point.away }}</title></circle>
            </g>
            <g v-for="(event, eventIndex) in plottedGoalEvents" :key="`${event.minute}-${event.side}-${eventIndex}`" :class="['line-goal-marker', `goal-${event.side}`]" :transform="`translate(${x(event.minute)} ${goalY(event.minute, event.side)})`" role="img" :aria-label="`${event.minute}分钟，${goalTeam(event.side)}进球`">
              <title>{{ `${event.minute}′ ${goalTeam(event.side)}进球` }}</title>
              <line class="goal-stem" :y1="goalLabelBelow(event.minute, event.side) ? 15 : -15" :y2="goalLabelBelow(event.minute, event.side) ? 24 : -24" />
              <circle r="21" class="goal-halo" />
              <circle r="16" class="goal-ring" />
              <circle r="12.5" class="goal-icon-bg" />
              <image :href="goalBallIcon" x="-9" y="-9" width="18" height="18" preserveAspectRatio="xMidYMid meet" />
              <g class="goal-time-pill" :transform="`translate(0 ${goalLabelBelow(event.minute, event.side) ? 34 : -34})`">
                <rect x="-17" y="-9" width="34" height="18" rx="9" />
                <text y="3.5" text-anchor="middle">{{ event.minute }}′</text>
              </g>
            </g>
            <g class="line-axis-labels">
              <text v-for="tick in yTicks" :key="`yl-${tick}`" :x="chart.left-9" :y="y(tick)+3" text-anchor="end">{{ tick }}</text>
              <text v-for="tick in xTicks" :key="`xl-${tick}`" :x="x(tick)" y="309" text-anchor="middle">{{ tick }}′</text>
              <text :x="chart.left" y="324" class="axis-caption">比赛时间（分钟）</text>
              <text :x="chart.left - 32" :y="chart.top - 7" class="axis-caption">压力值</text>
            </g>
          </svg>
        </div>
        <div class="pressure-legend line-legend"><strong>进攻压力曲线</strong><span><i class="home-line-key"></i>{{ match.home }}</span><span><i class="away-line-key"></i>{{ match.away }}</span><small>压力越高代表该时段攻势越强；悬停曲线节点查看数值。</small></div>
      </div>

      <aside class="pressure-insights" aria-label="进攻压力技术指标">
        <div class="insight-title"><b>压力指标</b><span>模型估算</span></div>
        <div class="gauge-grid"><div v-for="gauge in metrics.gauges" :key="gauge.label" class="gauge-item"><span>{{ gauge.label }}</span><div class="gauge" :style="{ '--gauge-value': `${gauge.value * 3.6}deg` }"><b>{{ gauge.value }}%</b></div></div></div>
        <div class="compare-head"><span><i class="home-swatch"></i>{{ match.home }}</span><span><i class="away-swatch"></i>{{ match.away }}</span></div>
        <div v-for="item in ([{ label: '平均压力', key: 'average' }, { label: '近10分钟', key: 'recent' }, { label: '峰值压力', key: 'peak' }, { label: '攻势占比', key: 'share' }] as const)" :key="item.key" class="compare-row">
          <b>{{ metrics.home[item.key] }}</b><div><span>{{ item.label }}</span><i><em class="home-stat" :style="{ width: `${metrics.home[item.key]}%` }"></em><em class="away-stat" :style="{ width: `${metrics.away[item.key]}%` }"></em></i></div><b>{{ metrics.away[item.key] }}</b>
        </div>
        <section class="source-stats" aria-labelledby="source-stats-title">
          <div class="source-stats-title"><b id="source-stats-title">技术统计</b><span>源站实时</span></div>
          <div class="source-team-head"><span><i class="home-swatch"></i>{{ match.home }}</span><strong>数据对比</strong><span>{{ match.away }}<i class="away-swatch"></i></span></div>
          <div v-if="hasTechnicalStats" class="source-stats-list" role="table" aria-label="双方技术统计">
            <div v-for="item in technicalRows" :key="item.key" class="source-stat-row" role="row">
              <b role="cell">{{ technicalValue(item.key, 'home', item.percent) }}</b>
              <div role="cell"><span>{{ item.label }}</span><i><em class="source-home-bar" :style="{ width: `${technicalShare(item.key, 'home')}%` }"></em><em class="source-away-bar" :style="{ width: `${technicalShare(item.key, 'away')}%` }"></em></i></div>
              <b role="cell">{{ technicalValue(item.key, 'away', item.percent) }}</b>
            </div>
          </div>
          <p v-else class="source-stats-empty">源站暂未提供本场技术统计</p>
        </section>
      </aside>
    </div>
  </section>
</template>
