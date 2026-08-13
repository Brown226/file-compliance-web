<template>
  <div class="platform-tab" v-loading="loading">
    <!-- 在线用户轨道 -->
    <div class="rail-panel">
      <div class="rail-header">
        <span class="rail-title">
          <span class="online-pulse"></span>
          实时在线用户
        </span>
        <div class="rail-meta">
          <span>当前在线 <strong>{{ onlineData?.onlineCount ?? 0 }}</strong> 人</span>
          <span>今日登录 <strong>{{ onlineData?.todayLoginCount ?? 0 }}</strong> 人</span>
          <button class="icon-refresh" :class="{ spinning: loadingOnline }" @click="loadOnlineUsers" title="刷新">
            <el-icon><Refresh /></el-icon>
          </button>
        </div>
      </div>
      <div class="users-rail">
        <div v-if="onlineData && onlineData.users.length > 0" class="users-track">
          <div v-for="u in onlineData.users" :key="u.id" class="user-chip">
            <el-avatar :size="32" class="user-avatar">{{ u.name.charAt(0) }}</el-avatar>
            <div class="user-chip-info">
              <span class="user-name">{{ u.name }}</span>
              <span class="user-meta">{{ getRoleLabel(u.role) }}</span>
            </div>
            <span class="online-dot"></span>
          </div>
        </div>
        <div v-else class="rail-empty">暂无在线用户</div>
      </div>
    </div>

    <!-- 活跃度 + LLM 两列 -->
    <div class="metrics-grid">
      <!-- 活跃度 -->
      <div class="metric-panel">
        <div class="panel-header">
          <span class="panel-title">平台活跃度趋势</span>
          <div class="control-group">
            <button
              v-for="d in [7, 30, 90]"
              :key="d"
              class="ctrl-btn"
              :class="{ active: activityDays === d }"
              @click="changeActivityDays(d)"
            >{{ d }}天</button>
          </div>
        </div>
        <div v-if="activityData" class="mini-metrics">
          <div class="mini-metric">
            <div class="mini-value">{{ activityData.metrics.dau }}</div>
            <div class="mini-label">今日活跃 DAU</div>
          </div>
          <div class="mini-metric">
            <div class="mini-value">{{ activityData.metrics.wau }}</div>
            <div class="mini-label">周活跃 WAU</div>
          </div>
          <div class="mini-metric">
            <div class="mini-value">{{ activityData.metrics.avgDau }}</div>
            <div class="mini-label">区间日均 DAU</div>
          </div>
          <div class="mini-metric">
            <div class="mini-value">{{ activityData.metrics.totalTasks }}</div>
            <div class="mini-label">区间任务总数</div>
          </div>
          <div class="mini-metric">
            <div class="mini-value">{{ activityData.metrics.avgTasksPerUser }}</div>
            <div class="mini-label">人均任务数</div>
          </div>
        </div>
        <div ref="activityChartRef" class="chart-box"></div>
        <div v-if="!loadingActivity && activityData?.trend.length === 0" class="empty-state">
          <div class="empty-line"></div>
          <p>暂无活跃度数据</p>
        </div>
      </div>

      <!-- LLM Token -->
      <div class="metric-panel">
        <div class="panel-header">
          <span class="panel-title">LLM Token 使用量</span>
          <div class="control-group">
            <button
              v-for="d in [7, 30, 90]"
              :key="d"
              class="ctrl-btn"
              :class="{ active: llmDays === d }"
              @click="changeLlmDays(d)"
            >{{ d }}天</button>
          </div>
        </div>
        <div v-if="llmData" class="mini-metrics">
          <div class="mini-metric">
            <div class="mini-value">{{ formatTokenCount(llmData.summary.totalTokens) }}</div>
            <div class="mini-label">总 Token 用量</div>
          </div>
          <div class="mini-metric">
            <div class="mini-value">{{ llmData.summary.totalCalls }}</div>
            <div class="mini-label">调用次数</div>
          </div>
          <div class="mini-metric">
            <div class="mini-value">{{ llmData.summary.successRate }}%</div>
            <div class="mini-label">成功率</div>
          </div>
          <div class="mini-metric">
            <div class="mini-value">{{ formatTokenCount(llmData.summary.avgLatencyMs) }}<span class="mini-unit">ms</span></div>
            <div class="mini-label">平均延迟</div>
          </div>
        </div>
        <div ref="llmChartRef" class="chart-box" style="height: 260px;"></div>
        <div v-if="!loadingLlm && llmData?.byDay.length === 0" class="empty-state">
          <div class="empty-line"></div>
          <p>暂无 LLM 调用数据</p>
        </div>
      </div>
    </div>

    <!-- 部门使用排名 -->
    <div class="dept-panel">
      <div class="panel-header">
        <span class="panel-title">各部门使用程度</span>
        <button class="icon-refresh" :class="{ spinning: loadingDept }" @click="loadDepartmentStats" title="刷新">
          <el-icon><Refresh /></el-icon>
        </button>
      </div>
      <div v-if="deptData && deptData.departments.length > 0" class="dept-ranking">
        <div
          v-for="(dept, idx) in deptData.departments"
          :key="dept.name"
          class="dept-row"
        >
          <span class="dept-rank">{{ idx + 1 }}</span>
          <span class="dept-name">{{ dept.name }}</span>
          <div class="dept-bars">
            <div class="dept-bar-group">
              <span class="bar-label">任务</span>
              <div class="dept-bar-wrap">
                <div class="dept-bar task" :style="{ width: `${(dept.taskCount / maxDeptTaskCount) * 100}%` }"></div>
              </div>
              <span class="bar-value">{{ dept.taskCount }}</span>
            </div>
            <div class="dept-bar-group">
              <span class="bar-label">用户</span>
              <div class="dept-bar-wrap">
                <div class="dept-bar user" :style="{ width: `${(dept.userCount / maxDeptUserCount) * 100}%` }"></div>
              </div>
              <span class="bar-value">{{ dept.userCount }}</span>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="empty-state">
        <div class="empty-line"></div>
        <p>暂无部门数据</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, computed } from 'vue'
import * as echarts from 'echarts'
import { Refresh } from '@element-plus/icons-vue'
import {
  getOnlineUsersApi,
  getActivityApi,
  getLlmUsageApi,
  getDepartmentStatsApi,
  type OnlineUsersResult,
  type ActivityResult,
  type LlmUsageResult,
  type DepartmentStatsResult,
} from '@/api/dashboard-extended'

const loading = ref(false)

// 在线用户
const loadingOnline = ref(false)
const onlineData = ref<OnlineUsersResult | null>(null)

async function loadOnlineUsers() {
  loadingOnline.value = true
  try {
    const res: any = await getOnlineUsersApi()
    onlineData.value = res?.data ?? res
  } catch (e) {
    console.error('[PlatformTab] loadOnlineUsers failed', e)
  } finally {
    loadingOnline.value = false
  }
}

let onlineRefreshTimer: number | null = null

// 活跃度
const loadingActivity = ref(false)
const activityDays = ref(30)
const activityData = ref<ActivityResult | null>(null)
const activityChartRef = ref<HTMLElement | null>(null)
let activityChart: echarts.ECharts | null = null

async function loadActivity() {
  loadingActivity.value = true
  try {
    const res: any = await getActivityApi(activityDays.value)
    activityData.value = res?.data ?? res
    await nextTick()
    renderActivityChart()
  } catch (e) {
    console.error('[PlatformTab] loadActivity failed', e)
  } finally {
    loadingActivity.value = false
  }
}

function changeActivityDays(d: number) {
  if (activityDays.value === d) return
  activityDays.value = d
  loadActivity()
}

function renderActivityChart() {
  if (!activityChartRef.value || !activityData.value) return
  if (!activityChart) activityChart = echarts.init(activityChartRef.value)
  const trend = activityData.value.trend

  if (trend.length === 0) {
    activityChart.clear()
    return
  }

  activityChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['活跃用户', '任务提交数'], top: 0, right: 0, textStyle: { color: '#6B7280' /* 对齐 --color-gray-500 */ } },
    grid: { left: '2%', right: '3%', bottom: '4%', top: '14%', containLabel: true },
    xAxis: {
      type: 'category',
      data: trend.map((t) => t.date),
      axisLine: { lineStyle: { color: '#E5E7EB' /* 对齐 --corp-border-light */ } },
      axisLabel: { color: '#6B7280', fontSize: 11 } /* 对齐 --color-gray-500 */,
      axisTick: { show: false },
    },
    yAxis: [
      { type: 'value', name: '活跃用户', position: 'left', splitLine: { lineStyle: { color: '#F5F5F5' /* 对齐 --color-gray-100 */ } }, axisLabel: { color: '#6B7280' /* 对齐 --color-gray-500 */ } },
      { type: 'value', name: '任务数', position: 'right', splitLine: { show: false }, axisLabel: { color: '#6B7280' /* 对齐 --color-gray-500 */ } },
    ],
    series: [
      {
        name: '活跃用户',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        data: trend.map((t) => t.activeUsers),
        itemStyle: { color: '#2563EB' /* 对齐 --color-primary-600 */ },
        lineStyle: { width: 2 },
        areaStyle: { color: 'rgba(37,99,235,0.12)' },
      },
      {
        name: '任务提交数',
        type: 'bar',
        yAxisIndex: 1,
        data: trend.map((t) => t.taskCount),
        itemStyle: { color: '#9CA3AF' /* 对齐 --color-gray-400 */, borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 18,
      },
    ],
  }, true)
}

// LLM
const loadingLlm = ref(false)
const llmDays = ref(30)
const llmData = ref<LlmUsageResult | null>(null)
const llmChartRef = ref<HTMLElement | null>(null)
let llmChart: echarts.ECharts | null = null

async function loadLlmUsage() {
  loadingLlm.value = true
  try {
    const res: any = await getLlmUsageApi(llmDays.value)
    llmData.value = res?.data ?? res
    await nextTick()
    renderLlmChart()
  } catch (e) {
    console.error('[PlatformTab] loadLlmUsage failed', e)
  } finally {
    loadingLlm.value = false
  }
}

function changeLlmDays(d: number) {
  if (llmDays.value === d) return
  llmDays.value = d
  loadLlmUsage()
}

function renderLlmChart() {
  if (!llmChartRef.value || !llmData.value) return
  if (!llmChart) llmChart = echarts.init(llmChartRef.value)
  const byDay = llmData.value.byDay

  if (byDay.length === 0) {
    llmChart.clear()
    return
  }

  llmChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['输入 Tokens', '输出 Tokens'], top: 0, right: 0, textStyle: { color: '#6B7280' /* 对齐 --color-gray-500 */ } },
    grid: { left: '2%', right: '3%', bottom: '4%', top: '14%', containLabel: true },
    xAxis: {
      type: 'category',
      data: byDay.map((d) => d.date),
      axisLine: { lineStyle: { color: '#E5E7EB' /* 对齐 --corp-border-light */ } },
      axisLabel: { color: '#6B7280', fontSize: 11 } /* 对齐 --color-gray-500 */,
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      name: 'Token 数',
      splitLine: { lineStyle: { color: '#F5F5F5' /* 对齐 --color-gray-100 */ } },
      axisLabel: { color: '#6B7280' /* 对齐 --color-gray-500 */, formatter: (v: number) => formatTokenCount(v) },
    },
    series: [
      {
        name: '输入 Tokens',
        type: 'bar',
        stack: 'tokens',
        data: byDay.map((d) => d.promptTokens),
        itemStyle: { color: '#2563EB' /* 对齐 --color-primary-600 */ },
        barMaxWidth: 20,
      },
      {
        name: '输出 Tokens',
        type: 'bar',
        stack: 'tokens',
        data: byDay.map((d) => d.completionTokens),
        itemStyle: { color: '#9CA3AF' /* 对齐 --color-gray-400 */ },
        barMaxWidth: 20,
      },
    ],
  }, true)
}

// 部门
const loadingDept = ref(false)
const deptData = ref<DepartmentStatsResult | null>(null)

const maxDeptTaskCount = computed(() => {
  if (!deptData.value || deptData.value.departments.length === 0) return 1
  return Math.max(...deptData.value.departments.map((d) => d.taskCount))
})

const maxDeptUserCount = computed(() => {
  if (!deptData.value || deptData.value.departments.length === 0) return 1
  return Math.max(...deptData.value.departments.map((d) => d.userCount))
})

async function loadDepartmentStats() {
  loadingDept.value = true
  try {
    const res: any = await getDepartmentStatsApi()
    deptData.value = res?.data ?? res
  } catch (e) {
    console.error('[PlatformTab] loadDepartmentStats failed', e)
  } finally {
    loadingDept.value = false
  }
}

// 工具函数
function getRoleLabel(role: string): string {
  const m: Record<string, string> = { ADMIN: '管理员', MANAGER: '部门经理', USER: '普通用户' }
  return m[role] || role
}

function formatTokenCount(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

function handleResize() {
  activityChart?.resize()
  llmChart?.resize()
}

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([loadOnlineUsers(), loadActivity(), loadLlmUsage(), loadDepartmentStats()])
  } finally {
    loading.value = false
  }
  onlineRefreshTimer = window.setInterval(loadOnlineUsers, 30000)
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  if (onlineRefreshTimer) {
    clearInterval(onlineRefreshTimer)
    onlineRefreshTimer = null
  }
  window.removeEventListener('resize', handleResize)
  activityChart?.dispose()
  llmChart?.dispose()
  activityChart = null
  llmChart = null
})
</script>

<style scoped>
.platform-tab {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 通用面板 */
.rail-panel,
.metric-panel,
.dept-panel {
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: 10px;
  padding: 18px;
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

.control-group {
  display: inline-flex;
  background: var(--corp-bg-sunken);
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
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--corp-text-secondary);
  background: transparent;
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

/* 在线用户轨道 */
.rail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.rail-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.online-pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-success);
  box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
  70% { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
  100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
}

.rail-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
  color: var(--corp-text-secondary);
}

.rail-meta strong {
  color: var(--corp-text-primary);
  font-weight: 600;
}

.users-rail {
  min-height: 60px;
}

.users-track {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.user-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 6px;
  background: var(--corp-bg-sunken);
  border: 1px solid var(--corp-border-light);
  border-radius: 999px;
  transition: all 0.2s ease;
}

.user-chip:hover {
  border-color: var(--color-primary-200);
  background: var(--color-primary-50);
}

.user-avatar {
  background: var(--color-primary-600);
  color: var(--corp-text-inverse);
  font-weight: 600;
  flex-shrink: 0;
}

.user-chip-info {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.user-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.user-meta {
  font-size: 12px;
  color: var(--corp-text-secondary);
}

.online-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-success);
  flex-shrink: 0;
}

.rail-empty {
  color: var(--corp-text-tertiary);
  font-size: 13px;
  padding: 18px 0;
  text-align: center;
}

/* 指标网格 */
.metrics-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.mini-metrics {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
  margin-bottom: 14px;
}

.metric-panel:nth-child(2) .mini-metrics {
  grid-template-columns: repeat(4, 1fr);
}

.mini-metric {
  padding: 10px;
  background: var(--corp-bg-sunken);
  border-radius: 8px;
  text-align: center;
}

.mini-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--corp-text-primary);
  line-height: 1.2;
}

.mini-unit {
  font-size: 12px;
  font-weight: 500;
  color: var(--corp-text-tertiary);
  margin-left: 2px;
}

.mini-label {
  font-size: 12px;
  color: var(--corp-text-secondary);
  margin-top: 4px;
}

.chart-box {
  height: 240px;
  width: 100%;
}

/* 部门排名 */
.dept-ranking {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px 40px;
}

.dept-row {
  display: grid;
  grid-template-columns: 20px 120px 1fr;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-gray-100);
}

.dept-rank {
  font-size: 12px;
  font-weight: 700;
  color: var(--corp-text-tertiary);
  text-align: center;
}

.dept-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-gray-700);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dept-bars {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dept-bar-group {
  display: grid;
  grid-template-columns: 28px 1fr 36px;
  align-items: center;
  gap: 8px;
}

.bar-label {
  font-size: 12px;
  color: var(--corp-text-tertiary);
}

.dept-bar-wrap {
  height: 6px;
  background: var(--color-gray-100);
  border-radius: 3px;
  overflow: hidden;
}

.dept-bar {
  height: 100%;
  border-radius: 3px;
  transition: width 0.6s ease;
}

.dept-bar.task { background: var(--color-primary-600); }
.dept-bar.user { background: var(--color-gray-400); }

.bar-value {
  font-size: 12px;
  font-weight: 600;
  color: var(--corp-text-primary);
  text-align: right;
}

/* 空状态 */
.empty-state {
  height: 200px;
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
  .metrics-grid { grid-template-columns: 1fr; }
  .mini-metrics { grid-template-columns: repeat(3, 1fr); }
  .metric-panel:nth-child(2) .mini-metrics { grid-template-columns: repeat(2, 1fr); }
  .dept-ranking { grid-template-columns: 1fr; }
}

@media (max-width: 768px) {
  .rail-meta { display: none; }
  .mini-metrics { grid-template-columns: repeat(2, 1fr); }
  .dept-row { grid-template-columns: 20px 80px 1fr; }
}
</style>
