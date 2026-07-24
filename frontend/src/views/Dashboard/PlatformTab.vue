<template>
  <div class="platform-tab" v-loading="loading">
    <!-- 区块 1：在线用户 -->
    <el-card shadow="hover" class="section-card">
      <template #header>
        <div class="card-header">
          <span class="header-title">
            <el-icon><User /></el-icon>
            实时在线用户
          </span>
          <el-tag type="success" effect="plain">当前在线 {{ onlineData?.onlineCount ?? 0 }} 人</el-tag>
          <el-tag type="primary" effect="plain">今日登录 {{ onlineData?.todayLoginCount ?? 0 }} 人</el-tag>
          <el-button link size="small" :loading="loadingOnline" @click="loadOnlineUsers">刷新</el-button>
        </div>
      </template>
      <div v-if="onlineData && onlineData.users.length > 0" class="online-users-list">
        <div v-for="u in onlineData.users" :key="u.id" class="online-user-item">
          <el-avatar :size="32" class="user-avatar">{{ u.name.charAt(0) }}</el-avatar>
          <div class="user-info">
            <span class="user-name">{{ u.name }}</span>
            <span class="user-meta">@{{ u.username }} · {{ getRoleLabel(u.role) }}</span>
          </div>
          <el-tag v-if="u.departmentName" size="small" type="info" effect="plain">{{ u.departmentName }}</el-tag>
          <span v-if="u.lastLoginAt" class="user-last-login">
            {{ formatRelativeTime(u.lastLoginAt) }}
          </span>
          <span class="online-dot"></span>
        </div>
      </div>
      <el-empty v-else description="暂无在线用户" :image-size="80" />
    </el-card>

    <!-- 区块 2：活跃度趋势 -->
    <el-card shadow="hover" class="section-card">
      <template #header>
        <div class="card-header">
          <span class="header-title">
            <el-icon><TrendCharts /></el-icon>
            平台活跃度趋势
          </span>
          <el-button-group>
            <el-button
              v-for="d in [7, 30, 90]"
              :key="d"
              :type="activityDays === d ? 'primary' : 'default'"
              size="small"
              @click="changeActivityDays(d)"
            >{{ d }}天</el-button>
          </el-button-group>
        </div>
      </template>
      <div class="activity-metrics" v-if="activityData">
        <div class="metric-pill">
          <div class="metric-value">{{ activityData.metrics.dau }}</div>
          <div class="metric-label">今日活跃 DAU</div>
        </div>
        <div class="metric-pill">
          <div class="metric-value">{{ activityData.metrics.wau }}</div>
          <div class="metric-label">周活跃 WAU</div>
        </div>
        <div class="metric-pill">
          <div class="metric-value">{{ activityData.metrics.avgDau }}</div>
          <div class="metric-label">区间日均 DAU</div>
        </div>
        <div class="metric-pill">
          <div class="metric-value">{{ activityData.metrics.totalTasks }}</div>
          <div class="metric-label">区间任务总数</div>
        </div>
        <div class="metric-pill">
          <div class="metric-value">{{ activityData.metrics.avgTasksPerUser }}</div>
          <div class="metric-label">人均任务数</div>
        </div>
      </div>
      <div ref="activityChartRef" class="chart-box"></div>
      <div v-if="!loadingActivity && activityData?.trend.length === 0" class="empty-hint">暂无活跃度数据</div>
    </el-card>

    <!-- 区块 3 & 4：LLM 用量 + 部门统计 并排 -->
    <el-row :gutter="20">
      <el-col :span="14">
        <el-card shadow="hover" class="section-card">
          <template #header>
            <div class="card-header">
              <span class="header-title">
                <el-icon><Cpu /></el-icon>
                LLM Token 使用量
              </span>
              <el-button-group>
                <el-button
                  v-for="d in [7, 30, 90]"
                  :key="d"
                  :type="llmDays === d ? 'primary' : 'default'"
                  size="small"
                  @click="changeLlmDays(d)"
                >{{ d }}天</el-button>
              </el-button-group>
            </div>
          </template>
          <div class="llm-summary" v-if="llmData">
            <div class="metric-pill">
              <div class="metric-value">{{ formatTokenCount(llmData.summary.totalTokens) }}</div>
              <div class="metric-label">总 Token 用量</div>
            </div>
            <div class="metric-pill">
              <div class="metric-value">{{ llmData.summary.totalCalls }}</div>
              <div class="metric-label">调用次数</div>
            </div>
            <div class="metric-pill">
              <div class="metric-value">{{ llmData.summary.successRate }}%</div>
              <div class="metric-label">成功率</div>
            </div>
            <div class="metric-pill">
              <div class="metric-value">{{ llmData.summary.avgLatencyMs }}ms</div>
              <div class="metric-label">平均延迟</div>
            </div>
          </div>
          <div ref="llmChartRef" class="chart-box" style="height: 280px;"></div>
          <div v-if="!loadingLlm && llmData?.byDay.length === 0" class="empty-hint">暂无 LLM 调用数据</div>
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card shadow="hover" class="section-card">
          <template #header>
            <div class="card-header">
              <span class="header-title">
                <el-icon><OfficeBuilding /></el-icon>
                各部门使用程度
              </span>
              <el-button link size="small" :loading="loadingDept" @click="loadDepartmentStats">刷新</el-button>
            </div>
          </template>
          <div ref="deptChartRef" class="chart-box" style="height: 280px;"></div>
          <div v-if="!loadingDept && deptData?.departments.length === 0" class="empty-hint">暂无部门数据</div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'
import { User, TrendCharts, Cpu, OfficeBuilding } from '@element-plus/icons-vue'
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

// ===== 通用 loading =====
const loading = ref(false)

// ===== 区块 1：在线用户 =====
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

// 在线用户列表 30 秒自动刷新
let onlineRefreshTimer: number | null = null

// ===== 区块 2：活跃度趋势 =====
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
  activityChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['活跃用户', '任务提交数'], top: 0 },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', data: trend.map(t => t.date), axisLabel: { rotate: 30, fontSize: 11 } },
    yAxis: [
      { type: 'value', name: '活跃用户', position: 'left' },
      { type: 'value', name: '任务数', position: 'right' },
    ],
    series: [
      {
        name: '活跃用户',
        type: 'line',
        smooth: true,
        data: trend.map(t => t.activeUsers),
        itemStyle: { color: '#3B82F6' },
        areaStyle: { color: 'rgba(59,130,246,0.15)' },
      },
      {
        name: '任务提交数',
        type: 'bar',
        yAxisIndex: 1,
        data: trend.map(t => t.taskCount),
        itemStyle: { color: '#10B981', borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 20,
      },
    ],
  })
}

// ===== 区块 3：LLM Token 用量 =====
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
  llmChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['输入 Tokens', '输出 Tokens'], top: 0 },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', data: byDay.map(d => d.date), axisLabel: { rotate: 30, fontSize: 11 } },
    yAxis: { type: 'value', name: 'Token 数', axisLabel: { formatter: (v: number) => formatTokenCount(v) } },
    series: [
      {
        name: '输入 Tokens',
        type: 'bar',
        stack: 'tokens',
        data: byDay.map(d => d.promptTokens),
        itemStyle: { color: '#3B82F6' },
      },
      {
        name: '输出 Tokens',
        type: 'bar',
        stack: 'tokens',
        data: byDay.map(d => d.completionTokens),
        itemStyle: { color: '#10B981' },
      },
    ],
  })
}

// ===== 区块 4：部门使用度 =====
const loadingDept = ref(false)
const deptData = ref<DepartmentStatsResult | null>(null)
const deptChartRef = ref<HTMLElement | null>(null)
let deptChart: echarts.ECharts | null = null

async function loadDepartmentStats() {
  loadingDept.value = true
  try {
    const res: any = await getDepartmentStatsApi()
    deptData.value = res?.data ?? res
    await nextTick()
    renderDeptChart()
  } catch (e) {
    console.error('[PlatformTab] loadDepartmentStats failed', e)
  } finally {
    loadingDept.value = false
  }
}

function renderDeptChart() {
  if (!deptChartRef.value || !deptData.value) return
  if (!deptChart) deptChart = echarts.init(deptChartRef.value)
  const depts = deptData.value.departments.slice(0, 10) // Top 10
  deptChart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['任务数', '用户数'], top: 0 },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'value' },
    yAxis: {
      type: 'category',
      data: depts.map(d => d.name),
      inverse: true,
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        name: '任务数',
        type: 'bar',
        data: depts.map(d => d.taskCount),
        itemStyle: { color: '#3B82F6', borderRadius: [0, 4, 4, 0] },
        barMaxWidth: 18,
      },
      {
        name: '用户数',
        type: 'bar',
        data: depts.map(d => d.userCount),
        itemStyle: { color: '#F59E0B', borderRadius: [0, 4, 4, 0] },
        barMaxWidth: 18,
      },
    ],
  })
}

// ===== 工具函数 =====
function getRoleLabel(role: string): string {
  const m: Record<string, string> = { ADMIN: '管理员', MANAGER: '部门经理', USER: '普通用户' }
  return m[role] || role
}

function formatRelativeTime(isoStr: string): string {
  const d = new Date(isoStr)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

function formatTokenCount(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

function handleResize() {
  activityChart?.resize()
  llmChart?.resize()
  deptChart?.resize()
}

// ===== 生命周期 =====
onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([loadOnlineUsers(), loadActivity(), loadLlmUsage(), loadDepartmentStats()])
  } finally {
    loading.value = false
  }
  // 在线用户列表 30 秒自动刷新
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
  deptChart?.dispose()
  activityChart = null
  llmChart = null
  deptChart = null
})
</script>

<style scoped>
.platform-tab {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-card {
  border-radius: 10px;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  font-weight: 600;
  color: #374151;
}
.header-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-right: auto;
}

/* 在线用户列表 */
.online-users-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow-y: auto;
}
.online-user-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #F9FAFB;
  transition: background 0.2s;
}
.online-user-item:hover {
  background: #F3F4F6;
}
.user-avatar {
  background: #3B82F6;
  color: white;
  font-weight: 600;
  flex-shrink: 0;
}
.user-info {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.user-name {
  font-size: 13px;
  font-weight: 600;
  color: #111827;
}
.user-meta {
  font-size: 11px;
  color: #6B7280;
}
.user-last-login {
  font-size: 11px;
  color: #9CA3AF;
}
.online-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #10B981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.5);
  flex-shrink: 0;
}

/* 指标药丸 */
.activity-metrics,
.llm-summary {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.metric-pill {
  flex: 1;
  min-width: 100px;
  background: #F9FAFB;
  border-radius: 8px;
  padding: 10px 12px;
  text-align: center;
}
.metric-value {
  font-size: 20px;
  font-weight: 700;
  color: #111827;
  line-height: 1.2;
}
.metric-label {
  font-size: 11px;
  color: #6B7280;
  margin-top: 2px;
}

.chart-box {
  height: 340px;
  width: 100%;
}
.empty-hint {
  text-align: center;
  color: #9CA3AF;
  font-size: 13px;
  padding: 40px 0;
}
</style>
