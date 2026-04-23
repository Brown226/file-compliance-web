<template>
  <div :class="['collapsible-header', { 'is-collapsed': headerCollapsed }]">
    <!-- 顶部导航区 -->
    <div class="top-header">
      <el-button link class="back-btn" @click="$emit('goBack')">
        <el-icon><ArrowLeft /></el-icon>
        返回任务列表
      </el-button>
    </div>

    <!-- 任务信息卡片 -->
    <div v-if="task" class="task-info-section">
      <div class="task-info-card">
        <div class="task-info-main">
          <h2 class="task-title">{{ task.title }}</h2>
          <div class="task-meta-row">
            <span class="meta-item">
              <el-icon><User /></el-icon> {{ task.user?.nick_name || task.user?.username || '-' }}
            </span>
            <span class="meta-divider"></span>
            <span class="meta-item">
              <el-icon><Clock /></el-icon> {{ formatTime(task.create_time) }}
            </span>
          </div>
          <p v-if="task.description" class="task-desc">{{ task.description }}</p>
        </div>
        <div class="task-status-area">
          <el-button type="primary" :icon="Download" @click="$emit('exportReport')" class="export-btn">
            导出审查报告
          </el-button>
          <div :class="['status-badge', `status-${(task.status || '').toLowerCase()}`]">
            {{ getStatusLabel(task.status) }}
          </div>
        </div>
      </div>
    </div>

    <!-- 收起状态下的迷你顶栏（始终可见，替代完整头部） -->
    <div v-if="task && headerCollapsed" class="mini-topbar" @click="$emit('expandHeader')">
      <span class="mini-title">{{ task.title }}</span>
      <span :class="['mini-status', `mini-status-${(task.status || '').toLowerCase()}`]">{{ getStatusLabel(task.status) }}</span>
      <span class="mini-detail-count">共 {{ details.length }} 条结果</span>
      <i class="el-icon mini-expand-icon"><svg viewBox="0 0 1024 1024"><path fill="currentColor" d="M340.864 149.312a30.59 30.59 0 0 0 0 42.752L652.736 512 340.864 831.872a30.59 30.59 0 0 0 0 42.752 29.12 29.12 0 0 0 41.728 0L714.24 534.336a32 32 0 0 0 0-44.672L382.592 149.376a29.12 29.12 0 0 0-41.728 0z"/></svg></i>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Download, ArrowLeft, User, Clock } from '@element-plus/icons-vue'
import { useFormatTime } from '@/composables/useFormatTime'
import { useStatusHelpers } from '@/composables/useStatusHelpers'

defineProps<{
  task: any
  details: any[]
  headerCollapsed: boolean
}>()

defineEmits<{
  goBack: []
  expandHeader: []
  exportReport: []
}>()

const { formatTime } = useFormatTime()
const { getTaskStatusLabel: getStatusLabel } = useStatusHelpers()

</script>

<style scoped>
.collapsible-header {
  flex-shrink: 0; overflow: hidden;
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1); max-height: 500px; opacity: 1;
}
.collapsible-header.is-collapsed.is-collapsed {
  max-height: 0; opacity: 0; padding-top: 0; margin-bottom: 0; pointer-events: none;
}

.mini-topbar {
  position: fixed; top: var(--corp-header-height); left: var(--corp-sidebar-width); right: 0; z-index: 100;
  display: flex; align-items: center; gap: 12px; padding: 8px 20px;
  background: var(--bg-surface); border-bottom: 1px solid var(--corp-border-light); box-shadow: 0 1px 6px rgba(0, 0, 0, 0.08);
  cursor: pointer; animation: slideDown 0.25s ease-out; transition: background 0.15s;
}
.mini-topbar:hover { background: var(--color-gray-50); }
@keyframes slideDown {
  from { transform: translateY(-100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
.mini-title { font-size: 14px; font-weight: 600; color: var(--corp-text-primary); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mini-status { font-size: 11px; font-weight: 600; padding: 2px 10px; border-radius: 10px; white-space: nowrap; letter-spacing: 0.02em; }
.mini-status-completed { background: var(--color-success-light); color: var(--corp-success); }
.mini-status-processing { background: var(--color-primary-50); color: var(--corp-primary); animation: pulse 2s infinite; }
.mini-status-pending { background: var(--color-gray-100); color: var(--color-gray-500); }
.mini-status-failed { background: var(--color-danger-light); color: var(--corp-danger); }
.mini-detail-count { font-size: 12px; color: var(--corp-text-secondary); margin-left: auto; }
.mini-expand-icon { font-size: 14px; color: var(--corp-text-secondary); transform: rotate(-90deg); transition: transform 0.15s; }

.top-header { padding: 8px 0 4px; flex-shrink: 0; }
.back-btn { font-size: 14px; font-weight: 500; color: var(--corp-primary); display: inline-flex; align-items: center; gap: 4px; padding: 6px 4px; border-radius: var(--corp-radius-sm); transition: all var(--corp-transition-fast); }
.back-btn:hover { background-color: var(--corp-primary-light); color: var(--corp-primary-hover); }
.back-btn .el-icon { font-size: 16px; }

.task-info-section { padding-bottom: 10px; flex-shrink: 0; }
.task-info-card { display: flex; align-items: flex-start; justify-content: space-between; padding: 14px 20px; background: linear-gradient(135deg, var(--bg-surface) 0%, var(--corp-bg-sunken) 100%); border: 1px solid var(--corp-border-light); border-radius: var(--corp-radius-lg); box-shadow: var(--corp-shadow-sm); gap: 16px; }
.task-info-main { flex: 1; min-width: 0; }
.task-title { margin: 0 0 6px; font-size: 17px; font-weight: 700; color: var(--corp-text-primary); line-height: 1.3; }
.task-meta-row { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--corp-text-secondary); }
.meta-item { display: inline-flex; align-items: center; gap: 4px; }
.meta-divider { width: 1px; height: 14px; background-color: var(--corp-border); }
.task-desc { margin: 6px 0 0; font-size: 12px; color: var(--corp-text-regular); line-height: 1.5; max-width: 700px; }

.task-status-area { flex-shrink: 0; display: flex; align-items: center; gap: var(--space-3); }
.status-badge { padding: 6px 18px; border-radius: 20px; font-size: 13px; font-weight: 600; letter-spacing: 0.5px; white-space: nowrap; text-align: center; min-width: 70px; }
.status-pending { background-color: var(--corp-bg-sunken); color: var(--corp-info); }
.status-processing { background: linear-gradient(135deg, var(--color-primary-50), var(--color-primary-100)); color: var(--corp-primary); animation: pulse 2s infinite; }
.status-completed { background-color: var(--corp-success-light); color: var(--corp-success); }
.status-failed { background-color: var(--corp-danger-light); color: var(--corp-danger); }

.export-btn {
  white-space: nowrap;
  font-size: 14px;
  padding: 8px 18px;
  border-radius: var(--radius-md);
}

@media (max-width: 1100px) { .task-info-card { flex-direction: column; } .status-badge { align-self: flex-start; } }
</style>
