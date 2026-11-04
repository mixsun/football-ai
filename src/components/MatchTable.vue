<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { analyzeHalfGoal } from '../lib/analysis'
import type { LiveMatch, Market, RuleStatus, Triple } from '../types'
import GoalStructureModal from './GoalStructureModal.vue'

const props = defineProps<{ matches: LiveMatch[] }>()
const openTipId = ref<number | null>(null)
const openAnalysisId = ref<number | null>(null)
const rows = computed(() => props.matches.map((match, index) => ({ match, index: index + 1, analysis: analyzeHalfGoal(match) })))
const activeTipRow = computed(() => rows.value.find((row) => row.match.id === openTipId.value) ?? null)
const activeAnalysisRow = computed(() => rows.value.find((row) => row.match.id === openAnalysisId.value) ?? null)
const n = (value: number | null) => value === null ? '—' : Number.isInteger(value) ? String(value) : value.toFixed(2)
const market = (value: Market | undefined) => value ?? { opening: { left: null, line: null, right: null }, current: { left: null, line: null, right: null } }
const side = (m: Market | undefined, key: keyof Triple) => [n(market(m).opening[key]), n(market(m).current[key])]
const time = (match: LiveMatch) => {
  const raw = match.actualStart || match.scheduledAt
  if (!raw) return '—'
  const date = new Date(raw)
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
const state = (match: LiveMatch) => ({ 1: '上', 2: '中', 3: '下', 4: '加' }[match.state] ?? '赛')
const ruleStatus = (status: RuleStatus) => ({ match: '命中', miss: '不符合', unknown: '待验证' })[status]
const ruleTitle = (row: typeof rows.value[number]) => row.analysis.rules.map((rule) => `${rule.label}［${{ match: '命中', miss: '不符合', unknown: '待验证' }[rule.status]}］\n${rule.details.join('\n')}`).join('\n\n')
const closeTip = () => { openTipId.value = null }
const closeAnalysis = () => { openAnalysisId.value = null }
const toggleTip = (id: number) => { closeAnalysis(); openTipId.value = openTipId.value === id ? null : id }
const openMatchAnalysis = (id: number) => { closeTip(); openAnalysisId.value = id }
const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { closeTip(); closeAnalysis() } }
onMounted(() => { document.addEventListener('click', closeTip); document.addEventListener('keydown', closeOnEscape) })
onBeforeUnmount(() => { document.removeEventListener('click', closeTip); document.removeEventListener('keydown', closeOnEscape) })
</script>

<template>
  <div class="table-shell">
    <table class="match-table">
      <colgroup>
        <col class="col-index"><col class="col-league"><col class="col-time"><col class="col-state">
        <col class="col-team"><col class="col-score"><col class="col-team"><col class="col-goals">
        <col class="col-verdict"><col class="col-similar">
        <col v-for="index in 9" :key="`odds-col-${index}`" class="col-odds">
      </colgroup>
      <thead>
        <tr class="group-head">
          <th rowspan="2">序</th><th rowspan="2">赛事</th><th rowspan="2">比赛时间</th><th rowspan="2">状态</th>
          <th rowspan="2">主队</th><th rowspan="2">比分</th><th rowspan="2">客队</th><th rowspan="2">进球时间</th>
          <th rowspan="2" title="按概率从高到低排列">半场判断 ↓</th><th rowspan="2">类似盘数</th><th colspan="3">欧赔</th><th colspan="3">亚盘</th><th colspan="3">半场剩余估值</th>
        </tr>
        <tr><th>主胜</th><th>和局</th><th>客胜</th><th>主水</th><th>让球</th><th>客水</th><th>大</th><th>半场</th><th>小</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.match.id" :class="`row-${row.analysis.level}`">
          <td class="index match-entry-cell" role="button" tabindex="0" title="查看上半场进球结构分析" @click.stop="openMatchAnalysis(row.match.id)" @keydown.enter.stop="openMatchAnalysis(row.match.id)">{{ row.index }}</td>
          <td class="match-entry-cell" role="button" tabindex="0" title="查看上半场进球结构分析" @click.stop="openMatchAnalysis(row.match.id)" @keydown.enter.stop="openMatchAnalysis(row.match.id)"><span class="league-tag">{{ row.match.league }}</span></td>
          <td class="date-cell match-entry-cell" role="button" tabindex="0" title="查看上半场进球结构分析" @click.stop="openMatchAnalysis(row.match.id)" @keydown.enter.stop="openMatchAnalysis(row.match.id)">{{ time(row.match) }}</td>
          <td class="match-entry-cell" role="button" tabindex="0" title="查看上半场进球结构分析" @click.stop="openMatchAnalysis(row.match.id)" @keydown.enter.stop="openMatchAnalysis(row.match.id)"><span class="state-pill">{{ state(row.match) }} {{ row.match.minute ?? '—' }}′</span></td>
          <td class="team home match-entry-cell" role="button" tabindex="0" title="查看上半场进球结构分析" @click.stop="openMatchAnalysis(row.match.id)" @keydown.enter.stop="openMatchAnalysis(row.match.id)">{{ row.match.home }}</td>
          <td class="score-cell match-entry-cell" role="button" tabindex="0" title="查看上半场进球结构分析" @click.stop="openMatchAnalysis(row.match.id)" @keydown.enter.stop="openMatchAnalysis(row.match.id)">{{ row.match.homeScore }}-{{ row.match.awayScore }}<small v-if="row.analysis.level === 'done'">有球</small></td>
          <td class="team match-entry-cell" role="button" tabindex="0" title="查看上半场进球结构分析" @click.stop="openMatchAnalysis(row.match.id)" @keydown.enter.stop="openMatchAnalysis(row.match.id)">{{ row.match.away }}</td>
          <td class="goals match-entry-cell" role="button" tabindex="0" title="查看上半场进球结构分析" @click.stop="openMatchAnalysis(row.match.id)" @keydown.enter.stop="openMatchAnalysis(row.match.id)"><div class="goal-track"><i v-for="goal in row.match.goalMinutes.filter(m => m <= 45)" :key="goal" :style="{ left: `${Math.min(100, goal / 45 * 100)}%` }">●</i><b>H</b></div><small>{{ row.match.goalMinutes.filter(m => m <= 45).map(m => `${m}′`).join('、') || '暂无' }}</small></td>
          <td class="verdict" :class="{ 'over-sixty': row.analysis.probability !== null && row.analysis.probability > 60, 'next-goal': row.analysis.label.startsWith('下一球') }">
            <div class="probability-value"><strong>{{ row.analysis.probability === null ? '—' : `${row.analysis.probability}%` }}</strong><em v-if="row.analysis.label.startsWith('下一球')" class="next-goal-mark">下一球</em><em v-if="row.analysis.probability !== null && row.analysis.probability > 60" class="probability-mark" title="重点：模型概率超过 60%">⚡ 60%+</em><button class="tip-trigger" type="button" :aria-expanded="openTipId === row.match.id" :aria-label="`查看${row.match.home}对${row.match.away}的判断依据：${ruleTitle(row)}`" @click.stop="toggleTip(row.match.id)">i</button></div><span>{{ row.analysis.label }}</span>
            <div class="rule-badges"><em v-for="rule in row.analysis.rules" :key="rule.code" :class="`rule-${rule.status}`">{{ rule.code }}</em></div>
            <small v-if="row.match.halfGoalHistory?.home.sample">近20场 {{ row.match.halfGoalHistory.home.withGoal }}/{{ row.match.halfGoalHistory.home.sample }}</small>
            <small v-else>历史无样本</small>
          </td>
          <td>{{ row.match.sameMarketCount }}</td>
          <td v-for="key in (['left','line','right'] as const)" :key="`eu-${key}`" class="odds"><span>{{ side(row.match.markets?.europe, key)[0] }}</span><b>{{ side(row.match.markets?.europe, key)[1] }}</b></td>
          <td v-for="key in (['left','line','right'] as const)" :key="`ah-${key}`" class="odds"><span>{{ side(row.match.markets?.asian, key)[0] }}</span><b>{{ side(row.match.markets?.asian, key)[1] }}</b></td>
          <td v-for="key in (['left','line','right'] as const)" :key="`ht-${key}`" class="odds total"><span>{{ side(row.match.markets?.halfTotal, key)[0] }}</span><b>{{ side(row.match.markets?.halfTotal, key)[1] }}</b></td>
        </tr>
      </tbody>
    </table>
    <div class="table-legend"><span>每格：上行为初值，下行为即时值；点击判断旁的 i 查看252/253及判断依据</span><span><b class="legend-next">下一球</b>进球后续判　<b class="legend-sixty">⚡ 60%+</b>重点　<i class="high"></i>规则命中　<i class="watch"></i>待验证</span></div>
  </div>
  <Teleport to="body">
    <GoalStructureModal v-if="activeAnalysisRow" :match="activeAnalysisRow.match" @close="closeAnalysis" />
    <div v-if="activeTipRow" class="tip-modal-backdrop" @click="closeTip">
      <div class="tip-modal" role="dialog" aria-modal="true" :aria-label="`${activeTipRow.match.home}对${activeTipRow.match.away}判断 TIPS`" @click.stop>
        <div class="tip-heading"><div><b>判断 TIPS</b><span>{{ activeTipRow.match.home }} {{ activeTipRow.match.homeScore }}-{{ activeTipRow.match.awayScore }} {{ activeTipRow.match.away }}</span></div><button class="tip-close" type="button" aria-label="关闭判断 TIPS" @click="closeTip">×</button></div>
        <section v-for="rule in activeTipRow.analysis.rules" :key="`modal-${rule.code}`">
          <div><strong>{{ rule.label }}</strong><em :class="`tip-${rule.status}`">{{ ruleStatus(rule.status) }}</em></div>
          <span v-for="detail in rule.details" :key="detail" class="tip-detail">{{ detail }}</span>
        </section>
      </div>
    </div>
  </Teleport>
</template>
