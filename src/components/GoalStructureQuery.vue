<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { calculateGoalStructure, type TeamStructureInput, type TeamStructureMetrics } from '../lib/goal-structure-query'
import type { LiveMatch } from '../types'

const props = defineProps<{ matches: LiveMatch[]; loading: boolean; fetchedAt: string }>()
const matchId = ref(0)
const minute = ref(30)
const baseTeam = (): TeamStructureInput => ({ shortForm: 50, longForm: 50, boxEntries: 0, boxShots: 0, shotGoals: 0, redCards: 0, penalties: 0 })
const names = reactive({ home: '主队', away: '客队' })
const teams = reactive<{ home: TeamStructureInput; away: TeamStructureInput }>({ home: baseTeam(), away: baseTeam() })
const selectedMatch = computed(() => props.matches.find((match) => match.id === matchId.value) ?? null)
const result = computed(() => calculateGoalStructure(teams.home, teams.away, minute.value))

watch([matchId, () => props.matches.length], () => {
  const match = selectedMatch.value
  if (!match) return
  names.home = match.home
  names.away = match.away
  minute.value = match.minute ?? 30
}, { immediate: true })

const ratioText = (value: number | null) => value === null ? '—' : `${value}%`
const heatColor = (value: number, side: 'home' | 'away') => side === 'home'
  ? `rgba(255, 103, 55, ${Math.max(.06, value * .78)})`
  : `rgba(49, 142, 136, ${Math.max(.06, value * .78)})`
const eventNotes = (metrics: TeamStructureMetrics) => metrics.adjustments.length ? metrics.adjustments : ['无红牌、点球修正']
</script>

<template>
  <main class="structure-query-page">
    <section class="structure-query-heading">
      <div><span>NEXT 20 MINUTES</span><h1>未来20分钟有球查询</h1><p>判断从当前分钟开始的20分钟内是否会有进球，并在红牌或点球后即时重算。</p></div>
      <div class="query-status"><i></i><span>{{ loading ? '正在同步比赛' : `实时比赛 ${matches.length} 场` }}</span><small>{{ fetchedAt ? `更新于 ${new Date(fetchedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '尚未更新' }}</small></div>
    </section>

    <section class="query-source-card">
      <label><span>选择实时比赛</span><select v-model.number="matchId"><option :value="0">手动输入球队</option><option v-for="match in matches" :key="match.id" :value="match.id">{{ match.league }} · {{ match.home }} {{ match.homeScore }}-{{ match.awayScore }} {{ match.away }}</option></select></label>
      <label><span>当前分钟</span><input v-model.number="minute" type="number" min="0" max="90"></label>
      <div><span>数据边界</span><p>Titan 自动提供球队、比分和分钟；禁区触球、射门与事件数据需按可信统计源手动补充。</p></div>
    </section>

    <section class="team-input-grid">
      <article v-for="side in ['home','away'] as const" :key="side" :class="`team-input-card team-${side}`">
        <header><div><span>{{ side === 'home' ? 'HOME' : 'AWAY' }}</span><input v-model="names[side]" :aria-label="side === 'home' ? '主队名称' : '客队名称'"></div><b>{{ side === 'home' ? '主队结构' : '客队结构' }}</b></header>
        <div class="form-state-grid">
          <label><span>短期状态 <small>近5–10场</small></span><input v-model.number="teams[side].shortForm" type="number" min="0" max="100"><em>/100</em></label>
          <label><span>长期俱乐部状态 <small>近两年基线</small></span><input v-model.number="teams[side].longForm" type="number" min="0" max="100"><em>/100</em></label>
        </div>
        <div class="action-input-grid">
          <label><span>打进大禁区</span><input v-model.number="teams[side].boxEntries" type="number" min="0" max="99"></label>
          <label><span>禁区内起脚</span><input v-model.number="teams[side].boxShots" type="number" min="0" max="99"></label>
          <label><span>射门完成得分 <small>不含点球</small></span><input v-model.number="teams[side].shotGoals" type="number" min="0" max="20"></label>
        </div>
        <div class="event-input-grid">
          <label><span>红牌</span><input v-model.number="teams[side].redCards" type="number" min="0" max="2"></label>
          <label><span>获得点球</span><input v-model.number="teams[side].penalties" type="number" min="0" max="5"></label>
          <strong v-if="teams[side].redCards || teams[side].penalties">↻ 事件已重算</strong><span v-else>无事件修正</span>
        </div>
      </article>
    </section>

    <section class="structure-result" :class="`result-${result.level}`">
      <header><div><span>STRUCTURE RESULT</span><h2>{{ names.home }} <b>vs</b> {{ names.away }}</h2></div><em v-if="result.eventAdjusted">↻ 红牌 / 点球后重算</em><small v-else>基础结构</small></header>
      <div class="result-summary-grid">
        <div class="primary-window-result"><span>未来20分钟有球</span><strong>{{ result.probability === null ? '—' : `${result.probability}%` }}</strong><small>{{ result.label }}</small></div>
        <div><span>查询窗口</span><strong>{{ result.windowStart }}′–{{ result.windowEnd }}′</strong><small>无球 {{ result.noGoalProbability === null ? '—' : `${result.noGoalProbability}%` }}</small></div>
        <div><span>主队下一球权重</span><strong>{{ result.homeShare === null ? '—' : `${result.homeShare}%` }}</strong><small>{{ names.home }}</small></div>
        <div><span>客队下一球权重</span><strong>{{ result.awayShare === null ? '—' : `${result.awayShare}%` }}</strong><small>{{ names.away }}</small></div>
        <div><span>模型信心</span><strong>{{ result.confidence }}</strong><small>按字段完整性分级</small></div>
      </div>
    </section>

    <section class="ratio-comparison">
      <header><div><span>THREE RATIOS + XGPLUS</span><h2>进球结构对比</h2></div><p>xGPlus 是本站结构指数，不等同于统计商官方 xG。</p></header>
      <div class="ratio-table">
        <div class="ratio-head"><span>指标</span><b>{{ names.home }}</b><b>{{ names.away }}</b></div>
        <div><span>禁区推进→起脚</span><strong>{{ ratioText(result.home.entryToShotRatio) }}</strong><strong>{{ ratioText(result.away.entryToShotRatio) }}</strong></div>
        <div><span>禁区起脚→进球</span><strong>{{ ratioText(result.home.shotToGoalRatio) }}</strong><strong>{{ ratioText(result.away.shotToGoalRatio) }}</strong></div>
        <div><span>禁区推进→进球</span><strong>{{ ratioText(result.home.entryToGoalRatio) }}</strong><strong>{{ ratioText(result.away.entryToGoalRatio) }}</strong></div>
        <div class="xgplus-row"><span>xGPlus <small>事件修正后</small></span><strong>{{ result.home.xgPlus.toFixed(2) }}</strong><strong>{{ result.away.xgPlus.toFixed(2) }}</strong></div>
      </div>
      <div class="event-notes"><div><b>{{ names.home }}</b><span v-for="note in eventNotes(result.home)" :key="note">{{ note }}</span></div><div><b>{{ names.away }}</b><span v-for="note in eventNotes(result.away)" :key="note">{{ note }}</span></div></div>
    </section>

    <section class="query-heatmaps">
      <header><div><span>PRESSURE HEATMAP</span><h2>禁区压力热力图</h2></div><p>颜色越深表示该区域的推进、起脚与终结密度越高。</p></header>
      <div class="heatmap-grid">
        <article v-for="side in ['home','away'] as const" :key="`heat-${side}`">
          <div><b>{{ names[side] }}</b><span>xGPlus {{ (side === 'home' ? result.home : result.away).xgPlus.toFixed(2) }}</span></div>
          <div class="query-pitch" :class="`pitch-${side}`"><i v-for="(heat, index) in (side === 'home' ? result.home : result.away).heat" :key="index" :style="{ background: heatColor(heat, side) }"></i><span class="penalty-box"></span><span class="goal-box"></span></div>
        </article>
      </div>
    </section>

    <details class="query-method" open>
      <summary>模型计算口径</summary>
      <div><p><b>基础 xGPlus：</b>禁区推进×0.025 + 禁区起脚×0.13 + 非点球射门得分×0.55，再乘以短期与长期状态系数。</p><p><b>事件重算：</b>每张本队红牌降低本队进攻结构并提高对手空间权重；每次点球加入0.76 xGPlus。事件影响只用于当前比赛，不修改球队长期能力。</p><p><b>20分钟窗口：</b>概率只计算当前分钟起未来20分钟内至少一球；若距离90分钟不足20分钟，窗口自动截断。模型使用35%保守收缩，缺少禁区行为证据时不输出概率。</p><p>状态默认值50仅表示中性占位，不代表真实球队状态；应使用同口径、带时间戳的数据替换。</p></div>
    </details>
  </main>
</template>
