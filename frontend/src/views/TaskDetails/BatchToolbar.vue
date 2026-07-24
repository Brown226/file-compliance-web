<template>
  <div class="batch-toolbar" v-if="selectedCount > 0">
    <div class="batch-info">
      <el-checkbox
        :model-value="isAllSelected"
        :indeterminate="isIndeterminate"
        @change="emit('toggle-select-all', $event as boolean)"
        class="select-all-checkbox"
      >
        全选
      </el-checkbox>
      <span class="selected-count">
        已选 <strong>{{ selectedCount }}</strong> / {{ filteredCount }} 项
      </span>
    </div>

    <div class="batch-actions">
      <!-- 批量确认建议 -->
      <el-button-group v-if="selectedCount > 0 && isDocxSelected">
        <el-button
          type="success"
          size="small"
          @click="emit('batch-adopt')"
          :disabled="!hasAdoptableItems"
          :loading="batchLoading"
        >
          <el-icon><Check /></el-icon>
          批量采纳 ({{ adoptableCount }})
        </el-button>
      </el-button-group>

      <!-- 批量标记误报 -->
      <el-button-group v-if="selectedCount > 0">
        <el-button
          type="warning"
          size="small"
          @click="emit('batch-false-positive')"
          :disabled="!hasFpMarkableItems"
          :loading="batchLoading"
        >
          <el-icon><WarningFilled /></el-icon>
          标记误报 ({{ fpMarkableCount }})
        </el-button>
      </el-button-group>

      <!-- 取消选择 -->
      <el-button
        size="small"
        @click="emit('clear-selection')"
        :disabled="selectedCount === 0"
      >
        取消选择
      </el-button>

      <!-- 退出批量模式 -->
      <el-button
        link
        type="info"
        size="small"
        @click="emit('exit-batch-mode')"
      >
        退出批量操作
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Check, WarningFilled } from '@element-plus/icons-vue'

defineProps<{
  selectedCount: number
  filteredCount: number
  isAllSelected: boolean
  isIndeterminate: boolean
  isDocxSelected: boolean
  hasAdoptableItems: boolean
  adoptableCount: number
  hasFpMarkableItems: boolean
  fpMarkableCount: number
  batchLoading: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-select-all', value: boolean): void
  (e: 'batch-adopt'): void
  (e: 'batch-false-positive'): void
  (e: 'clear-selection'): void
  (e: 'exit-batch-mode'): void
}>()
</script>

<style scoped>
/* ===== 批量操作工具栏 ===== */
.batch-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: linear-gradient(135deg, #ECF5FF 0%, #F0F9FF 100%);
  border-bottom: 2px solid #409EFF;
  flex-shrink: 0;
  position: sticky;
  top: 48px; /* 筛选工具栏高度 */
  z-index: 9;
  animation: slideDown 0.3s ease;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.batch-info {
  display: flex;
  align-items: center;
  gap: 16px;
}

.select-all-checkbox {
  font-weight: 600;
  color: #303133;
}

.selected-count {
  font-size: 13px;
  color: #606266;
}

.selected-count strong {
  color: #409EFF;
  font-weight: 700;
  font-size: 15px;
  margin: 0 2px;
}

.batch-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.batch-actions .el-button-group {
  box-shadow: 0 2px 6px rgba(64, 158, 255, 0.12);
  border-radius: 6px;
  overflow: hidden;
}
</style>
