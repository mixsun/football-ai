<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MatchTable from '../components/MatchTable.vue'
import { analyzeHalfGoal } from '../lib/analysis'
import type { LiveMatch, LiveResponse } from '../types'

const matches = ref<LiveMatch[]>([]); const loading = ref(true); const error = ref(''); const fetchedAt = ref('')
const scope = ref<'first' | 'all'>('first'); const query = ref(''); const threshold = ref(0); const autoRefresh = ref(false)
let timer: number | undefined; let requestInFlight = false
const compareByProbability = (a: LiveMatch, b: LiveMatch) => {
  const first = analyzeHalfGoal(a).probability; const second = analyzeHalfGoal(b).probability
  if (first === null) return second === null ? 0 : 1
  return second === null ? -1 : second - first
}
async function load() {
  if (requestInFlight) return
  requestInFlight = true; loading.value = true; error.value = ''
  try {
    const response = await fetch('/api/live', { cache: 'no-store' }); const body = await response.json() as LiveResponse & { error?: string }
    if (!response.ok) throw new Error(body.error || '数据读取失败')
    matches.value = body.matches; fetchedAt.value = body.fetchedAt
  } catch (e) { error.value = e instanceof Error ? e.message : '数据读取失败' } finally { loading.value = false; requestInFlight = false }
}
const filtered = computed(() => matches.value.filter((match) => {
  if (scope.value === 'first' && match.state !== 1 && match.state !== 2) return false
  const analysis = analyzeHalfGoal(match)
  if (analysis.label === '盘口不足') return false
  if ((analysis.probability === null && threshold.value > 0) || (analysis.probability !== null && analysis.probability < threshold.value)) return false
  const normalized = query.value.trim().toLowerCase()
  return !normalized || `${match.league} ${match.home} ${match.away}`.toLowerCase().includes(normalized)
}).sort(compareByProbability))
const firstHalfMatches = computed(() => matches.value.filter((match) => match.state === 1))
const halfTimeMatches = computed(() => matches.value.filter((match) => match.state === 2))
const lateRefreshMode = computed(() => firstHalfMatches.value.some((match) => (match.minute ?? 0) >= 35))
const refreshLabel = computed(() => lateRefreshMode.value ? '30 秒冲刺刷新' : '2 分钟刷新')
const firstHalfIncomplete = computed(() => firstHalfMatches.value.filter((match) => !match.markets || match.markets.asian.current.line === null || match.markets.total.current.line === null || match.markets.halfTotal.current.line === null).length)
const updatedTime = computed(() => fetchedAt.value ? new Date(fetchedAt.value).toLocaleTimeString('zh-CN', { hour12: false }) : '尚未更新')
function schedule() {
  window.clearTimeout(timer)
  if (autoRefresh.value) timer = window.setTimeout(() => { void load().finally(schedule) }, lateRefreshMode.value ? 30_000 : 120_000)
}
watch(autoRefresh, schedule); onMounted(() => { void load().finally(schedule) }); onBeforeUnmount(() => window.clearTimeout(timer))
</script>

<template>
  <main id="main-content">
    <section class="toolbar">
      <div class="segmented"><button :class="{ active: scope === 'first' }" @click="scope = 'first'">上半场</button><button :class="{ active: scope === 'all' }" @click="scope = 'all'">全部进行中</button></div>
      <input v-model="query" type="search" placeholder="搜索联赛或球队" aria-label="搜索联赛或球队">
      <label>最低概率 <select v-model.number="threshold"><option :value="0">全部</option><option :value="45">45%</option><option :value="58">58%</option><option :value="70">70%</option></select></label>
      <label class="toggle"><input v-model="autoRefresh" type="checkbox"><span></span>{{ refreshLabel }}</label>
      <button class="refresh" :disabled="loading" @click="load">{{ loading ? '读取中…' : '立即刷新' }}</button>
    </section>
    <div class="meta"><span><i></i>{{ loading ? '正在同步 Titan' : `显示 ${filtered.length} 场` }}</span><time v-if="fetchedAt">更新于 {{ updatedTime }}</time></div>
    <section class="data-scope" aria-label="数据范围说明"><strong>数据范围说明</strong><ol><li><b>上半场筛选</b><span>显示正在进行的上半场，并保留中场比赛核对末段进球；当前进行中 {{ firstHalfMatches.length }} 场，中场确认 {{ halfTimeMatches.length }} 场。</span></li><li><b>实时变化</b><span>本次更新于 {{ updatedTime }}；35′后自动进入30秒冲刺刷新。</span></li><li><b>盘口完整性</b><span>盘口不足的比赛不展示；当前上半场有 {{ firstHalfIncomplete }} 场源站盘口不完整。</span></li></ol></section>
    <div v-if="error" class="notice error"><b>暂时无法读取</b><span>{{ error }}</span><button @click="load">重试</button></div>
    <div v-else-if="!loading && !filtered.length" class="empty"><b>当前筛选下没有比赛</b><span>可切换到“全部进行中”或降低概率门槛。</span></div>
    <section v-else><MatchTable :matches="filtered" /></section>
    <details class="method"><summary>模型如何判断半场是否还有球？</summary><div><p>基础概率将半场与全场大小盘水位换算为去除庄家利润后的概率，再按剩余时间进行泊松折减。计算窗口包含常规45分钟和预计4分钟补时；已经进球后继续显示“下一球”概率。</p><p>额外复核252、253、半场追球和“降盘升水”特征；这些是经验规则验证，不代表必然结果。</p></div></details>
  </main>
</template>
