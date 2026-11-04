<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import GoalStructureQuery from './components/GoalStructureQuery.vue'
import MatchTable from './components/MatchTable.vue'
import { analyzeHalfGoal } from './lib/analysis'
import type { LiveMatch, LiveResponse } from './types'

const matches = ref<LiveMatch[]>([]); const loading = ref(true); const error = ref(''); const fetchedAt = ref('')
const routePath = ref(window.location.pathname)
const scope = ref<'first' | 'all'>('first'); const query = ref(''); const threshold = ref(0); const autoRefresh = ref(true)
let timer: number | undefined
let requestInFlight = false
function compareByProbability(a: LiveMatch, b: LiveMatch) {
  const probabilityA = analyzeHalfGoal(a).probability
  const probabilityB = analyzeHalfGoal(b).probability
  if (probabilityA === null) return probabilityB === null ? 0 : 1
  if (probabilityB === null) return -1
  return probabilityB - probabilityA
}
async function load() {
  if (requestInFlight) return
  requestInFlight = true
  loading.value = true; error.value = ''
  try {
    const response = await fetch('/api/live', { cache: 'no-store' }); const body = await response.json() as LiveResponse & { error?: string }
    if (!response.ok) throw new Error(body.error || '数据读取失败')
    matches.value = body.matches; fetchedAt.value = body.fetchedAt
  } catch (e) { error.value = e instanceof Error ? e.message : '数据读取失败' } finally { loading.value = false; requestInFlight = false }
}
const filtered = computed(() => matches.value.filter((m) => {
  if (scope.value === 'first' && m.state !== 1 && m.state !== 2) return false
  const analysis = analyzeHalfGoal(m)
  if (analysis.label === '盘口不足') return false
  const p = analysis.probability
  if ((p === null && threshold.value > 0) || (p !== null && p < threshold.value)) return false
  const q = query.value.trim().toLowerCase()
  return !q || `${m.league} ${m.home} ${m.away}`.toLowerCase().includes(q)
}).sort(compareByProbability))
const firstHalfMatches = computed(() => matches.value.filter((match) => match.state === 1))
const halfTimeMatches = computed(() => matches.value.filter((match) => match.state === 2))
const lateRefreshMode = computed(() => firstHalfMatches.value.some((match) => (match.minute ?? 0) >= 35))
const refreshLabel = computed(() => lateRefreshMode.value ? '30 秒冲刺刷新' : '2 分钟刷新')
const firstHalfIncomplete = computed(() => firstHalfMatches.value.filter((match) => {
  if (!match.markets) return true
  return match.markets.asian.current.line === null || match.markets.total.current.line === null || match.markets.halfTotal.current.line === null
}).length)
const updatedTime = computed(() => fetchedAt.value
  ? new Date(fetchedAt.value).toLocaleTimeString('zh-CN', { hour12: false })
  : '尚未更新')
const isStructureRoute = computed(() => routePath.value.replace(/\/+$/, '') === '/goal-structure')
function navigate(path: string) {
  if (window.location.pathname !== path) window.history.pushState({}, '', path)
  routePath.value = path
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
function handlePopState() { routePath.value = window.location.pathname }
function schedule() {
  window.clearTimeout(timer)
  if (!autoRefresh.value) return
  timer = window.setTimeout(() => { void load().finally(schedule) }, lateRefreshMode.value ? 30_000 : 2 * 60_000)
}
watch(autoRefresh, schedule); onMounted(() => { window.addEventListener('popstate', handlePopState); void load().finally(schedule) }); onBeforeUnmount(() => { window.removeEventListener('popstate', handlePopState); window.clearTimeout(timer) })
</script>

<template>
  <header class="topbar"><div class="brand"><span class="brand-ball"><i></i></span></div><nav><a href="/" :class="{ active: !isStructureRoute }" @click.prevent="navigate('/')">实时雷达</a><a href="/goal-structure" :class="{ active: isStructureRoute }" @click.prevent="navigate('/goal-structure')">20分钟有球查询</a><a href="https://live.titan007.com/" target="_blank" rel="noreferrer">数据源 ↗</a></nav></header>
  <main v-if="!isStructureRoute">
    <section id="radar" class="radar-heading"><div><span>LIVE RADAR</span><h2>半场有球雷达</h2></div><p>实时跟踪正在进行的比赛，并对上半场剩余时间进行动态判断。</p></section>

    <section class="toolbar">
      <div class="segmented"><button :class="{ active: scope === 'first' }" @click="scope = 'first'">上半场</button><button :class="{ active: scope === 'all' }" @click="scope = 'all'">全部进行中</button></div>
      <input v-model="query" type="search" placeholder="搜索联赛或球队" aria-label="搜索联赛或球队">
      <label>最低概率 <select v-model.number="threshold"><option :value="0">全部</option><option :value="45">45%</option><option :value="58">58%</option><option :value="70">70%</option></select></label>
      <label class="toggle"><input v-model="autoRefresh" type="checkbox"><span></span>{{ refreshLabel }}</label>
      <button class="refresh" :disabled="loading" @click="load">{{ loading ? '读取中…' : '立即刷新' }}</button>
    </section>
    <div class="meta"><span><i></i>{{ loading ? '正在同步 Titan' : `显示 ${filtered.length} 场` }}</span><time v-if="fetchedAt">更新于 {{ new Date(fetchedAt).toLocaleTimeString('zh-CN') }}</time></div>
    <section class="data-scope" aria-label="数据范围说明">
      <strong>数据范围说明</strong>
      <ol>
        <li><b>上半场筛选</b><span>显示正在进行的上半场，并把中场比赛保留到下半场开始用于核对末段进球；当前进行中 {{ firstHalfMatches.length }} 场，中场确认 {{ halfTimeMatches.length }} 场。</span></li>
        <li><b>实时变化</b><span>本次更新于 {{ updatedTime }}；35′后自动进入30秒冲刺刷新，减少补时进球回写遗漏；比赛进入中场后数量减少。</span></li>
        <li><b>盘口完整性</b><span>盘口不足、无法计算概率的比赛不展示。当前上半场有 {{ firstHalfIncomplete }} 场的源站盘口不完整；部分盘口可用时比赛仍会显示，未发布的字段显示“—”。</span></li>
      </ol>
    </section>
    <div v-if="error" class="notice error"><b>暂时无法读取</b><span>{{ error }}</span><button @click="load">重试</button></div>
    <div v-else-if="!loading && !filtered.length" class="empty"><b>当前筛选下没有比赛</b><span>可切换到“全部进行中”或降低概率门槛。</span></div>
    <section v-else><MatchTable :matches="filtered" /></section>
    <details class="method"><summary>模型如何判断半场是否还有球？</summary><div><p>基础概率先将半场与全场大小盘水位换算为去除庄家利润后的概率，再以盘口球数估计上半场期望进球，并按剩余时间进行泊松折减。计算窗口包含常规45分钟和预计4分钟补时；上半场只要已经出现进球，无论进球时间和当前进球数，都会继续计算剩余时间“再进至少一球”的概率。</p><p>额外逐项复核252、253、半场追球和“降盘升水”特征；中高水暂按香港盘≥0.90，“10分钟左右”按6–14分钟。最近20场统计的是该队比赛半场总比分大于0的场次。</p><p>规则徽标：绿色为条件全部命中，黄色为关键字段缺失，灰色为不符合。压力值等Titan未提供的数据不会用其他盘口代替，也不会默认命中。这些是经验规则验证，不代表必然结果。</p></div></details>
  </main>
  <GoalStructureQuery v-else :matches="matches" :loading="loading" :fetched-at="fetchedAt" />
  <footer><span>Titan007 公开即时数据</span><span>仅供数据研究，不构成投注建议</span></footer>
</template>
