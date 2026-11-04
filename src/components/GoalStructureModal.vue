<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { buildLiveGoalStructure, buildRealtimePressure } from '../lib/live-goal-structure'
import type { LiveMatch, MatchDetailResponse } from '../types'

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

      <section class="goal-structure-section heatmap-section">
        <header><div><b>球权活动位置热力图</b><small>颜色覆盖的是连续活动区域，不对应固定点位</small></div><em>位置推演</em></header>
        <div class="pitch-heatmap" :class="`favored-${structure.favoredSide}`">
              <div class="pitch-lines"><i class="halfway"></i><i class="center-circle"></i><i class="home-box"></i><i class="away-box"></i><i class="home-goal"></i><i class="away-goal"></i></div>
              <span class="heat-field heat-field-home" :style="{ opacity: String(Math.max(.3, structure.homeShare / 100)) }" />
              <span class="heat-field heat-field-away" :style="{ opacity: String(Math.max(.3, structure.awayShare / 100)) }" />
              <span class="heat-field heat-field-transition" :style="{ opacity: structure.favoredSide === 'balanced' ? '.7' : '.42' }" />
              <div class="pitch-team pitch-home"><b>{{ match.home }}</b><small>向右进攻 →</small></div>
              <div class="pitch-team pitch-away-label"><b>{{ match.away }}</b><small>← 向左进攻</small></div>
        </div>
        <div class="heat-legend"><span><i class="home"></i>主队进攻侧球权热点</span><span><i class="away"></i>客队进攻侧球权热点</span><span><i class="mix"></i>中场转换区</span></div>
      </section>

      <footer class="goal-modal-notes">
        <b>数据边界</b><span v-for="item in structure.limitations" :key="item">{{ item }}</span>
      </footer>
    </article>
  </div>
</template>
