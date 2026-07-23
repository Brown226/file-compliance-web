<template>
  <div class="accuracy-dashboard-container">
    <!-- Header -->
    <div class="header">
      <div class="header-left">
        <h2>审查质量看板</h2>
        <span class="header-sub">precision / recall / 误报分布</span>
      </div>
      <div class="header-right">
        <el-button-group class="granularity-group">
          <el-button
            v-for="g in (['daily', 'weekly'] as const)"
            :key="g"
            :type="granularity === g ? 'primary' : 'default'"
            size="small"
            @click="handleGranularityChange(g)"
          >{{ g === 'daily' ? '按天' : '按周' }}</el-button>
        </el-button-group>
        <el-button-group class="time-range-group">
          <el-button
            v-for="d in [7, 30, 90]"
            :key="d"
            :type="days === d ? 'primary' : 'default'"
            size="small"
            @click="handleDaysChange(d)"
          >{{ d }}天</el-button>
        </el-button-group>
        <el-button link :loading="loading" @click="loadData">刷新</el-button>
      </div>
    </div>

    <!-- KPI 卡片 -->
    <div class="kpi-grid" v-loading="loading">
      <div class="kpi-card kpi-precision">
        <div class="kpi-body">
          <div class="kpi-info">
            <div class="kpi-label">精确率 Precision</div>
            <div class="kpi-value value-precision">
              {{ metrics ? (metrics.precision.precision * 100).toFixed(1) : '—' }}<span class="unit">%</span>
            </div>
            <div class="kpi-hint">useful / (useful + false_positive)</div>
          </div>
          <div class="kpi-icon-wrap"><div class="kpi-icon-inner precision-icon-bg"><el-icon :size="22"><Aim /></el-icon></div></div>
        </div>
      </div>
      <div class="kpi-card kpi-useful">
        <div class="kpi-body">
          <div class="kpi-info">
            <div class="kpi-label">有用标记</div>
            <div class="kpi-value value-useful">{{ metrics?.precision.usefulCount ?? '—' }}</div>
            <div class="kpi-hint">用户认可的问题数</div>
          </div>
          <div class="kpi-icon-wrap"><div class="kpi-icon-inner useful-icon-bg"><el-icon :size="22"><CircleCheck /></el-icon></div></div>
        </div>
      </div>
      <div class="kpi-card kpi-fp">
        <div class="kpi-body">
          <div class="kpi-info">
            <div class="kpi-label">误报标记</div>
            <div class="kpi-value value-fp">{{ metrics?.precision.falsePositiveCount ?? '—' }}</div>
            <div class="kpi-hint">用户标记为误报</div>
          </div>
          <div class="kpi-icon-wrap"><div class="kpi-icon-inner fp-icon-bg"><el-icon :size="22"><WarningFilled /></el-icon></div></div>
        </div>
      </div>
      <div class="kpi-card kpi-missed">
        <div class="kpi-body">
          <div class="kpi-info">
            <div class="kpi-label">漏报标记</div>
            <div class="kpi-value value-missed">{{ metrics?.precision.missedCount ?? '—' }}</div>
            <div class="kpi-hint">用户发现的遗漏</div>
          </div>
          <div class="kpi-icon-wrap"><div class="kpi-icon-inner missed-icon-bg"><el-icon :size="22"><Warning /></el-icon></div></div>
        </div>
      </div>
      <div class="kpi-card kpi-rate">
        <div class="kpi-body">
          <div class="kpi-info">
            <div class="kpi-label">反馈率</div>
            <div class="kpi-value value-rate">
              {{ metrics ? (metrics.precision.feedbackRate * 100).toFixed(1) : '—' }}<span class="unit">%</span>
            </div>
            <div class="kpi-hint">反馈数 / 总问题数 ({{ metrics?.precision.totalIssues ?? '—' }})</div>
          </div>
          <div class="kpi-icon-wrap"><div class="kpi-icon-inner rate-icon-bg"><el-icon :size="22"><DataAnalysis /></el-icon></div></div>
        </div>
      </div>
    </div>

    <!-- 图表区 -->
    <el-row :gutter="20" class="chart-row">
      <el-col :span="16">
        <el-card shadow="hover" class="chart-card">
          <template #header>
            <div class="card-header">精确率趋势（{{ granularity === 'daily' ? '按天' : '按周' }}，近 {{ days }} 天）</div>
          </template>
          <div ref="trendChartRef" class="chart-box" v-loading="loading"></div>
          <div v-if="!loading && metrics?.trend.length === 0" class="empty-hint">暂无反馈数据</div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover" class="chart-card">
          <template #header>
            <div class="card-header">Top 误报规则分布</div>
          </template>
          <div ref="topRulesChartRef" class="chart-box" v-loading="loading"></div>
          <div v-if="!loading && metrics?.topFalsePositiveRules.length === 0" class="empty-hint">暂无误报数据</div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import * as echarts from 'echarts'
import { Aim, CircleCheck, WarningFilled, Warning, DataAnalysis } from '@element-plus/icons-vue'
import { getReviewMetricsApi, type ReviewMetricsResult } from '@/api/dashboard'
import { useIssueHelpers } from '@/views/TaskDetails/composables'

const { getIssueTypeLabel } = useIssueHelpers()

const loading = ref(false)
const granularity = ref<'daily' | 'weekly'>('daily')
const days = ref(30)
const metrics = ref<ReviewMetricsResult | null>(null)

const trendChartRef = ref<HTMLElement | null>(null)
const topRulesChartRef = ref<HTMLElement | null>(null)
let trendChart: echarts.ECharts | null = null
let topRulesChart: echarts.ECharts | null = null

async function loadData() {
  loading.value = true
  try {
    const res: any = await getReviewMetricsApi({ granularity: granularity.value, days: days.value })
    metrics.value = res?.data ?? res
    await nextTick()
    renderCharts()
  } catch (e) {
    console.error('[AccuracyDashboard] load failed', e)
  } finally {
    loading.value = false
  }
}

function renderTrendChart() {
  if (!trendChartRef.value || !metrics.value) return
  if (!trendChart) trendChart = echarts.init(trendChartRef.value)
  const trend = metrics.value.trend
  trendChart.setOption({
    tooltip: { trigger: 'axis', formatter: (p: any) => {
      const point = trend[p[0].dataIndex]
      if (!point) return ''
      const pct = (point.precision * 100).toFixed(1)
      return `${point.date}<br/>精确率: ${pct}%<br/>反馈数: ${point.feedbackCount}`
    }},
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', data: trend.map(t => t.date), axisLabel: { rotate: 30, fontSize: 11 } },
    yAxis: [
      { type: 'value', name: '精确率', min: 0, max: 1, axisLabel: { formatter: (v: number) => (v * 100).toFixed(0) + '%' } },
    ],
    series: [{
      name: '精确率',
      type: 'line',
      smooth: true,
      data: trend.map(t => t.precision),
      itemStyle: { color: '#3B82F6' },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: 'rgba(59,130,246,0.25)' },
        { offset: 1, color: 'rgba(59,130,246,0.02)' },
      ]) },
      lineStyle: { width: 2 },
    }],
  })
}

function renderTopRulesChart() {
  if (!topRulesChartRef.value || !metrics.value) return
  if (!topRulesChart) topRulesChart = echarts.init(topRulesChartRef.value)
  const rules = metrics.value.topFalsePositiveRules
  topRulesChart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (p: any) => {
      const label = getIssueTypeLabelSafe(p[0].name)
      return `${label}<br/>误报数: ${p[0].value}`
    }},
    grid: { left: '3%', right: '8%', bottom: '3%', top: '5%', containLabel: true },
    xAxis: { type: 'value', axisLabel: { fontSize: 11 } },
    yAxis: {
      type: 'category',
      data: rules.map(r => r.issueType),
      axisLabel: { formatter: (v: string) => getIssueTypeLabelSafe(v), fontSize: 11 },
      inverse: true,
    },
    series: [{
      type: 'bar',
      data: rules.map(r => r.count),
      itemStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
          { offset: 0, color: '#F59E0B' },
          { offset: 1, color: '#EF4444' },
        ]),
        borderRadius: [0, 4, 4, 0],
      },
      barMaxWidth: 22,
    }],
  })
}

function getIssueTypeLabelSafe(type: string): string {
  try {
    return getIssueTypeLabel(type as any) || type
  } catch {
    return type
  }
}

function renderCharts() {
  renderTrendChart()
  renderTopRulesChart()
}

function handleResize() {
  trendChart?.resize()
  topRulesChart?.resize()
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

watch(() => metrics.value, () => nextTick(renderCharts), { deep: true })

onMounted(() => {
  loadData()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  trendChart?.dispose()
  topRulesChart?.dispose()
  trendChart = null
  topRulesChart = null
})
</script>

<style scoped>
.accuracy-dashboard-container {
  padding: 16px 20px;
  background: #F5F7FA;
  min-height: calc(100vh - 60px);
}

/* Header */
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}
.header-left h2 { margin: 0; font-size: 20px; color: #111827; }
.header-sub { font-size: 12px; color: #6B7280; margin-left: 8px; }
.header-right { display: flex; align-items: center; gap: 12px; }

/* KPI 卡片 */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 14px;
  margin-bottom: 16px;
}
.kpi-card {
  background: #fff;
  border-radius: 10px;
  padding: 16px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  display: flex;
  align-items: center;
}
.kpi-body { display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 10px; }
.kpi-label { font-size: 13px; color: #6B7280; margin-bottom: 4px; }
.kpi-value { font-size: 26px; font-weight: 700; color: #111827; line-height: 1.2; }
.kpi-value .unit { font-size: 14px; font-weight: 600; margin-left: 2px; }
.kpi-hint { font-size: 11px; color: #9CA3AF; margin-top: 4px; }
.value-precision { color: #3B82F6; }
.value-useful { color: #10B981; }
.value-fp { color: #F59E0B; }
.value-missed { color: #EF4444; }
.value-rate { color: #8B5CF6; }
.kpi-icon-wrap { flex-shrink: 0; }
.kpi-icon-inner {
  width: 42px; height: 42px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
}
.precision-icon-bg { background: #DBEAFE; color: #2563EB; }
.useful-icon-bg { background: #D1FAE5; color: #059669; }
.fp-icon-bg { background: #FEF3C7; color: #D97706; }
.missed-icon-bg { background: #FEE2E2; color: #DC2626; }
.rate-icon-bg { background: #EDE9FE; color: #7C3AED; }

/* 图表 */
.chart-row { margin-bottom: 16px; }
.chart-card { border-radius: 10px; }
.card-header { font-size: 14px; font-weight: 600; color: #374151; }
.chart-box { height: 340px; width: 100%; }
.empty-hint {
  text-align: center;
  color: #9CA3AF;
  font-size: 13px;
  padding: 40px 0;
}

/* 响应式 */
@media (max-width: 1200px) {
  .kpi-grid { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 768px) {
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
  .chart-row .el-col { span: 24; }
}
</style>
