<template>
  <div class="workspace-container">
    <!-- 欢迎区域 - 渐变背景 -->
    <div class="welcome-section">
      <div class="welcome-left">
        <h1 class="welcome-title">{{ greetingText }}，{{ userName }} 👋</h1>
        <p class="welcome-date">{{ currentDate }}</p>
        <p class="welcome-desc">以下是您的任务概览和最近活动</p>
      </div>
      <div class="welcome-right">
        <el-button type="primary" size="large" @click="$router.push('/review')">
          <el-icon><Plus /></el-icon> 新建审查
        </el-button>
        <el-button size="large" @click="$router.push('/tasks')">
          <el-icon><Document /></el-icon> 查看报告
        </el-button>
        <el-button size="large" @click="$router.push('/admin/standards')">
          <el-icon><Collection /></el-icon> 标准库
        </el-button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-grid">
      <div
        v-for="(stat, index) in statList"
        :key="index"
        class="stat-card"
        :class="`stat-${stat.theme}`"
      >
        <div class="stat-body">
          <div class="stat-info">
            <div class="stat-value" :class="`value-${stat.theme}`">{{ stat.value }}</div>
            <div class="stat-label">{{ stat.label }}</div>
          </div>
          <div class="stat-icon-wrap">
            <div class="stat-icon-bg" :class="`${stat.theme}-bg`">
              <el-icon :size="20"><component :is="stat.icon" /></el-icon>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 2/3 + 1/3 布局 -->
    <div class="workspace-content">
      <!-- 左侧：最近任务 (2/3) -->
      <div class="recent-section">
        <div class="recent-header">
          <span class="recent-title">最近审查任务</span>
          <el-button type="primary" link @click="$router.push('/tasks')">查看全部 ></el-button>
        </div>

        <el-card shadow="never" class="recent-table-card">
          <el-table :data="recentTasks" style="width: 100%" v-loading="loading" empty-text=" ">
            <el-table-column prop="title" label="任务名称" min-width="200" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="task-name">{{ row.title }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="120">
              <template #default="{ row }">
                <el-tag :type="getStatusType(row.status)" effect="light" size="small">
                  {{ getStatusLabel(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="create_time" label="创建时间" width="175">
              <template #default="{ row }">
                <span class="time-cell">{{ formatTime(row.create_time) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" fixed="right">
              <template #default="{ row }">
                <el-button type="primary" link size="small" @click="$router.push(`/review/${row.id}`)">
                  详情
                </el-button>
              </template>
            </el-table-column>

            <template #empty>
              <div class="table-empty">
                <svg viewBox="0 0 100 80" fill="none" class="empty-svg-sm">
                  <rect x="10" y="8" width="80" height="58" rx="6" stroke="var(--color-gray-200)" stroke-width="2" fill="var(--color-gray-50)"/>
                  <path d="M24 28H76M24 38H66M24 48H50" stroke="var(--color-gray-300)" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                <p>暂无任务记录</p>
                <el-button type="primary" link @click="$router.push('/review')">创建第一个审查</el-button>
              </div>
            </template>
          </el-table>
        </el-card>
      </div>

      <!-- 右侧：快捷入口 (1/3) -->
      <div class="sidebar-section">
        <div class="sidebar-card">
          <h3 class="sidebar-title">快捷入口</h3>
          <div class="sidebar-links">
            <div class="sidebar-link-item" @click="$router.push('/admin/standards')">
              <div class="link-icon standards-icon">
                <el-icon :size="18"><Collection /></el-icon>
              </div>
              <div class="link-info">
                <span class="link-label">常用标准</span>
                <span class="link-desc">查看和管理审查标准库</span>
              </div>
            </div>
            <div class="sidebar-link-item" @click="$router.push('/admin/rules')">
              <div class="link-icon rules-icon">
                <el-icon :size="18"><List /></el-icon>
              </div>
              <div class="link-info">
                <span class="link-label">审查规则</span>
                <span class="link-desc">配置和管理审查规则</span>
              </div>
            </div>
            <div class="sidebar-link-item" @click="$router.push('/admin/system')">
              <div class="link-icon system-icon">
                <el-icon :size="18"><Setting /></el-icon>
              </div>
              <div class="link-info">
                <span class="link-label">系统配置</span>
                <span class="link-desc">LLM模型与系统参数</span>
              </div>
            </div>
            <div class="sidebar-link-item" @click="$router.push('/admin/dashboard')">
              <div class="link-icon dashboard-icon">
                <el-icon :size="18"><DataAnalysis /></el-icon>
              </div>
              <div class="link-info">
                <span class="link-label">数据看板</span>
                <span class="link-desc">审查统计与趋势分析</span>
              </div>
            </div>
          </div>
        </div>

        <div class="sidebar-card">
          <h3 class="sidebar-title">帮助支持</h3>
          <div class="sidebar-links">
            <div class="sidebar-link-item" @click="$router.push('/qna')">
              <div class="link-icon qna-icon">
                <el-icon :size="18"><ChatLineSquare /></el-icon>
              </div>
              <div class="link-info">
                <span class="link-label">AI问答</span>
                <span class="link-desc">智能问答与知识检索</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useUserStore } from '@/stores/user'
import { getTasksApi } from '@/api/task'
import { getDashboardStatsApi } from '@/api/dashboard'
import { Clock, Loading, CircleCheck, CircleClose, Plus, Document, Collection, List, Setting, DataAnalysis, ChatLineSquare } from '@element-plus/icons-vue'
import { useFormatTime } from '@/composables/useFormatTime'
import { useStatusHelpers } from '@/composables/useStatusHelpers'

const { formatTime } = useFormatTime()
const { getTaskStatusLabel: getStatusLabel, getTaskStatusType: getStatusType } = useStatusHelpers()

const userStore = useUserStore()
const loading = ref(false)
const recentTasks = ref<any[]>([])

const stats = reactive({
  pending: 0,
  processing: 0,
  completed: 0,
  failed: 0,
})

// 用户名
const userName = computed(() => userStore.userInfo?.nick_name || userStore.userInfo?.username || '用户')

// 问候语
const greetingText = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了，注意休息'
  if (h < 9) return '早上好'
  if (h < 12) return '上午好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  if (h < 22) return '晚上好'
  return '夜深了'
})

// 当前日期
const currentDate = computed(() => {
  const now = new Date()
  const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const d = now.getDate()
  const w = weekDays[now.getDay()]
  return `${y}年${m}月${d}日 ${w}`
})

// 统计列表（驱动模板）
const statList = computed(() => [
  {
    label: '待处理',
    value: stats.pending,
    icon: Clock,
    theme: 'primary' as const,
  },
  {
    label: '审查中',
    value: stats.processing,
    icon: Loading,
    theme: 'warning' as const,
  },
  {
    label: '已完成',
    value: stats.completed,
    icon: CircleCheck,
    theme: 'success' as const,
  },
  {
    label: '失败',
    value: stats.failed,
    icon: CircleClose,
    theme: 'danger' as const,
  },
])

// getStatusType, getStatusLabel, formatTime 已由 composables 提供

const fetchMyTasks = async () => {
  loading.value = true
  try {
    // 获取最近5条任务
    const { data } = await getTasksApi({ page: 1, limit: 5 })
    recentTasks.value = data.items || []
    // 使用 Dashboard 统计 API 获取个人统计
    const statsRes = await getDashboardStatsApi({ role: 'user', userId: userStore.userInfo?.id }) as any
    const byStatus = statsRes.data?.myTasks?.by_status || {}
    stats.pending = byStatus.PENDING || 0
    stats.processing = byStatus.PROCESSING || 0
    stats.completed = byStatus.COMPLETED || 0
    stats.failed = byStatus.FAILED || 0
  } catch (e) {
    console.error('获取我的任务失败:', e)
    ElMessage.error('获取任务数据失败，请刷新重试')
  } finally {
    loading.value = false
  }
}

onMounted(() => { fetchMyTasks() })
</script>

<style scoped>
.workspace-container {
  padding: 0;
  max-width: var(--corp-max-width);
  margin: 0 auto;
}

/* ===== 欢迎区域 - 渐变背景 ===== */
.welcome-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding: 28px 32px;
  min-height: 140px;
  background: linear-gradient(135deg, #1E3A5F 0%, #2D5F8A 40%, #3B82F6 100%);
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(30, 58, 95, 0.25);
  color: #FFFFFF;
}

.welcome-left { flex: 1; }

.welcome-title {
  font-size: 24px;
  font-weight: 700;
  color: #FFFFFF;
  margin: 0 0 6px 0;
  line-height: 1.3;
}

.welcome-date {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.75);
  margin: 0 0 4px 0;
}

.welcome-desc {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  margin: 0;
}

.welcome-right {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

.welcome-right .el-button {
  border-radius: 8px;
  font-weight: 600;
}

/* ===== 统计卡片 ===== */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.stat-card {
  background: #FFFFFF;
  border-radius: var(--radius-md);
  padding: 14px 16px;
  transition: box-shadow 0.15s ease;
  cursor: default;
  box-shadow: var(--border-inset), 0 1px 2px rgba(0, 0, 0, 0.04);
}

.stat-card:hover {
  box-shadow: var(--border-inset), 0 4px 12px rgba(0, 0, 0, 0.06);
}

.stat-body {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat-info { flex: 1; min-width: 0; }

.stat-value {
  font-size: 22px;
  font-weight: 850;
  line-height: 1.2;
  letter-spacing: -0.02em;
  margin-bottom: 2px;
}

.value-primary { color: #3B82F6; }
.value-warning { color: #F59E0B; }
.value-success { color: #10B981; }
.value-danger  { color: #EF4444; }

.stat-label {
  font-size: 11px;
  color: #666666;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.stat-icon-wrap { flex-shrink: 0; margin-left: 12px; }

.stat-icon-bg {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
}

.primary-bg { background: #EFF6FF; color: #3B82F6; }
.warning-bg { background: #FEF3C7; color: #F59E0B; }
.success-bg { background: #DCFCE7; color: #10B981; }
.danger-bg  { background: #FEE2E2; color: #EF4444; }

/* ===== 2/3 + 1/3 布局 ===== */
.workspace-content {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 20px;
  align-items: start;
}

/* ===== 最近任务区域 ===== */
.recent-section { background: transparent; }

.recent-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  padding: 0 2px;
}

.recent-title {
  font-size: var(--text-lg);
  font-weight: 800;
  color: #111827;
}

.recent-table-card.recent-table-card {
  border-radius: var(--radius-md);
  box-shadow: var(--border-inset), 0 1px 2px rgba(0, 0, 0, 0.04);
}

.recent-table-card :deep(.el-card__body) { padding: 0; }

.task-name {
  font-weight: 600;
  color: #111827;
  font-size: var(--text-sm);
}

.time-cell {
  color: #6B7280;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

.table-empty {
  text-align: center;
  padding: 32px 0 24px;
}

.empty-svg-sm {
  width: 80px;
  height: 64px;
  margin-bottom: 8px;
  opacity: 0.5;
}

.table-empty p {
  color: #6B7280;
  font-size: var(--text-sm);
  margin: 0 0 8px;
}

/* ===== 侧边栏快捷入口 ===== */
.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sidebar-card {
  background: #FFFFFF;
  border-radius: var(--radius-md);
  padding: 18px 20px;
  box-shadow: var(--border-inset), 0 1px 2px rgba(0, 0, 0, 0.04);
}

.sidebar-title {
  font-size: 15px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 14px 0;
  padding-bottom: 10px;
  border-bottom: 1px solid #F0F0F0;
}

.sidebar-links {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-link-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.sidebar-link-item:hover {
  background: #F5F7FA;
}

.link-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.standards-icon { background: #EFF6FF; color: #3B82F6; }
.rules-icon    { background: #FEF3C7; color: #F59E0B; }
.system-icon   { background: #F3E8FF; color: #8B5CF6; }
.dashboard-icon{ background: #DCFCE7; color: #10B981; }
.qna-icon      { background: #FEE2E2; color: #EF4444; }

.link-info {
  flex: 1;
  min-width: 0;
}

.link-label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #1F2937;
  margin-bottom: 2px;
}

.link-desc {
  display: block;
  font-size: 12px;
  color: #9CA3AF;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 900px) {
  .workspace-content {
    grid-template-columns: 1fr;
  }
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
  .welcome-section {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    padding: 20px 24px;
  }
  .welcome-right {
    flex-wrap: wrap;
  }
}

@media (max-width: 600px) {
  .welcome-section { padding: 16px 18px; }
  .welcome-title { font-size: 20px; }
  .stats-grid { grid-template-columns: 1fr; }
}
</style>
