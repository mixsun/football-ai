<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { LiveMatch, LiveResponse, Market, Triple } from '../types'

type QueryMode = 'live' | 'secondGoal'
type Filters = { homeHalf: string; awayHalf: string; team: string; league: string; date: string; sameTotals: boolean }

const blankFilters = (): Filters => ({ homeHalf: '', awayHalf: '', team: '', league: '', date: '', sameTotals: false })
const draft = reactive<Filters>(blankFilters())
const applied = reactive<Filters>(blankFilters())
const mode = ref<QueryMode>('live')
const matches = ref<LiveMatch[]>([])
const loading = ref(true)
const error = ref('')
const fetchedAt = ref('')

async function load() {
  loading.value = true; error.value = ''
  try {
    const response = await fetch('/api/live', { cache: 'no-store' })
    const body = await response.json() as LiveResponse & { error?: string }
    if (!response.ok) throw new Error(body.error || '数据读取失败')
    matches.value = body.matches; fetchedAt.value = body.fetchedAt
  } catch (reason) { error.value = reason instanceof Error ? reason.message : '数据读取失败' }
  finally { loading.value = false }
}

const pad = (value: number) => String(value).padStart(2, '0')
const dateValue = (match: LiveMatch) => {
  const raw = match.actualStart || match.scheduledAt
  if (!raw) return ''
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? '' : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
const dateTime = (match: LiveMatch) => {
  const raw = match.actualStart || match.scheduledAt
  if (!raw) return '—'
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? '—' : `${String(date.getFullYear()).slice(-2)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
const hasSecondHalfGoal = (match: LiveMatch) => match.goalMinutes.some((minute) => minute > 45)
  || match.homeScore + match.awayScore > match.homeHalfScore + match.awayHalfScore
const sameTotals = (match: LiveMatch) => {
  const total = match.markets?.total
  return total?.opening.line !== null && total?.opening.line === total?.current.line
}
const filtered = computed(() => matches.value.filter((match) => {
  if (mode.value === 'secondGoal' && !hasSecondHalfGoal(match)) return false
  if (applied.homeHalf !== '' && match.homeHalfScore !== Number(applied.homeHalf)) return false
  if (applied.awayHalf !== '' && match.awayHalfScore !== Number(applied.awayHalf)) return false
  const team = applied.team.trim().toLowerCase()
  if (team && !`${match.home} ${match.away}`.toLowerCase().includes(team)) return false
  const league = applied.league.trim().toLowerCase()
  if (league && !match.league.toLowerCase().includes(league)) return false
  if (applied.date && dateValue(match) !== applied.date) return false
  if (applied.sameTotals && !sameTotals(match)) return false
  return true
}))

const percentage = (value: number, total: number) => total ? Math.round(value / total * 10_000) / 100 : 0
const distribution = (values: string[]) => {
  const counts = new Map<string, number>()
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1))
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => `${key}、${count}`).join('；') || '暂无'
}
const summary = computed(() => {
  const rows = filtered.value; const total = rows.length
  const line = (match: LiveMatch) => match.markets?.asian.current.line
  const up = rows.filter((match) => (line(match) ?? 0) > 0).length
  const flat = rows.filter((match) => line(match) === 0).length
  const down = rows.filter((match) => (line(match) ?? 0) < 0).length
  const homeWin = rows.filter((match) => match.homeScore > match.awayScore).length
  const draw = rows.filter((match) => match.homeScore === match.awayScore).length
  const awayWin = rows.filter((match) => match.homeScore < match.awayScore).length
  const totalGoals = rows.reduce((sum, match) => sum + match.homeScore + match.awayScore, 0)
  const withGoal = rows.filter((match) => match.homeScore + match.awayScore > 0).length
  const secondFirst = rows.map((match) => match.goalMinutes.filter((minute) => minute > 45).sort((a, b) => a - b)[0]).filter((minute): minute is number => minute !== undefined)
  const secondCounts = rows.map((match) => String(match.goalMinutes.filter((minute) => minute > 45).length))
  return {
    total, up, flat, down, homeWin, draw, awayWin, totalGoals, withGoal, noGoal: total - withGoal,
    goalRate: percentage(withGoal, total), bothHalfHome: rows.filter((match) => match.homeHalfScore > 0).length,
    bothHalfAway: rows.filter((match) => match.awayHalfScore > 0).length,
    allFirstHalf: rows.filter((match) => match.homeHalfScore + match.awayHalfScore > 0).length,
    allSecondHalf: rows.filter(hasSecondHalfGoal).length,
    after60: percentage(secondFirst.filter((minute) => minute >= 60).length, secondFirst.length),
    after70: percentage(secondFirst.filter((minute) => minute >= 70).length, secondFirst.length),
    after80: percentage(secondFirst.filter((minute) => minute >= 80).length, secondFirst.length),
    secondDistribution: distribution(secondCounts.map((count) => `${count}球`)),
    halfScores: distribution(rows.map((match) => `${match.homeHalfScore}-${match.awayHalfScore}`)),
    fullScores: distribution(rows.map((match) => `${match.homeScore}-${match.awayScore}`)),
  }
})

const applyQuery = () => Object.assign(applied, draft)
const resetQuery = () => { Object.assign(draft, blankFilters()); Object.assign(applied, blankFilters()) }
const clearDate = () => { draft.date = ''; applied.date = '' }
const n = (value: number | null | undefined) => value === null || value === undefined ? '—' : Number.isInteger(value) ? String(value) : value.toFixed(2)
const market = (value: Market | undefined) => value ?? { opening: { left: null, line: null, right: null }, current: { left: null, line: null, right: null } }
const odds = (value: Market | undefined, key: keyof Triple) => [n(market(value).opening[key]), n(market(value).current[key])]
const panClass = (match: LiveMatch) => {
  const line = match.markets?.asian.current.line ?? 0
  return line > 0 ? 'pan-up' : line < 0 ? 'pan-down' : 'pan-flat'
}
const goals = (match: LiveMatch) => (match.goalEvents?.length ? match.goalEvents : match.goalMinutes.map((minute) => ({ minute, side: 'unknown' as const })))

onMounted(load)
</script>

<template>
  <main id="main-content" class="query-page">
    <header class="query-hero">
      <div><span class="eyebrow">MATCH DATABASE</span><h1>比赛查询</h1><p>按球队、赛事、日期与半场比分筛选，联动查看盘口、比分和进球分布。</p></div>
      <div class="query-sync"><span><i></i>{{ loading ? '正在同步' : '数据已就绪' }}</span><small v-if="fetchedAt">{{ new Date(fetchedAt).toLocaleString('zh-CN') }}</small></div>
    </header>

    <form class="query-panel" @submit.prevent="applyQuery">
      <div class="query-score-fields">
        <span>上半场入球</span>
        <label for="home-half">主队</label><input id="home-half" v-model="draft.homeHalf" type="number" min="0" inputmode="numeric">
        <label for="away-half">客队</label><input id="away-half" v-model="draft.awayHalf" type="number" min="0" inputmode="numeric">
      </div>
      <div class="query-fields">
        <label><span>球队</span><input v-model="draft.team" type="search" placeholder="输入主队或客队"></label>
        <label><span>赛事</span><input v-model="draft.league" type="search" placeholder="输入联赛名称"></label>
        <label><span>比赛日期</span><input v-model="draft.date" type="date"></label>
        <button class="secondary-button" type="button" @click="clearDate">清空日期</button>
        <button class="query-button" type="submit">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>查询
        </button>
        <button class="text-button" type="button" @click="resetQuery">重置</button>
      </div>
      <div class="query-options">
        <div class="segmented query-tabs" role="group" aria-label="比赛范围">
          <button type="button" :class="{ active: mode === 'live' }" @click="mode = 'live'">LIVE 比赛</button>
          <button type="button" :class="{ active: mode === 'secondGoal' }" @click="mode = 'secondGoal'">下半场有球</button>
        </div>
        <span class="pan-legend"><i class="pan-up"></i>主队让球 <i class="pan-down"></i>客队让球 <i class="pan-flat"></i>平手盘</span>
        <label class="check-option"><input v-model="draft.sameTotals" type="checkbox"><span></span>大小盘初即一致</label>
      </div>
    </form>

    <div v-if="error" class="notice error"><b>暂时无法读取</b><span>{{ error }}</span><button @click="load">重试</button></div>

    <template v-else>
      <section class="summary-strip" aria-label="查询统计">
        <div class="summary-cards">
          <div><span>共</span><strong>{{ summary.total }}</strong><small>场</small></div>
          <div><span>主队让球</span><strong>{{ summary.up }}</strong><small>场</small></div>
          <div><span>平手盘</span><strong>{{ summary.flat }}</strong><small>场</small></div>
          <div><span>客队让球</span><strong>{{ summary.down }}</strong><small>场</small></div>
          <div><span>主胜</span><strong>{{ summary.homeWin }}</strong><small>场</small></div>
          <div><span>和局</span><strong>{{ summary.draw }}</strong><small>场</small></div>
          <div><span>客胜</span><strong>{{ summary.awayWin }}</strong><small>场</small></div>
        </div>
        <div class="summary-lines">
          <p>总进球 <b>{{ summary.totalGoals }}</b><span>有球 {{ summary.withGoal }}</span><span>没球 {{ summary.noGoal }}</span><span>有球概率 {{ summary.goalRate }}%</span><span>上半场入球主队 {{ summary.bothHalfHome }}</span><span>客队 {{ summary.bothHalfAway }}</span></p>
          <p>半场比分：<b>{{ summary.halfScores }}</b></p>
          <p>当前比分：<b>{{ summary.fullScores }}</b></p>
        </div>
        <div class="distribution-bar">
          <p><b>下半场第一进球时间分布</b><span>60′及以后 <strong>{{ summary.after60 }}%</strong></span><span>70′及以后 <strong>{{ summary.after70 }}%</strong></span><span>80′及以后 <strong>{{ summary.after80 }}%</strong></span></p>
          <p><b>下半场进球个数</b><span>{{ summary.secondDistribution }}</span></p>
        </div>
      </section>

      <section class="query-results" :aria-busy="loading">
        <div v-if="loading" class="query-loading"><i></i><span>正在读取比赛数据…</span></div>
        <div v-else-if="!filtered.length" class="query-empty"><b>没有匹配的比赛</b><span>请放宽比分、球队或日期条件后重试。</span><button @click="resetQuery">清除条件</button></div>
        <div v-else class="query-table-wrap">
          <table class="query-table">
            <thead><tr><th>序</th><th>盘型</th><th>赛事</th><th>比赛时间</th><th>主队</th><th>半场 / 当前</th><th>客队</th><th>进球时间</th><th>类似盘</th><th colspan="3">亚盘（初 / 即）</th><th colspan="3">大小盘（初 / 即）</th></tr></thead>
            <tbody>
              <tr v-for="(match, index) in filtered" :key="match.id">
                <td class="query-index">{{ index + 1 }}</td>
                <td><span class="pan-cell" :class="panClass(match)">{{ panClass(match) === 'pan-up' ? '上' : panClass(match) === 'pan-down' ? '下' : '平' }}</span></td>
                <td><span class="league-tag">{{ match.league }}</span></td>
                <td class="query-date">{{ dateTime(match) }}</td>
                <td class="query-team home">{{ match.home }}</td>
                <td class="query-score"><span>{{ match.homeHalfScore }}-{{ match.awayHalfScore }}</span><b>{{ match.homeScore }}-{{ match.awayScore }}</b></td>
                <td class="query-team">{{ match.away }}</td>
                <td class="query-goals">
                  <div class="query-goal-track"><b>H</b><i v-for="(goal, goalIndex) in goals(match)" :key="`${goal.minute}-${goalIndex}`" :class="goal.side" :style="{ left: `${Math.min(100, goal.minute / 90 * 100)}%` }"><span></span><small>{{ goal.minute }}′</small></i></div>
                </td>
                <td class="similar-count">{{ match.sameMarketCount }}</td>
                <td v-for="key in (['left','line','right'] as const)" :key="`asian-${key}`" class="query-odds"><span>{{ odds(match.markets?.asian, key)[0] }}</span><b>{{ odds(match.markets?.asian, key)[1] }}</b></td>
                <td v-for="key in (['left','line','right'] as const)" :key="`total-${key}`" class="query-odds total"><span>{{ odds(match.markets?.total, key)[0] }}</span><b>{{ odds(match.markets?.total, key)[1] }}</b></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </main>
</template>
