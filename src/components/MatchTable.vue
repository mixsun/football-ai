<script setup lang="ts">
import { computed } from 'vue'
import { analyzeHalfGoal } from '../lib/analysis'
import type { LiveMatch, Market, Triple } from '../types'

const props = defineProps<{ matches: LiveMatch[] }>()
const rows = computed(() => props.matches.map((match, index) => ({ match, index: index + 1, analysis: analyzeHalfGoal(match) })))
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
const ruleTitle = (row: typeof rows.value[number]) => row.analysis.rules.map((rule) => `${rule.label}［${{ match: '命中', miss: '不符合', unknown: '待验证' }[rule.status]}］\n${rule.details.join('\n')}`).join('\n\n')
</script>

<template>
  <div class="table-shell">
    <table class="match-table">
      <thead>
        <tr class="group-head">
          <th rowspan="2">序</th><th rowspan="2">赛事</th><th rowspan="2">比赛时间</th><th rowspan="2">状态</th>
          <th rowspan="2">主队</th><th rowspan="2">比分</th><th rowspan="2">客队</th><th rowspan="2">进球时间</th>
          <th rowspan="2">半场判断</th><th rowspan="2">类似盘数</th><th colspan="3">欧赔</th><th colspan="3">亚盘</th><th colspan="3">半场剩余估值</th>
        </tr>
        <tr><th>主胜</th><th>和局</th><th>客胜</th><th>主水</th><th>让球</th><th>客水</th><th>大</th><th>半场</th><th>小</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.match.id" :class="`row-${row.analysis.level}`">
          <td class="index">{{ row.index }}</td>
          <td><span class="league-tag">{{ row.match.league }}</span></td>
          <td class="date-cell">{{ time(row.match) }}</td>
          <td><span class="state-pill">{{ state(row.match) }} {{ row.match.minute ?? '—' }}′</span></td>
          <td class="team home">{{ row.match.home }}</td>
          <td class="score-cell">{{ row.match.homeScore }}-{{ row.match.awayScore }}<small v-if="row.analysis.level === 'done'">有球</small></td>
          <td class="team">{{ row.match.away }}</td>
          <td class="goals"><div class="goal-track"><i v-for="goal in row.match.goalMinutes.filter(m => m <= 45)" :key="goal" :style="{ left: `${Math.min(100, goal / 45 * 100)}%` }">●</i><b>H</b></div><small>{{ row.match.goalMinutes.filter(m => m <= 45).map(m => `${m}′`).join('、') || '暂无' }}</small></td>
          <td class="verdict" :class="{ 'over-sixty': row.analysis.probability !== null && row.analysis.probability > 60, 'next-goal': row.analysis.label.startsWith('下一球') }" :title="ruleTitle(row)">
            <div class="probability-value"><strong>{{ row.analysis.probability === null ? '—' : `${row.analysis.probability}%` }}</strong><em v-if="row.analysis.label.startsWith('下一球')" class="next-goal-mark">下一球</em><em v-if="row.analysis.probability !== null && row.analysis.probability > 60" class="probability-mark">60%+</em></div><span>{{ row.analysis.label }}</span>
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
    <div class="table-legend"><span>每格：上行为初值，下行为即时值；悬停“半场判断”查看252/253及判断依据</span><span><b class="legend-next">下一球</b>续判　<b class="legend-sixty">60%+</b>重点　<i class="done"></i>已达成　<i class="high"></i>规则命中　<i class="watch"></i>待验证</span></div>
  </div>
</template>
