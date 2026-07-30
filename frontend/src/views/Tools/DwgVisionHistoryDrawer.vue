<template>
  <el-drawer
    v-model="visible"
    title="图纸视觉分析历史记录"
    direction="rtl"
    size="480px"
  >
    <div v-loading="loading" class="history-list">
      <el-empty v-if="!loading && items.length === 0" description="暂无历史记录" />
      <div
        v-for="item in items"
        :key="item.id"
        class="history-item"
        @click="$emit('replay', item)"
      >
        <div class="history-item-header">
          <el-icon><Document /></el-icon>
          <span class="history-filename" :title="item.fileName || '未命名'">
            {{ item.fileName || '未命名' }}
          </span>
          <el-tag size="small" type="info">{{ (item.durationMs / 1000).toFixed(1) }}s</el-tag>
        </div>
        <div class="history-item-meta">
          <span>{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</span>
          <span v-if="item.modelInfo?.model" class="history-model">{{ item.modelInfo.model }}</span>
        </div>
        <div class="history-item-analyses">
          <el-tag
            v-for="a in item.analyses"
            :key="a"
            size="small"
            effect="plain"
          >
            {{ analysisLabels[a] || a }}
          </el-tag>
        </div>
        <div v-if="item.errors && item.errors.length > 0" class="history-item-errors">
          <el-icon><WarningFilled /></el-icon>
          <span>{{ item.errors.length }} 项错误</span>
        </div>
      </div>
    </div>

    <template #footer>
      <el-pagination
        v-if="total > pageSize"
        small
        background
        layout="prev, pager, next"
        :total="total"
        :page-size="pageSize"
        v-model:current-page="currentPage"
        @current-change="$emit('page-change', currentPage)"
      />
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { Document, WarningFilled } from '@element-plus/icons-vue'
import type { VisionHistoryItem } from '@/api/dwg-vision'

defineProps<{
  visible: boolean
  loading: boolean
  items: VisionHistoryItem[]
  total: number
  pageSize: number
  currentPage: number
  analysisLabels: Record<string, string>
}>()

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void
  (e: 'replay', item: VisionHistoryItem): void
  (e: 'page-change', page: number): void
}>()

// v-model 代理
const visible = defineModel<boolean>('visible', { default: false })
const currentPage = defineModel<number>('currentPage', { default: 1 })

void emit
</script>

<style scoped>
.history-list {
  min-height: 200px;
}

.history-item {
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.history-item:hover {
  border-color: #3b82f6;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.12);
}

.history-item-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.history-filename {
  flex: 1;
  font-weight: 500;
  color: #1e293b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-item-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #64748b;
  margin-bottom: 6px;
}

.history-model {
  color: #3b82f6;
}

.history-item-analyses {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.history-item-errors {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #dc2626;
  margin-top: 6px;
}
</style>
