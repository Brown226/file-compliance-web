<template>
  <div class="quality-tab">
    <!-- Header -->
    <div class="page-header">
      <div class="header-title">
        <h1>审查质量</h1>
        <span class="header-sub">精确率 / 召回率 / 误报分布</span>
      </div>
      <div class="header-controls">
        <div class="control-group">
          <button
            v-for="g in (['daily', 'weekly'] as const)"
            :key="g"
            class="ctrl-btn"
            :class="{ active: granularity === g }"
            @click="handleGranularityChange(g)"
          >{{ g === 'daily' ? '按天' : '按周' }}</button>
        </div>
        <div class="control-group">
          <button
            v-for="d in [7, 30, 90]"
            :key="d"
            class="ctrl-btn"
            :class="{ active: days === d }"
            @click="handleDaysChange(d)"
          >{{ d }}天</button>
        </div>
        <button class="icon-refresh" :class="{ spinning: loading }" @click="loadData" title="刷新">
          <el-icon><Refresh /></el-icon>
        </button>
      </div>
    </div>

    <!-- KPI 数据墙 -->
    <div class="kpi-wall" v-loading="loading">
      <div
        v-for="item in kpiItems"
        :key="item.key"
        class="kpi-cell"
        :class="`kpi-${item.key }`"
      >
        <div class="kpi-label">{{ item.label }}</div>
        <div class="kpi-value">
          {{ item.value }}<span v-if="item.unit" class="unit">{{ item.unit }}</span>
        </div>
        <div class="kpi-hint">{{ item.hint }}</div>
      </div>
    </div>

    <!-- 图表区 -->
    <div class="chart-grid">
      <div class="chart-panel trend-panel">
        <div class="panel-header">
          <span class="panel-title">精确率趋势</span>
          <span class="panel-meta">{{ granularity === 'daily' ? '按天' : '按周' }} · 近 {{ days }} 天</span>
        </div>
        <div ref="trendChartRef" class="chart-box"></div>
        <div v-if="!loading && metrics?.trend.length === 0" class="empty-state">
          <div class="empty-line"></div>
          <p>暂无反馈数据</p>
        </div>
      </div>

      <div class="chart-panel rules-panel">
        <div class="panel-header">
          <span class="panel-title">Top 误报规则</span>
        </div>
        <div v-if="!loading && metrics && metrics.topFalsePositiveRules.length > 0" class="rules-ranking">
          <div
            v-for="(rule, idx) in metrics.topFalsePositiveRules"
            :key="rule.issueType"
            class="rule-row"
          >
            <span class="rule-rank">{{ idx + 1 }}</span>
            <span class="rule-name">{{ getIssueTypeLabelSafe(rule.issueType) }}</span>
            <div class="rule-bar-wrap">
              <div class="rule-bar" :style="{ width: `${(rule.count / maxRuleCount) * 100}%` }"></div>
            </div>
            <span class="rule-count">{{ rule.count }}</span>
          </div>
        </div>
        <div v-else class="empty-state">
          <div class="empty-line"></div>
          <p>暂无误报数据</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, watch, computed } from 'vue'
import * as echarts from 'echarts'
import { Refresh } from '@element-plus/icons-vue'
import { getReviewMetricsApi, type ReviewMetricsResult } from '@/api/dashboard'
import { useIssueHelpers } from '@/views/TaskDetails/composables'

const { getIssueTypeLabel } = useIssueHelpers()

const loading = ref(false)
const granularity = ref<'daily' | 'weekly'>('daily')
const days = ref(30)
const metrics = ref<ReviewMetricsResult | null>(null)

const trendChartRef = ref<HTMLElement | null>(null)
let trendChart: echarts.ECharts | null = null

const kpiItems = computed(() => {
  const m = metrics.value
  return [
    {
      key: 'precision',
      label: '精确率',
      value: m ? (m.precision.precision * 100).toFixed(1) : '—',
      unit: '%',
      hint: '有用标记 / (有用标记 + 误报标记)',
    },
    {
      key: 'useful',
      label: '有用标记',
      value: m?.precision.usefulCount ?? '—',
      unit: '',
      hint: '用户认可的问题数',
    },
    {
      key: 'fp',
      label: '误报标记',
      value: m?.precision.falsePositiveCount ?? '—',
      unit: '',
      hint: '用户标记为误报',
    },
    {
      key: 'missed',
      label: '漏报标记',
      value: m?.precision.missedCount ?? '—',
      unit: '',
      hint: '用户发现的遗漏',
    },
    {
      key: 'rate',
      label: '反馈率',
      value: m ? (m.precision.feedbackRate * 100).toFixed(1) : '—',
      unit: '%',
      hint: `反馈数 / 总问题数 (${m?.precision.totalIssues ?? '—'})`,
    },
  ]
})

const maxRuleCount = computed(() => {
  if (!metrics.value || metrics.value.topFalsePositiveRules.length === 0) return 1
  return Math.max(...metrics.value.topFalsePositiveRules.map((r) => r.count))
})

async function loadData() {
  loading.value = true
  try {
    const res: any = await getReviewMetricsApi({ granularity: granularity.value, days: days.value })
    metrics.value = res?.data ?? res
    await nextTick()
    renderTrendChart()
  } catch (e) {
    console.error('[QualityTab] load failed', e)
  } finally {
    loading.value = false
  }
}

function renderTrendChart() {
  if (!trendChartRef.value || !metrics.value) return
  if (!trendChart) trendChart = echarts.init(trendChartRef.value)
  const trend = metrics.value.trend

  if (trend.length === 0) {
    trendChart.clear()
    return
  }

  trendChart.setOption({
    tooltip: {
      trigger: 'axis',
      formatter: (p: any) => {
        const point = trend[p[0].dataIndex]
        if (!point) return ''
        const pct = (point.precision * 100).toFixed(1)
        return `${point.date}<br/>精确率: ${pct}%<br/>反馈数: ${point.feedbackCount}`
      },
    },
    grid: { left: '2%', right: '3%', bottom: '4%', top: '10%', containLabel: true },
    xAxis: {
      type: 'category',
      data: trend.map((t) => t.date),
      axisLine: { lineStyle: { color: '#E5E7EB' /* 对齐 --corp-border-light */ } },
      axisLabel: { color: '#6B7280', fontSize: 11 } /* 对齐 --color-gray-500 */,
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 1,
      splitLine: { lineStyle: { color: '#F5F5F5' /* 对齐 --color-gray-100 */ } },
      axisLabel: { color: '#6B7280' /* 对齐 --color-gray-500 */, formatter: (v: number) => (v * 100).toFixed(0) + '%' },
    },
    series: [{
      name: '精确率',
      type: 'line',
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      data: trend.map((t) => t.precision),
      itemStyle: { color: '#2563EB' /* 对齐 --color-primary-600 */ },
      lineStyle: { width: 2.5 },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(37,99,235,0.18)' },
          { offset: 1, color: 'rgba(37,99,235,0.02)' },
        ]),
      },
    }],
  }, true)
}

function getIssueTypeLabelSafe(type: string): string {
  try {
    return getIssueTypeLabel(type as any) || type
  } catch {
    return type
  }
}

function handleResize() {
  trendChart?.resize()
}

function handleGranularityChange(g: 'daily' | 'weekly') {
  if (granularity.value === g) return
  granularity.value = g
  loadData()
}

function handleDaysChange(d: number) {
  if (days.value === d) return
  days.value = d
  loadData()
}

watch(() => metrics.value, () => nextTick(renderTrendChart), { deep: true })

onMounted(() => {
  loadData()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  trendChart?.dispose()
  trendChart = null
})
</script>

<style scoped>
.quality-tab {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Header */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 16px;
}

.header-title h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--corp-text-primary);
  letter-spacing: -0.3px;
}

.header-sub {
  font-size: 12px;
  color: var(--corp-text-tertiary);
  margin-left: 8px;
  font-weight: 400;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.control-group {
  display: inline-flex;
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: 6px;
  padding: 2px;
}

.ctrl-btn {
  padding: 5px 12px;
  font-size: 13px;
  color: var(--corp-text-secondary);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.ctrl-btn:hover {
  color: var(--corp-text-primary);
}

.ctrl-btn.active {
  color: var(--color-primary-600);
  background: var(--color-primary-50);
  font-weight: 500;
}

.icon-refresh {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--corp-text-secondary);
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.icon-refresh:hover {
  color: var(--color-primary-600);
  border-color: var(--color-primary-200);
}

.icon-refresh.spinning :deep(.el-icon) {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* KPI 数据墙 */
.kpi-wall {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: 10px;
  overflow: hidden;
}

.kpi-cell {
  padding: 22px 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}

.kpi-cell:not(:last-child)::after {
  content: '';
  position: absolute;
  right: 0;
  top: 18%;
  bottom: 18%;
  width: 1px;
  background: var(--color-gray-100);
}

.kpi-label {
  font-size: 12px;
  color: var(--corp-text-secondary);
  font-weight: 500;
}

.kpi-value {
  font-size: 30px;
  font-weight: 700;
  color: var(--corp-text-primary);
  line-height: 1.1;
  letter-spacing: -0.5px;
}

.kpi-value .unit {
  font-size: 14px;
  font-weight: 600;
  margin-left: 3px;
  color: var(--corp-text-tertiary);
}

.kpi-hint {
  font-size: 12px;
  color: var(--corp-text-tertiary);
  margin-top: 2px;
}

.kpi-precision .kpi-value { color: var(--color-primary-600); }

/* 图表区 */
.chart-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 20px;
}

.chart-panel {
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: 10px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  min-height: 420px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.panel-meta {
  font-size: 12px;
  color: var(--corp-text-tertiary);
}

.chart-box {
  flex: 1;
  min-height: 0;
  width: 100%;
}

/* 误报规则排名 */
.rules-ranking {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 8px;
}

.rule-row {
  display: grid;
  grid-template-columns: 22px 1fr 80px 36px;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.rule-rank {
  font-size: 12px;
  font-weight: 600;
  color: var(--corp-text-tertiary);
  text-align: center;
}

.rule-name {
  color: var(--color-gray-700);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rule-bar-wrap {
  height: 6px;
  background: var(--color-gray-100);
  border-radius: 3px;
  overflow: hidden;
}

.rule-bar {
  height: 100%;
  background: var(--color-primary-600);
  border-radius: 3px;
  transition: width 0.6s ease;
}

.rule-count {
  text-align: right;
  font-weight: 600;
  color: var(--corp-text-primary);
}

/* 空状态 */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--corp-text-tertiary);
  font-size: 13px;
}

.empty-line {
  width: 120px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--color-gray-300), transparent);
}

/* 响应式 */
@media (max-width: 1200px) {
  .kpi-wall { grid-template-columns: repeat(3, 1fr); }
  .kpi-cell:nth-child(3)::after { display: none; }
  .chart-grid { grid-template-columns: 1fr; }
}

@media (max-width: 768px) {
  .kpi-wall { grid-template-columns: repeat(2, 1fr); }
  .kpi-cell::after { display: none; }
}
</style>
