<script setup lang="ts">
import { computed } from 'vue'
import { buildLiveGoalStructure } from '../lib/live-goal-structure'
import type { LiveMatch } from '../types'

const props = defineProps<{ match: LiveMatch }>()
defineEmits<{ close: [] }>()

const structure = computed(() => buildLiveGoalStructure(props.match))
const maxWindowProbability = computed(() => Math.max(1, ...structure.value.windows.map((item) => item.probability)))
const barWidth = (probability: number) => `${Math.max(8, Math.round(probability / maxWindowProbability.value * 100))}%`
const minuteLabel = (minute: number) => minute <= 45 ? `${minute}′` : `45+${minute - 45}′`
const windowLabel = (start: number, end: number) => `${minuteLabel(start)}–${minuteLabel(end)}`
const hotspotStyle = (side: 'home' | 'away', layer: number) => {
  const share = side === 'home' ? structure.value.homeShare : structure.value.awayShare
  const strength = Math.max(.28, Math.min(.92, share / 100 + (structure.value.probability ?? 0) / 220))
  const positions = side === 'home'
    ? [{ left: '70%', top: '46%' }, { left: '82%', top: '28%' }, { left: '84%', top: '68%' }]
    : [{ left: '30%', top: '54%' }, { left: '18%', top: '70%' }, { left: '16%', top: '30%' }]
  const position = positions[layer] ?? positions[0]
  return { ...position, opacity: String(Math.max(.18, strength - layer * .12)), transform: `translate(-50%,-50%) scale(${.72 + strength * .55 - layer * .08})` }
}
</script>

<template>
  <div class="goal-modal-backdrop" @click="$emit('close')">
    <article class="goal-structure-modal" role="dialog" aria-modal="true" :aria-label="`${match.home}对${match.away}上半场进球结构分析`" @click.stop>
      <header class="goal-modal-heading">
        <div><span>{{ match.league }} · 上 {{ match.minute ?? '—' }}′</span><h3>{{ match.home }} <b>{{ match.homeScore }}-{{ match.awayScore }}</b> {{ match.away }}</h3><p>上半场进球结构分析 · 未来进球发生点</p></div>
        <button type="button" aria-label="关闭进球结构分析" @click="$emit('close')">×</button>
      </header>

      <section class="goal-summary-grid">
        <div><span>剩余进球机会</span><strong>{{ structure.probability == null ? '—' : `${structure.probability}%` }}</strong><small>模型估值 · 非确定结果</small></div>
        <div><span>比赛节奏</span><strong>{{ structure.tempoLabel }}</strong><small>{{ structure.scoreShape }}</small></div>
        <div><span>下一球方向</span><strong>{{ structure.favoredText }}</strong><small>{{ match.home }} {{ structure.homeShare }}% · {{ match.away }} {{ structure.awayShare }}%</small></div>
        <div><span>信心等级</span><strong>{{ structure.confidence }}</strong><small>基于盘口、比分、分钟与历史半场样本</small></div>
      </section>

      <section class="team-pressure-panel" aria-label="两队进攻压力值">
        <div class="pressure-team pressure-home">
          <div class="pressure-gauge" :style="{ '--pressure': `${structure.homePressure}%` }"><span>⚡</span><strong>{{ structure.homePressure }}</strong><small>/100</small></div>
          <div><b>{{ match.home }}</b><span>主队进攻压力</span><small>方向权重 {{ structure.homeShare }}%</small></div>
        </div>
        <div class="pressure-compare">
          <span>进攻压力值</span><b>{{ Math.abs(structure.homePressure - structure.awayPressure) }}</b><small>两队差值</small>
        </div>
        <div class="pressure-team pressure-away">
          <div><b>{{ match.away }}</b><span>客队进攻压力</span><small>方向权重 {{ structure.awayShare }}%</small></div>
          <div class="pressure-gauge" :style="{ '--pressure': `${structure.awayPressure}%` }"><span>⚡</span><strong>{{ structure.awayPressure }}</strong><small>/100</small></div>
        </div>
        <p>压力值为独立的 0–100 模型指数，综合剩余进球概率、方向权重、比分与剩余时间；不是射门次数，也不是进球概率。</p>
      </section>

      <section class="goal-structure-section">
        <header><div><b>上半场进球结构</b><small>事实与模型信号分开呈现</small></div><em>数据截止 {{ match.minute ?? '—' }}′</em></header>
        <div class="structure-facts">
          <p v-for="fact in structure.knownFacts" :key="fact"><i></i>{{ fact }}</p>
        </div>
      </section>

      <section class="goal-structure-section future-section">
        <header><div><b>未来进球发生点</b><small>下一个进球落入各时间窗的无条件概率</small></div><em v-if="structure.peakWindow">峰值 {{ structure.peakWindow.start }}′–{{ structure.peakWindow.end }}′</em></header>
        <div v-if="structure.windows.length" class="future-window-list">
          <div v-for="window in structure.windows" :key="window.start" :class="`window-${window.intensity}`">
            <span>{{ windowLabel(window.start, window.end) }}</span><i><b :style="{ width: barWidth(window.probability) }" /></i><strong>{{ window.probability }}%</strong>
          </div>
        </div>
        <p v-else class="projection-empty">当前数据不足，或上半场常规时间已经结束。</p>
      </section>

      <section class="goal-structure-section heatmap-section">
        <header><div><b>预测压力热力图</b><small>主队由左向右进攻 · 客队由右向左进攻</small></div><em>模型推演</em></header>
        <div class="pitch-heatmap" :class="`favored-${structure.favoredSide}`">
          <div class="pitch-lines"><i class="halfway"></i><i class="center-circle"></i><i class="home-box"></i><i class="away-box"></i><i class="home-goal"></i><i class="away-goal"></i></div>
          <span v-for="layer in [0,1,2]" :key="`home-${layer}`" class="heat-spot heat-home" :style="hotspotStyle('home', layer)" />
          <span v-for="layer in [0,1,2]" :key="`away-${layer}`" class="heat-spot heat-away" :style="hotspotStyle('away', layer)" />
          <span class="heat-spot heat-transition" :style="{ opacity: structure.favoredSide === 'balanced' ? '.72' : '.4' }" />
          <div class="pitch-team pitch-home"><b>{{ match.home }}</b><small>{{ structure.homeShare }}%</small></div>
          <div class="pitch-team pitch-away"><b>{{ match.away }}</b><small>{{ structure.awayShare }}%</small></div>
        </div>
        <div class="heat-legend"><span><i class="home"></i>主队压力</span><span><i class="away"></i>客队压力</span><span><i class="mix"></i>转换区</span></div>
      </section>

      <footer class="goal-modal-notes">
        <b>数据边界</b><span v-for="item in structure.limitations" :key="item">{{ item }}</span>
      </footer>
    </article>
  </div>
</template>
