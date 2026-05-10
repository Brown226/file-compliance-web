<template>
  <div class="workspace-container">
    <!-- 欢迎区域 -->
    <div class="welcome-section">
      <div class="welcome-left">
        <h1 class="welcome-title">{{ greetingText }}，{{ userName }}</h1>
        <p class="welcome-desc">以下是您的任务概览和最近活动</p>
      </div>
      <div class="welcome-right">
        <el-button type="primary" @click="$router.push('/review')">
          <el-icon><Plus /></el-icon> 新建审查
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

    <!-- 最近任务 -->
    <div class="recent-section">
      <div class="recent-header">
        <span class="recent-title">最近审查任务</span>
        <el-button type="primary" link @click="$router.push('/tasks')">查看全部 ></el-button>
      </div>

      <el-card shadow="never" class="recent-table-card">
        <el-table :data="recentTasks" style="width: 100%" v-loading="loading" empty-text=" ">
          <el-table-column prop="title" label="任务名称" min-width="220" show-overflow-tooltip>
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
          <el-table-column label="操作" width="100" fixed="right">
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useUserStore } from '@/stores/user'
import { getTasksApi } from '@/api/task'
import { getDashboardStatsApi } from '@/api/dashboard'
import { Clock, Loading, CircleCheck, CircleClose, Plus } from '@element-plus/icons-vue'
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
}

/* ===== 欢迎区域 ===== */
.welcome-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding: 16px 20px;
  background: #FFFFFF;
  border-radius: var(--radius-md);
  box-shadow: var(--border-inset), 0 1px 2px rgba(0, 0, 0, 0.04);
}

.welcome-left { flex: 1; }

.welcome-title {
  font-size: var(--text-xl);
  font-weight: 850;
  color: #111827;
  margin: 0 0 2px 0;
  line-height: 1.3;
}

.welcome-desc {
  font-size: var(--text-sm);
  color: #6B7280;
  margin: 0;
}

.welcome-right {
  flex-shrink: 0;
  padding-top: 2px;
}

/* ===== 统计卡片 — Inset Shadow 风格 ===== */
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

@media (max-width: 900px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 600px) {
  .welcome-section { flex-direction: column; gap: 10px; }
  .stats-grid { grid-template-columns: 1fr; }
}
</style>
