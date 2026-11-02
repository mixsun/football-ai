<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MatchTable from './components/MatchTable.vue'
import { analyzeHalfGoal } from './lib/analysis'
import type { LiveMatch, LiveResponse } from './types'

const matches = ref<LiveMatch[]>([]); const loading = ref(true); const error = ref(''); const fetchedAt = ref('')
const scope = ref<'first' | 'all'>('first'); const query = ref(''); const threshold = ref(0); const autoRefresh = ref(true)
let timer: number | undefined
async function load() {
  loading.value = true; error.value = ''
  try {
    const response = await fetch('/api/live', { cache: 'no-store' }); const body = await response.json() as LiveResponse & { error?: string }
    if (!response.ok) throw new Error(body.error || '数据读取失败')
    matches.value = body.matches; fetchedAt.value = body.fetchedAt
  } catch (e) { error.value = e instanceof Error ? e.message : '数据读取失败' } finally { loading.value = false }
}
const filtered = computed(() => matches.value.filter((m) => {
  if (scope.value === 'first' && m.state !== 1) return false
  const p = analyzeHalfGoal(m).probability ?? -1
  if (p < threshold.value) return false
  const q = query.value.trim().toLowerCase()
  return !q || `${m.league} ${m.home} ${m.away}`.toLowerCase().includes(q)
}).sort((a, b) => (analyzeHalfGoal(b).probability ?? -1) - (analyzeHalfGoal(a).probability ?? -1)))
function schedule() { window.clearInterval(timer); if (autoRefresh.value) timer = window.setInterval(load, 2 * 60_000) }
watch(autoRefresh, schedule); onMounted(() => { load(); schedule() }); onBeforeUnmount(() => window.clearInterval(timer))
</script>

<template>
  <header class="topbar"><div class="brand"><span class="brand-ball">◉</span><div><b>半场有球雷达</b><small>TITAN LIVE MARKET SIGNALS</small></div></div><a href="https://live.titan007.com/" target="_blank" rel="noreferrer">数据源 ↗</a></header>
  <main>
    <section class="toolbar">
      <div class="segmented"><button :class="{ active: scope === 'first' }" @click="scope = 'first'">上半场</button><button :class="{ active: scope === 'all' }" @click="scope = 'all'">全部进行中</button></div>
      <input v-model="query" type="search" placeholder="搜索联赛或球队" aria-label="搜索联赛或球队">
      <label>最低概率 <select v-model.number="threshold"><option :value="0">全部</option><option :value="45">45%</option><option :value="58">58%</option><option :value="70">70%</option></select></label>
      <label class="toggle"><input v-model="autoRefresh" type="checkbox"><span></span>2 分钟刷新</label>
      <button class="refresh" :disabled="loading" @click="load">{{ loading ? '读取中…' : '立即刷新' }}</button>
    </section>
    <div class="meta"><span><i></i>{{ loading ? '正在同步 Titan' : `显示 ${filtered.length} 场` }}</span><time v-if="fetchedAt">更新于 {{ new Date(fetchedAt).toLocaleTimeString('zh-CN') }}</time></div>
    <div v-if="error" class="notice error"><b>暂时无法读取</b><span>{{ error }}</span><button @click="load">重试</button></div>
    <div v-else-if="!loading && !filtered.length" class="empty"><b>当前筛选下没有比赛</b><span>可切换到“全部进行中”或降低概率门槛。</span></div>
    <section v-else><MatchTable :matches="filtered" /></section>
    <details class="method"><summary>模型如何判断半场是否还有球？</summary><div><p>基础概率先将半场与全场大小盘水位换算为去除庄家利润后的概率，再以盘口球数估计上半场期望进球，并按剩余时间进行泊松折减。</p><p>额外逐项复核252、253、半场追球和“降盘升水”特征；中高水暂按香港盘≥0.90，“10分钟左右”按6–14分钟。最近20场统计的是该队比赛半场总比分大于0的场次。</p><p>规则徽标：绿色为条件全部命中，黄色为关键字段缺失，灰色为不符合。压力值等Titan未提供的数据不会用其他盘口代替，也不会默认命中。这些是经验规则验证，不代表必然结果。</p></div></details>
  </main>
  <footer><span>Titan007 公开即时数据</span><span>仅供数据研究，不构成投注建议</span></footer>
</template>
