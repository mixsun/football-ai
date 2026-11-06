<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { buildLiveGoalStructure, buildRealtimePressure } from '../lib/live-goal-structure'
import type { LiveMatch, Market, MatchDetailResponse, Triple } from '../types'
import goalBallIcon from '../goal-ball.png'

const props = defineProps<{ match: LiveMatch }>()
defineEmits<{ close: [] }>()

const structure = computed(() => buildLiveGoalStructure(props.match))
const matchDetail = ref<MatchDetailResponse | null>(null)
const detailLoading = ref(true)
const detailError = ref('')
let detailTimer: ReturnType<typeof setInterval> | undefined
const loadMatchDetail = async () => {
  try {
    const response = await fetch(`/api/detail/${props.match.id}`, { cache: 'no-store' })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error ?? '详情读取失败')
    matchDetail.value = payload
    detailError.value = ''
  } catch (error) {
    detailError.value = error instanceof Error ? error.message : '详情读取失败'
  } finally { detailLoading.value = false }
}
onMounted(() => { loadMatchDetail(); detailTimer = setInterval(loadMatchDetail, 30_000) })
onUnmounted(() => { if (detailTimer) clearInterval(detailTimer) })

const importantStatKinds = [4, 5, 11, 6, 7, 0, 2, 3, 47, 52, 53, 54, 55, 56]
const importantStats = computed(() => [...(matchDetail.value?.stats ?? [])].sort((a, b) => {
  const left = importantStatKinds.indexOf(a.kind); const right = importantStatKinds.indexOf(b.kind)
  return (left < 0 ? 99 : left) - (right < 0 ? 99 : right)
}).slice(0, 10))
const realtimePressure = computed(() => buildRealtimePressure(props.match, matchDetail.value))
const pressureValue = (side: 'home' | 'away') => realtimePressure.value[side] ?? 0
const chartWidth = 720
const chartHeight = 220
const chartPadding = { left: 36, right: 16, top: 18, bottom: 28 }
const matchMinute = computed(() => props.match.minute ?? 0)
const pressureGoalSource = computed(() => {
  const detailGoals = (matchDetail.value?.events ?? []).filter((event) => [1, 8].includes(event.kind) && event.minute <= 45)
  if (detailGoals.length) return detailGoals.map((event) => ({
    minute: event.minute,
    chartMinute: event.minute + event.extraMinute,
    label: `${event.minute}${event.extraMinute ? `+${event.extraMinute}` : ''}′`,
    side: event.side,
  }))
  return (props.match.goalEvents ?? []).filter((goal) => goal.minute <= 45).map((goal) => ({
    minute: goal.minute,
    chartMinute: goal.minute,
    label: `${goal.minute}′`,
    side: goal.side === 'away' ? 'away' as const : 'home' as const,
  }))
})
const trendStructure = computed(() => buildLiveGoalStructure({
  ...props.match,
  goalEvents: pressureGoalSource.value.map((goal) => ({ minute: goal.chartMinute, side: goal.side })),
}))
const pressureTrend = computed(() => {
  const source = trendStructure.value.pressureTimeline
  if (!realtimePressure.value.available || !source.length) return source
  const last = source.at(-1)!
  const homeTarget = realtimePressure.value.home ?? last.home
  const awayTarget = realtimePressure.value.away ?? last.away
  return source.map((point) => {
    const progress = point.minute / Math.max(1, last.minute)
    return {
      ...point,
      home: Math.max(0, Math.min(100, Math.round(point.home + (homeTarget - last.home) * progress))),
      away: Math.max(0, Math.min(100, Math.round(point.away + (awayTarget - last.away) * progress))),
    }
  })
})
const trendMaxMinute = computed(() => Math.max(1, matchMinute.value, ...pressureTrend.value.map((point) => point.minute), ...pressureGoalSource.value.map((goal) => goal.chartMinute)))
const chartX = (minute: number) => chartPadding.left + minute / trendMaxMinute.value * (chartWidth - chartPadding.left - chartPadding.right)
const chartY = (value: number) => chartPadding.top + (100 - value) / 100 * (chartHeight - chartPadding.top - chartPadding.bottom)
const linePoints = (side: 'home' | 'away') => pressureTrend.value.map((point) => `${chartX(point.minute)},${chartY(point[side])}`).join(' ')
const pressureGoalMarkers = computed(() => pressureGoalSource.value.map((goal) => {
  const point = pressureTrend.value.reduce((nearest, item) => Math.abs(item.minute - goal.chartMinute) < Math.abs(nearest.minute - goal.chartMinute) ? item : nearest)
  return { ...goal, x: chartX(goal.chartMinute), y: chartY(point[goal.side]) }
}))
const possessionSide = computed(() => structure.value.favoredSide === 'balanced'
  ? (pressureValue('home') >= pressureValue('away') ? 'home' : 'away')
  : structure.value.favoredSide)
const possessionTeam = computed(() => possessionSide.value === 'home' ? props.match.home : props.match.away)
const possessionShare = computed(() => possessionSide.value === 'home' ? structure.value.homeShare : structure.value.awayShare)
const pitchEvents = computed(() => (matchDetail.value?.events ?? [])
  .filter((event) => event.minute <= 45)
  .map((event) => ({
    ...event,
    displayMinute: event.minute + event.extraMinute,
    timeLabel: `${event.minute}${event.extraMinute ? `+${event.extraMinute}` : ''}′`,
    eventClass: [1, 8].includes(event.kind) ? 'goal' : [2, 9].includes(event.kind) ? 'red-card' : event.kind === 3 ? 'yellow-card' : [7, 13].includes(event.kind) ? 'penalty' : 'other',
  }))
  .sort((left, right) => left.displayMinute - right.displayMinute))
const pitchPointEvents = computed(() => pitchEvents.value.map((event, index) => {
  const attackingProgress = Math.min(1, Math.max(0, event.displayMinute / Math.max(1, matchMinute.value || 45)))
  const finalThirdX = 64 + attackingProgress * 23
  const x = event.side === 'home' ? finalThirdX : 100 - finalThirdX
  const y = 18 + ((event.minute * 29 + event.kind * 17 + index * 23) % 65)
  return { ...event, x, y }
}))
const pointStyle = (event: { x: number; y: number }) => ({ left: `${event.x}%`, top: `${event.y}%` })
const eventPosition = (minute: number) => `${Math.max(1.5, Math.min(98.5, minute / 45 * 100))}%`
const indexText = (value: number | null) => value == null ? '—' : Number.isInteger(value) ? String(value) : value.toFixed(2)
const marketValues = (market: Market | undefined, state: 'opening' | 'current') => {
  const value: Triple | undefined = market?.[state]
  return [indexText(value?.left ?? null), indexText(value?.line ?? null), indexText(value?.right ?? null)]
}
const liveIndexRows = computed(() => {
  const markets = props.match.markets
  return [
    { label: '全场亚盘', market: markets?.liveAsian ?? markets?.asian },
    { label: '全场大小', market: markets?.total },
    { label: '半场剩余', market: markets?.halfTotal },
  ].map((item) => ({ ...item, opening: marketValues(item.market, 'opening'), current: marketValues(item.market, 'current') }))
})
const historyRate = (side: 'home' | 'away') => {
  const history = props.match.halfGoalHistory?.[side]
  return history?.sample ? `${Math.round(history.withGoal / history.sample * 100)}%` : '—'
}
const scoringRows = computed(() => [
  { side: 'home', team: props.match.home, scored: props.match.homeScore, conceded: props.match.awayScore, history: historyRate('home') },
  { side: 'away', team: props.match.away, scored: props.match.awayScore, conceded: props.match.homeScore, history: historyRate('away') },
])
</script>

<template>
  <div class="goal-modal-backdrop" @click="$emit('close')">
    <article class="goal-structure-modal" role="dialog" aria-modal="true" :aria-label="`${match.home}对${match.away}上半场进球结构分析`" @click.stop>
      <header class="goal-modal-heading">
        <div><span>{{ match.league }} · 上 {{ match.minute ?? '—' }}′</span><h3>{{ match.home }} <b>{{ match.homeScore }}-{{ match.awayScore }}</b> {{ match.away }}</h3><p>上半场进球结构分析 · 实时压力与比赛事件</p></div>
        <button type="button" aria-label="关闭进球结构分析" @click="$emit('close')">×</button>
      </header>

      <section class="goal-summary-grid">
        <div><span>剩余进球机会</span><strong>{{ structure.probability == null ? '—' : `${structure.probability}%` }}</strong><small>盘口与剩余时间模型估值 · 非确定结果</small></div>
        <div><span>市场强弱方向</span><strong>{{ structure.favoredText }}</strong><small>欧赔主客相对权重：{{ match.home }} {{ structure.homeShare }}% · {{ match.away }} {{ structure.awayShare }}%</small></div>
      </section>

      <section class="pressure-analysis-board" aria-label="两队实时进攻压力分析">
        <div class="pressure-board-head">
          <div class="pressure-team pressure-home">
            <div class="pressure-gauge" :class="{ unavailable: !realtimePressure.available }" :style="{ '--pressure': `${pressureValue('home')}%` }"><span>⚡</span><strong>{{ realtimePressure.home ?? '—' }}</strong><small>/100</small></div>
            <div><b>{{ match.home }}</b><span>主队实时进攻压力</span><small>来自累计技术统计</small></div>
          </div>
          <div class="pressure-compare"><span>当前分钟</span><b>{{ match.minute ?? '—' }}′</b><small>{{ detailLoading ? '读取统计中' : realtimePressure.available ? '每30秒更新' : '统计不足' }}</small></div>
          <div class="pressure-team pressure-away">
            <div><b>{{ match.away }}</b><span>客队实时进攻压力</span><small>来自累计技术统计</small></div>
            <div class="pressure-gauge" :class="{ unavailable: !realtimePressure.available }" :style="{ '--pressure': `${pressureValue('away')}%` }"><span>⚡</span><strong>{{ realtimePressure.away ?? '—' }}</strong><small>/100</small></div>
          </div>
        </div>

        <div class="pressure-content-grid">
          <div class="pressure-trend-panel">
          <header><div><b>进攻压力趋势图</b><small>主队红线 · 客队蓝线 · 进球节点保留</small></div><em>趋势示意</em></header>
          <svg class="pressure-trend-chart" :viewBox="`0 0 ${chartWidth} ${chartHeight}`" role="img" aria-label="两队进攻压力趋势图">
            <g class="trend-grid">
              <line v-for="value in [0, 25, 50, 75, 100]" :key="value" :x1="chartPadding.left" :x2="chartWidth - chartPadding.right" :y1="chartY(value)" :y2="chartY(value)" />
              <text v-for="value in [0, 25, 50, 75, 100]" :key="`label-${value}`" x="8" :y="chartY(value) + 3">{{ value }}</text>
              <line v-for="minute in [0, Math.round(trendMaxMinute / 2), trendMaxMinute]" :key="`minute-${minute}`" :x1="chartX(minute)" :x2="chartX(minute)" :y1="chartPadding.top" :y2="chartHeight - chartPadding.bottom" />
              <text v-for="minute in [0, Math.round(trendMaxMinute / 2), trendMaxMinute]" :key="`minute-label-${minute}`" :x="chartX(minute)" :y="chartHeight - 8" text-anchor="middle">{{ minute }}′</text>
            </g>
            <polyline class="trend-line trend-home-line" :points="linePoints('home')" />
            <polyline class="trend-line trend-away-line" :points="linePoints('away')" />
            <g v-for="goal in pressureGoalMarkers" :key="`${goal.label}-${goal.side}`" class="trend-goal" :class="`trend-goal-${goal.side}`">
              <title>进球时间 {{ goal.label }}</title>
              <text class="trend-goal-minute" :x="goal.x" :y="goal.y - 14" text-anchor="middle">{{ goal.label }}</text>
              <circle :cx="goal.x" :cy="goal.y" r="9" />
              <text class="trend-goal-icon" :x="goal.x" :y="goal.y + 4" text-anchor="middle">⚽</text>
            </g>
          </svg>
            <footer><span><i class="home"></i>{{ match.home }}</span><span><i class="away"></i>{{ match.away }}</span><small>基于比分、时间和当前方向的模型趋势，不是 Titan 逐分钟实测历史。</small></footer>
          </div>

          <article class="technical-stat-card pressure-stat-card">
            <h4><span>技术统计</span><small>{{ importantStats.length ? '实时' : '暂无' }}</small></h4>
            <div v-if="importantStats.length" class="technical-stat-list">
              <div v-for="stat in importantStats" :key="stat.kind">
                <div><strong>{{ stat.home }}</strong><span>{{ stat.label }}</span><strong>{{ stat.away }}</strong></div>
                <i><b class="stat-home-bar" :style="{ width: `${stat.homePercent}%` }"></b><b class="stat-away-bar" :style="{ width: `${stat.awayPercent}%` }"></b></i>
              </div>
            </div>
            <p v-else class="detail-empty">源站暂未发布技术统计</p>
            <p v-if="detailError" class="detail-error">{{ detailError }}，将继续自动重试。</p>
          </article>
        </div>
      </section>

      <section class="goal-structure-section possession-section">
        <header><div><b>即时球权活动图</b><small>结合实时压力、比分与事件推演当前推进方向</small></div><em>方向示意</em></header>
        <div class="possession-board-grid">
          <aside class="live-index-panel" aria-label="即时指数">
            <h4><span>即时指数</span><small>初盘 / 即时</small></h4>
            <div class="index-column-head"><span>类型</span><span>主/大</span><span>盘口</span><span>客/小</span></div>
            <div v-for="row in liveIndexRows" :key="row.label" class="live-index-row">
              <b>{{ row.label }}</b>
              <div><small>初</small><span v-for="(value, index) in row.opening" :key="`open-${row.label}-${index}`">{{ value }}</span></div>
              <div><small>即</small><strong v-for="(value, index) in row.current" :key="`current-${row.label}-${index}`">{{ value }}</strong></div>
            </div>
          </aside>

          <div class="possession-center">
            <div class="possession-pitch" :class="`control-${possessionSide}`" role="img" :aria-label="`${possessionTeam}当前控球攻势占优，估算占比${possessionShare}%`">
              <div class="pitch-lines"><i class="halfway"></i><i class="center-circle"></i><i class="center-spot"></i><i class="home-box"></i><i class="away-box"></i><i class="home-goal-box"></i><i class="away-goal-box"></i><i class="home-goal"></i><i class="away-goal"></i></div>
              <div class="control-zone" aria-hidden="true"></div>
              <div class="pitch-team pitch-home"><b>{{ match.home }}</b><small>向右进攻 →</small></div>
              <div class="pitch-team pitch-away-label"><b>{{ match.away }}</b><small>← 向左进攻</small></div>
              <div class="pitch-point-layer" aria-label="已记录比赛事件点位">
                <div v-for="(event, index) in pitchPointEvents" :key="`point-${event.kind}-${event.displayMinute}-${index}`" class="pitch-event-point" :class="[`point-${event.side}`, `point-${event.eventClass}`]" :style="pointStyle(event)" tabindex="0" role="img" :aria-label="`${event.timeLabel} ${event.side === 'home' ? match.home : match.away} ${event.label}，点位为方向示意`">
                  <img v-if="event.eventClass === 'goal'" :src="goalBallIcon" alt="">
                  <i v-else aria-hidden="true"></i>
                  <span>{{ event.timeLabel }} · {{ event.label }}<small v-if="event.player">{{ event.player }}</small></span>
                </div>
                <p v-if="!pitchPointEvents.length">源站暂未记录可显示的比赛事件点位</p>
              </div>
              <div class="possession-callout">
                <span class="possession-ball" aria-hidden="true"></span>
                <div><b>{{ possessionTeam }}</b><strong>控球 · 攻势占优</strong><small>{{ possessionShare }}% 方向权重</small></div>
              </div>
            </div>
            <div class="match-event-timeline" aria-label="上半场比赛事件时间轴">
              <div class="timeline-scale"><span>0′</span><span>15′</span><span>30′</span><span>HT</span></div>
              <div class="timeline-track">
                <i v-for="segment in 15" :key="segment"></i>
                <div v-for="(event, index) in pitchEvents" :key="`${event.kind}-${event.displayMinute}-${index}`" class="timeline-event" :class="[`event-${event.side}`, `event-${event.eventClass}`]" :style="{ left: eventPosition(event.displayMinute) }">
                  <img v-if="event.eventClass === 'goal'" :src="goalBallIcon" alt="">
                  <span v-else aria-hidden="true"></span>
                  <small>{{ event.timeLabel }} · {{ event.label }}</small>
                </div>
                <div v-if="!pitchEvents.length" class="timeline-empty">源站暂未提供比赛事件</div>
              </div>
            </div>
          </div>

          <aside class="scoring-panel" aria-label="本场进球与失球">
            <h4><span>本场进球 / 失球</span><small>实时比分</small></h4>
            <div class="scoring-head"><span>球队</span><span>进球</span><span>失球</span></div>
            <div v-for="row in scoringRows" :key="row.side" class="scoring-row" :class="`scoring-${row.side}`">
              <b><i></i>{{ row.team }}</b><strong>{{ row.scored }}</strong><strong>{{ row.conceded }}</strong>
            </div>
            <div class="history-rate-head"><span>近场半场有球率</span><small>源站样本</small></div>
            <div v-for="row in scoringRows" :key="`history-${row.side}`" class="history-rate-row">
              <span>{{ row.team }}</span><b>{{ row.history }}</b>
            </div>
            <p>分时段进失球率：源站暂无可靠数据</p>
          </aside>
        </div>
        <div class="possession-legend"><span><i class="home"></i>{{ match.home }}记录点</span><span><i class="away"></i>{{ match.away }}记录点</span><span><i class="event"></i>进球 / 事件</span><small>源站未提供 x/y 坐标；点位按球队方向与事件时间排布，不代表真实射门落点。</small></div>
      </section>

      <footer class="goal-modal-notes">
        <b>数据边界</b><span v-for="item in structure.limitations" :key="item">{{ item }}</span>
      </footer>
    </article>
  </div>
</template>
