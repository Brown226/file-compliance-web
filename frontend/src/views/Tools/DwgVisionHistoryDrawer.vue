<template>
  <el-drawer
    v-model="visible"
    title="图纸视觉分析历史记录"
    direction="rtl"
    size="480px"
  >
    <!-- Task 39: 多选模式下的操作栏 -->
    <div v-if="multiSelectMode" class="multi-select-bar">
      <el-checkbox
        :model-value="isAllSelected"
        @change="toggleSelectAll"
      >
        全选
      </el-checkbox>
      <span class="selected-count">已选 {{ selectedIds.length }} 项</span>
      <div class="multi-select-actions">
        <el-button
          size="small"
          type="primary"
          :disabled="selectedIds.length < 2"
          :loading="comparing"
          @click="$emit('cross-compare', selectedIds)"
        >
          <el-icon style="margin-right:3px"><Connection /></el-icon>
          跨文件比对 ({{ selectedIds.length }})
        </el-button>
        <el-button size="small" @click="exitMultiSelect">取消</el-button>
      </div>
    </div>

    <div v-loading="loading" class="history-list">
      <el-empty v-if="!loading && items.length === 0" description="暂无历史记录" />

      <!-- Task 39: 多选模式下显示 checkbox，单击不再触发 replay -->
      <div
        v-for="item in items"
        :key="item.id"
        class="history-item"
        :class="{ 'history-item-selected': selectedIds.includes(item.id) }"
        @click="onItemClick(item)"
      >
        <div class="history-item-header">
          <el-checkbox
            v-if="multiSelectMode"
            :model-value="selectedIds.includes(item.id)"
            @change="(val: boolean) => toggleSelect(item.id, val)"
            @click.stop
            class="item-checkbox"
          />
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
      <div class="drawer-footer">
        <!-- Task 39: 多选模式切换按钮 -->
        <el-button
          v-if="!multiSelectMode && items.length >= 2"
          size="small"
          type="warning"
          plain
          @click="enterMultiSelect"
        >
          <el-icon style="margin-right:3px"><Connection /></el-icon>
          跨文件比对
        </el-button>
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
      </div>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { Document, WarningFilled, Connection } from '@element-plus/icons-vue'
import { ref, computed } from 'vue'
import type { VisionHistoryItem } from '@/api/dwg-vision'

const props = defineProps<{
  visible: boolean
  loading: boolean
  items: VisionHistoryItem[]
  total: number
  pageSize: number
  currentPage: number
  analysisLabels: Record<string, string>
  /** Task 39: 跨文件比对 loading 状态 */
  comparing?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void
  (e: 'replay', item: VisionHistoryItem): void
  (e: 'page-change', page: number): void
  /** Task 39: 触发跨文件比对，payload 为选中的记录 ID 数组 */
  (e: 'cross-compare', recordIds: string[]): void
}>()

// v-model 代理
const visible = defineModel<boolean>('visible', { default: false })
const currentPage = defineModel<number>('currentPage', { default: 1 })

// Task 39: 多选模式 + 选中 ID 集合
const multiSelectMode = ref(false)
const selectedIds = ref<string[]>([])

const isAllSelected = computed(() => {
  return props.items.length > 0 && props.items.every(i => selectedIds.value.includes(i.id))
})

function enterMultiSelect() {
  multiSelectMode.value = true
  selectedIds.value = []
}

function exitMultiSelect() {
  multiSelectMode.value = false
  selectedIds.value = []
}

function toggleSelect(id: string, checked: boolean) {
  if (checked) {
    if (!selectedIds.value.includes(id)) {
      selectedIds.value.push(id)
    }
  } else {
    selectedIds.value = selectedIds.value.filter(i => i !== id)
  }
}

function toggleSelectAll(checked: boolean) {
  if (checked) {
    selectedIds.value = props.items.map(i => i.id)
  } else {
    selectedIds.value = []
  }
}

function onItemClick(item: VisionHistoryItem) {
  if (multiSelectMode.value) {
    // 多选模式下：单击切换选中状态
    const idx = selectedIds.value.indexOf(item.id)
    if (idx >= 0) {
      selectedIds.value.splice(idx, 1)
    } else {
      selectedIds.value.push(item.id)
    }
  } else {
    // 单选模式：触发 replay
    emit('replay', item)
  }
}

void emit
</script>

<style scoped>
.history-list {
  min-height: 200px;
}

/* Task 39: 多选操作栏 */
.multi-select-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  border-radius: 6px;
  margin-bottom: 12px;
  font-size: 13px;
}

.multi-select-bar .selected-count {
  color: #92400e;
  font-weight: 500;
}

.multi-select-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}

.item-checkbox {
  margin-right: 4px;
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

/* Task 39: 选中状态高亮 */
.history-item-selected {
  border-color: #f59e0b;
  background: #fffbeb;
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

.drawer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
</style>
