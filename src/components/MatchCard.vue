<script setup lang="ts">
import { computed } from 'vue'
import type { LiveMatch, Market, Triple } from '../types'
import { analyzeHalfGoal } from '../lib/analysis'
const props = defineProps<{ match: LiveMatch }>()
const analysis = computed(() => analyzeHalfGoal(props.match))
const stateLabel = computed(() => ({ 1: '上半场', 2: '中场', 3: '下半场', 4: '加时' }[props.match.state] ?? '进行中'))
const n = (v: number | null) => v === null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(2)
const current = (market?: Market): Triple => market?.current ?? { left: null, line: null, right: null }
const movement = (market?: Market) => {
  if (!market || market.opening.line === null || market.current.line === null) return '—'
  return market.current.line > market.opening.line ? '升盘' : market.current.line < market.opening.line ? '降盘' : '盘不变'
}
</script>

<template>
  <article class="match-card" :class="`is-${analysis.level}`">
    <div class="card-top">
      <div>
        <div class="league"><span class="live-dot"></span>{{ match.league }} · {{ stateLabel }} {{ match.minute !== null ? `${match.minute}′` : '' }}</div>
        <div class="fixture"><strong>{{ match.home }}</strong><span class="score">{{ match.homeScore }}<i>:</i>{{ match.awayScore }}</span><strong>{{ match.away }}</strong></div>
      </div>
      <div class="probability" :style="{ '--p': `${analysis.probability ?? 0}%` }">
        <b>{{ analysis.probability === null ? '—' : `${analysis.probability}%` }}</b><small>{{ analysis.label }}</small>
      </div>
    </div>
    <p class="reason">{{ analysis.reason }}</p>
    <ul v-if="analysis.signals.length" class="signals"><li v-for="signal in analysis.signals" :key="signal">{{ signal }}</li></ul>
    <div class="market-grid" v-if="match.markets">
      <div><span>欧赔 主/和/客</span><b>{{ n(current(match.markets.europe).left) }} / {{ n(current(match.markets.europe).line) }} / {{ n(current(match.markets.europe).right) }}</b></div>
      <div><span>全场亚盘</span><b>{{ n(current(match.markets.asian).left) }} · {{ n(current(match.markets.asian).line) }} · {{ n(current(match.markets.asian).right) }}</b><em>{{ movement(match.markets.asian) }}</em></div>
      <div><span>全场大小</span><b>{{ n(current(match.markets.total).left) }} · {{ n(current(match.markets.total).line) }} · {{ n(current(match.markets.total).right) }}</b><em>{{ movement(match.markets.total) }}</em></div>
      <div><span>半场亚盘</span><b>{{ n(current(match.markets.halfAsian).left) }} · {{ n(current(match.markets.halfAsian).line) }} · {{ n(current(match.markets.halfAsian).right) }}</b><em>{{ movement(match.markets.halfAsian) }}</em></div>
      <div class="highlight"><span>半场剩余估值 大/盘/小</span><b>{{ n(current(match.markets.halfTotal).left) }} · {{ n(current(match.markets.halfTotal).line) }} · {{ n(current(match.markets.halfTotal).right) }}</b><em>{{ movement(match.markets.halfTotal) }}</em></div>
      <div><span>上半场进球</span><b>{{ match.goalMinutes.filter(m => m <= 45).map(m => `${m}′`).join('、') || '暂无' }}</b></div>
    </div>
  </article>
</template>
