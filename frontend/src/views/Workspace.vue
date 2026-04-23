<template>
  <div class="workspace-container">
    <!-- 欢迎区域 -->
    <div class="welcome-section">
      <div class="welcome-left">
        <h1 class="welcome-title">{{ greetingText }}，{{ userName }}</h1>
        <p class="welcome-desc">以下是您的任务概览和最近活动</p>
      </div>
      <div class="welcome-right">
        <el-button type="primary" @click="$router.push('/tasks/new')">
          <el-icon><Plus /></el-icon> 新建任务
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
        <el-button type="primary" link @click="$router.push('/tasks/history')">查看全部 ></el-button>
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
              <el-button type="primary" link size="small" @click="$router.push(`/tasks/${row.id}`)">
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
              <el-button type="primary" link @click="$router.push('/tasks/new')">创建第一个任务</el-button>
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
    // 使用 Dashboard 统计 API 替代全量拉取
    const statsRes = await getDashboardStatsApi()
    stats.pending = statsRes.data.processingTasks || 0
    stats.processing = statsRes.data.processingTasks || 0
    stats.completed = statsRes.data.completedTasks || 0
    stats.failed = statsRes.data.failedTasks || 0
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
}

/* ===== 欢迎区域 ===== */
.welcome-section {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
}

.welcome-left {
  flex: 1;
}

.welcome-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--corp-text-primary);
  margin: 0 0 4px 0;
  line-height: 1.3;
}

.welcome-desc {
  font-size: 14px;
  color: var(--corp-text-secondary);
  margin: 0;
  line-height: 1.5;
}

.welcome-right {
  flex-shrink: 0;
  padding-top: 2px;
}

/* ===== 统计卡片 ===== */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 20px;
  transition: box-shadow 0.15s ease;
  cursor: default;
}

.stat-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
}

.stat-body {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat-info {
  flex: 1;
  min-width: 0;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.02em;
  margin-bottom: 6px;
}

.value-primary { color: var(--corp-primary); }
.value-warning { color: var(--corp-warning); }
.value-success { color: var(--corp-success); }
.value-danger { color: var(--corp-danger); }

.stat-label {
  font-size: 13px;
  color: #64748b;
  font-weight: 400;
}

.stat-icon-wrap {
  flex-shrink: 0;
  margin-left: 16px;
}

.stat-icon-bg {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.primary-bg { background-color: var(--color-primary-50); color: var(--corp-primary); }
.warning-bg { background-color: var(--color-warning-light); color: var(--corp-warning); }
.success-bg { background-color: var(--color-success-light); color: var(--corp-success); }
.danger-bg { background-color: var(--color-danger-light); color: var(--corp-danger); }

/* ===== 最近任务区域 ===== */
.recent-section {
  background: transparent;
}

.recent-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding: 0 4px;
}

.recent-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.recent-table-card.recent-table-card {
  border-radius: 8px;
  border: 1px solid var(--corp-border-light);
}

.recent-table-card :deep(.el-card__body) {
  padding: 0;
}

.task-name {
  font-weight: 500;
  color: var(--corp-text-primary);
  font-size: 13px;
}

.time-cell {
  color: var(--corp-text-secondary);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

/* 空状态 */
.table-empty {
  text-align: center;
  padding: 36px 0 28px;
}

.empty-svg-sm {
  width: 90px;
  height: 72px;
  margin-bottom: 10px;
  opacity: 0.55;
}

.table-empty p {
  color: var(--corp-text-secondary);
  font-size: 13px;
  margin: 0 0 10px;
}

/* 响应式：小屏幕时统计卡片两列 */
@media (max-width: 900px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .welcome-section {
    flex-direction: column;
    gap: 12px;
  }

  .stats-grid {
    grid-template-columns: 1fr;
  }
}
</style>
