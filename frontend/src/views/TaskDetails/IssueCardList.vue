<template>
  <div class="right-panel">
    <div class="panel-header">
      <span class="panel-title">审查结果明细</span>
      <span class="result-count">共 {{ filteredAndSearched.length }} 项</span>
      <el-button
        v-if="selectedFileId"
        type="primary"
        link
        @click="$emit('update:selectedFileId', null)"
      >
        查看全部
      </el-button>
    </div>

    <!-- 筛选工具栏 (sticky) -->
    <div class="filter-toolbar" v-if="filteredAndSearched.length > 0 || hasActiveFilters">
      <div class="filter-group">
        <el-select v-model="filterSeverity" placeholder="严重度" clearable size="small" style="width:100px">
          <el-option label="错误" value="error" />
          <el-option label="警告" value="warning" />
          <el-option label="提示" value="info" />
        </el-select>
        <el-select v-model="filterCategory" placeholder="问题分类" clearable size="small" style="width:130px">
          <el-option v-for="t in allCategories" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>
        <!-- DWG 专属筛选：按图层 -->
        <el-select
          v-if="hasDwgDetails"
          v-model="filterDwgLayers"
          placeholder="按图层"
          clearable
          multiple
          collapse-tags
          collapse-tags-tooltip
          size="small"
          style="width:160px"
        >
          <el-option
            v-for="layer in dwgLayerOptions"
            :key="layer"
            :label="layer"
            :value="layer"
          />
        </el-select>
        <!-- DWG 专属筛选：按图元类型 -->
        <el-select
          v-if="hasDwgDetails"
          v-model="filterDwgEntityTypes"
          placeholder="按图元类型"
          clearable
          multiple
          collapse-tags
          collapse-tags-tooltip
          size="small"
          style="width:150px"
        >
          <el-option
            v-for="et in dwgEntityTypeOptions"
            :key="et.value"
            :label="et.label"
            :value="et.value"
          />
        </el-select>
        <!-- DWG 专属筛选：按规则类型 -->
        <el-select
          v-if="hasDwgDetails"
          v-model="filterDwgRuleTypes"
          placeholder="按规则类型"
          clearable
          multiple
          collapse-tags
          collapse-tags-tooltip
          size="small"
          style="width:150px"
        >
          <el-option
            v-for="rt in dwgRuleTypeOptions"
            :key="rt.value"
            :label="rt.label"
            :value="rt.value"
          />
        </el-select>
        <el-input v-model="searchText" placeholder="搜索原文本/描述..." clearable size="small" style="width:200px">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
      </div>
      <el-button link type="info" size="small" @click="resetFilters">
        <el-icon><RefreshRight /></el-icon> 重置
      </el-button>
    </div>

    <!-- 批量操作工具栏 -->
    <div class="batch-toolbar" v-if="filteredAndSearched.length > 0 && batchMode">
      <div class="batch-info">
        <el-checkbox
          :model-value="isAllSelected"
          :indeterminate="isIndeterminate"
          @change="toggleSelectAll"
          class="select-all-checkbox"
        >
          全选
        </el-checkbox>
        <span class="selected-count">
          已选 <strong>{{ selectedIssueIds.length }}</strong> / {{ filteredAndSearched.length }} 项
        </span>
      </div>

      <div class="batch-actions">
        <!-- 批量确认建议 -->
        <el-button-group v-if="selectedIssueIds.length > 0 && isDocxSelected">
          <el-button
            type="success"
            size="small"
            @click="handleBatchAdopt"
            :disabled="!hasAdoptableItems"
            :loading="batchLoading"
          >
            <el-icon><Check /></el-icon>
            批量采纳 ({{ adoptableCount }})
          </el-button>
        </el-button-group>

        <!-- 批量标记误报 -->
        <el-button-group v-if="selectedIssueIds.length > 0">
          <el-button
            type="warning"
            size="small"
            @click="handleBatchFalsePositive"
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
          @click="clearSelection"
          :disabled="selectedIssueIds.length === 0"
        >
          取消选择
        </el-button>

        <!-- 退出批量模式 -->
        <el-button
          link
          type="info"
          size="small"
          @click="exitBatchMode"
        >
          退出批量操作
        </el-button>
      </div>
    </div>

    <!-- 进入批量模式按钮（非批量模式下显示） -->
    <div class="enter-batch-bar" v-else-if="filteredAndSearched.length > 0 && !batchMode">
      <el-button
        type="primary"
        plain
        size="small"
        @click="enterBatchMode"
      >
        <el-icon><Operation /></el-icon>
        批量操作
      </el-button>
      <span class="batch-hint">可批量采纳建议或标记误报</span>
    </div>

    <div class="error-content" :class="{ 'batch-mode-active': batchMode }" ref="errorContentRef" v-loading="loading">
      <template v-if="filteredAndSearched.length > 0">
        <IssueCard
          v-for="detail in filteredAndSearched"
          :key="detail.id"
          :detail="detail"
          :batch-mode="batchMode"
          :selected="selectedIssueIds.includes(detail.id)"
          :is-docx-selected="isDocxSelected"
          :highlighted-id="highlightedId"
          :selected-file-id="selectedFileId"
          @locate-text="(payload) => $emit('locateText', payload)"
          @copy-handle-id="(handleId) => $emit('copyHandleId', handleId)"
          @open-fp-dialog="(detail) => $emit('openFpDialog', detail)"
          @adopt-suggestion="(detail) => $emit('adoptSuggestion', detail)"
          @cancel-fp="(detail) => $emit('cancelFp', detail)"
          @toggle-select="toggleIssueSelection"
          @select-file-by-id="(fileId) => $emit('selectFileById', fileId)"
        />
      </template>
      <el-empty v-else description="该任务暂无审查结果（或筛选无匹配）" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Search,
  RefreshRight,
  Check,
  Operation,
  WarningFilled,
} from '@element-plus/icons-vue'
import IssueCard from './IssueCard.vue'
import { useIssueFilter, useBatchSelection } from './composables'
import { ALL_CATEGORIES, DWG_RULE_TYPE_OPTIONS } from './constants/issue-config'
import type { IssueDetail } from './types/issue'

const props = defineProps<{
  details: IssueDetail[]
  loading: boolean
  selectedFileId: string | null
  isDocxSelected?: boolean
}>()

const emit = defineEmits<{
  'update:selectedFileId': [value: string | null]
  selectFileById: [fileId: string]
  copyHandleId: [handleId: string]
  openFpDialog: [detail: IssueDetail]
  cancelFp: [detail: IssueDetail]
  locateText: [payload: { detail: IssueDetail; elementId: string }]
  adoptSuggestion: [detail: IssueDetail]
  batchAdopt: [issueIds: string[]]
  batchFalsePositive: [issueIds: string[], reason?: string]
}>()

const errorContentRef = ref<HTMLElement | null>(null)

// 将 props 转换为 ref 以便 composables 使用
const detailsRef = computed(() => props.details)
const selectedFileIdRef = computed(() => props.selectedFileId)

// 使用 composables
const {
  filterSeverity,
  filterCategory,
  searchText,
  filterDwgLayers,
  filterDwgEntityTypes,
  filterDwgRuleTypes,
  filteredDetails,
  hasDwgDetails,
  dwgLayerOptions,
  dwgEntityTypeOptions,
  hasActiveFilters,
  filteredAndSearched,
  resetFilters,
} = useIssueFilter(detailsRef, selectedFileIdRef)

const {
  batchMode,
  selectedIssueIds,
  batchLoading,
  isAllSelected,
  isIndeterminate,
  adoptableCount,
  fpMarkableCount,
  hasAdoptableItems,
  hasFpMarkableItems,
  enterBatchMode,
  exitBatchMode,
  toggleIssueSelection,
  toggleSelectAll,
  clearSelection,
  getSelectedIssues,
} = useBatchSelection(filteredAndSearched)

// 常量配置
const allCategories = ALL_CATEGORIES
const dwgRuleTypeOptions = DWG_RULE_TYPE_OPTIONS

// 高亮状态
const highlightedId = ref<string | null>(null)
let highlightTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 滚动到指定问题卡片并高亮
 * @param detailId 要高亮的问题ID
 */
const scrollToIssue = (detailId: string) => {
  highlightedId.value = detailId

  // 清除之前的高亮定时器
  if (highlightTimer) {
    clearTimeout(highlightTimer)
  }

  // 滚动到目标元素
  nextTick(() => {
    const element = document.getElementById(`issue-${detailId}`)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })

  // 3秒后取消高亮
  highlightTimer = setTimeout(() => {
    highlightedId.value = null
  }, 3000)
}

// 批量采纳建议
const handleBatchAdopt = async () => {
  if (!hasAdoptableItems.value) return

  try {
    await ElMessageBox.confirm(
      `确定要批量采纳 ${adoptableCount.value} 条建议吗？此操作将自动修改文档内容。`,
      '批量确认',
      {
        confirmButtonText: '确认采纳',
        cancelButtonText: '取消',
        type: 'success',
        distinguishCancelAndClose: true,
      }
    )

    batchLoading.value = true

    // 筛选出可采纳的问题ID
    const adoptableIds = getSelectedIssues()
      .filter((issue: IssueDetail) => issue.suggestedText && !issue.isFalsePositive)
      .map((issue: IssueDetail) => issue.id)

    // 触发父组件事件
    emit('batchAdopt', adoptableIds)

    ElMessage.success(`已提交 ${adoptableIds.length} 条采纳请求`)

    // 延迟清空选择，让用户看到反馈
    setTimeout(() => {
      clearSelection()
    }, 1000)
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error('批量操作失败')
      console.error('批量采纳失败:', error)
    }
  } finally {
    batchLoading.value = false
  }
}

// 批量标记误报
const handleBatchFalsePositive = async () => {
  if (!hasFpMarkableItems.value) return

  try {
    const { value: reason } = await ElMessageBox.prompt(
      `请输入将 ${fpMarkableCount.value} 条问题标记为误报的原因：`,
      '批量标记误报',
      {
        confirmButtonText: '确认标记',
        cancelButtonText: '取消',
        inputPlaceholder: '例如：该条款符合公司内部规定...',
        inputType: 'textarea',
        inputValidator: (val: string) => {
          if (!val || val.trim().length < 5) {
            return '请至少输入5个字符的原因说明'
          }
          return true
        },
      }
    )

    batchLoading.value = true

    // 筛选出可标记的问题ID
    const fpMarkableIds = getSelectedIssues()
      .filter((issue: IssueDetail) => !issue.isFalsePositive)
      .map((issue: IssueDetail) => issue.id)

    // 触发父组件事件
    emit('batchFalsePositive', fpMarkableIds, reason)

    ElMessage.success(`已提交 ${fpMarkableIds.length} 条误报标记`)

    setTimeout(() => {
      clearSelection()
    }, 1000)
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error('批量操作失败')
      console.error('批量标记误报失败:', error)
    }
  } finally {
    batchLoading.value = false
  }
}

// 暴露方法给父组件
defineExpose({
  errorContentRef,
  scrollToIssue,
})
</script>

<style scoped>
/* ===== 面板容器 — Inset Shadow ===== */
.right-panel {
  flex: 1;
  background: #FFFFFF;
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  box-shadow: var(--border-inset), 0 1px 2px rgba(0, 0, 0, 0.04);
  overflow: hidden;
  min-width: 0;
}

.panel-header {
  padding: 10px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  border-bottom: 1px solid #F0F0F0;
}
.panel-title { font-weight: 800; font-size: 14px; color: #111827; }
.result-count { font-size: var(--text-sm); color: #6B7280; }

.filter-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-bottom: 1px solid #F0F0F0;
  flex-shrink: 0;
  background: #FFFFFF;
  position: sticky;
  top: 0;
  z-index: 10;
}
.filter-group { display: flex; align-items: center; gap: 8px; }

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

/* 进入批量模式按钮栏 */
.enter-batch-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: #FAFAFA;
  border-bottom: 1px solid #EBEEF5;
  flex-shrink: 0;
}

.batch-hint {
  font-size: 12px;
  color: #909399;
}

/* 批量模式下卡片增加左边距（为checkbox留空间） */
.batch-mode-active .issue-card {
  position: relative;
  padding-left: 36px;
}

.error-content { flex: 1; padding: 12px 14px; overflow-y: auto; }

@media (max-width: 800px) {
  .filter-toolbar { flex-wrap: wrap; }
  .filter-group { flex-wrap: wrap; }
}
.filter-toolbar .el-select .el-tag { max-width: 80px; }
</style>
