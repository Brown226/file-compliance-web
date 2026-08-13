<template>
  <div class="task-history">
    <!-- 页面标题区 -->
    <div class="page-header">
      <h2 class="page-title">审查任务列表</h2>
    </div>

    <!-- 过滤栏 -->
    <div class="filter-bar-enhanced">
      <!-- 左侧：主要筛选项 -->
      <div class="filter-left">
        <div class="search-box">
          <el-input
            v-model="filters.search"
            placeholder="搜索任务名称..."
            clearable
            prefix-icon="Search"
            @clear="() => fetchTasks()"
            @keyup.enter="() => fetchTasks()"
            class="search-input"
          />
        </div>

        <el-select
          v-model="filters.status"
          placeholder="全部状态"
          clearable
          @change="fetchTasks"
          class="filter-select"
        >
          <el-option label="排队中" value="PENDING" />
          <el-option label="审查中" value="PROCESSING" />
          <el-option label="已完成" value="COMPLETED" />
          <el-option label="失败" value="FAILED" />
        </el-select>

        <el-select
          v-model="filters.reviewMode"
          placeholder="审查模式"
          clearable
          @change="fetchTasks"
          class="filter-select"
        >
          <el-option label="以库审文" value="LIBRARY_REVIEW" />
          <el-option label="以文审文" value="DOC_REVIEW" />
          <el-option label="合同风险审查" value="CONTRACT_REVIEW" />
          <el-option label="一致性审查" value="CONSISTENCY" />
          <el-option label="基础校对" value="TYPO_GRAMMAR" />
          <el-option label="仅规则审查" value="RULE_ONLY" />
          <el-option label="标准引用自检" value="SELF_CHECK" />
        </el-select>

        <!-- 创建人快速搜索（管理员可见：输入姓名或账号模糊搜索） -->
        <el-input
          v-if="userStore.isAdmin()"
          v-model="filters.creator"
          placeholder="搜索创建人..."
          clearable
          prefix-icon="Search"
          @clear="fetchTasks"
          @keyup.enter="fetchTasks"
          class="filter-input"
          style="width: 150px"
        />
      </div>

      <!-- 右侧：操作按钮组 -->
      <div class="filter-right">
        <el-button-group>
          <el-button type="primary" @click="() => fetchTasks()">
            <el-icon><Search /></el-icon>
            查询
          </el-button>
          <el-button @click="resetFilter">
            <el-icon><Refresh /></el-icon>
            重置
          </el-button>
        </el-button-group>

        <el-divider direction="vertical" />

        <el-dropdown @command="handleExportCommand" trigger="click">
          <el-button>
            <el-icon><Download /></el-icon>
            导出
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="all">导出全部数据</el-dropdown-item>
              <el-dropdown-item command="selected" :disabled="selectedRows.length === 0">
                导出选中项 ({{ selectedRows.length }})
              </el-dropdown-item>
              <el-dropdown-item divided command="template">
                下载导出模板
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <el-button
          link
          type="primary"
          @click="showAdvancedFilter = !showAdvancedFilter"
          class="advanced-toggle"
        >
          {{ showAdvancedFilter ? '收起' : '高级' }}
          <el-icon :size="12">
            <component :is="showAdvancedFilter ? 'ArrowUp' : 'ArrowDown'" />
          </el-icon>
        </el-button>
      </div>

      <!-- 高级筛选区（可折叠） -->
      <transition name="slide-down">
        <div v-if="showAdvancedFilter" class="advanced-filter-enhanced">
          <div class="filter-row">
            <el-form-item label="创建时间">
              <el-date-picker
                v-model="filters.dateRange"
                type="daterange"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                value-format="YYYY-MM-DD"
                @change="fetchTasks"
                style="width: 280px"
              />
            </el-form-item>
          </div>
        </div>
      </transition>
    </div>

    <!-- 批量操作栏（增强版） -->
    <transition name="slide-fade">
      <div class="batch-actions-enhanced" v-if="selectedRows.length > 0">
        <div class="batch-left">
          <el-icon :size="18" color="var(--color-primary-500)"><Select /></el-icon>
          <span class="batch-text">
            已选择 <strong>{{ selectedRows.length }}</strong> 项
          </span>
        </div>

        <div class="batch-right">
          <!-- 批量导出 -->
          <el-button-group>
            <el-button
              type="success"
              size="small"
              @click="handleBatchExport"
            >
              <el-icon><Download /></el-icon>
              批量导出
            </el-button>
          </el-button-group>

          <!-- 批量删除 -->
          <el-button
            type="danger"
            size="small"
            @click="handleBatchDelete"
            plain
          >
            <el-icon><Delete /></el-icon>
            批量删除
          </el-button>

          <!-- 取消选择 -->
          <el-button
            link
            type="info"
            size="small"
            @click="selectedRows = []"
            class="cancel-select"
          >
            取消选择
          </el-button>
        </div>
      </div>
    </transition>

    <!-- 数据表格 -->
    <div class="table-wrapper">
      <el-table
        :data="tableData"
        style="width: 100%"
        v-loading="loading"
        @selection-change="handleSelectionChange"
        row-class-name="task-row"
      >
        <el-table-column type="selection" width="48" align="center" />
        <el-table-column prop="title" label="任务名称" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="task-name-cell">{{ row.title }}</span>
          </template>
        </el-table-column>
        <el-table-column label="审查模式" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="plan-summary-cell">{{ getReviewPlanSummary(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="140" align="center">
          <template #default="{ row }">
            <!-- 审查中：显示进度条 -->
            <template v-if="row.status === 'PROCESSING'">
              <div class="status-progress">
                <el-progress
                  :percentage="row.progress || 0"
                  :stroke-width="14"
                  :text-inside="true"
                  :format="(p: number) => `${p}%`"
                  status=""
                  color="var(--color-primary-600)"
                />
                <span class="progress-label">审查中</span>
              </div>
            </template>

            <!-- 其他状态：使用状态标签 -->
            <template v-else>
              <span :class="['status-tag', `status-${(row.status || '').toLowerCase()}`]">
                {{ getStatusLabel(row.status) }}
              </span>
            </template>
          </template>
        </el-table-column>
        <el-table-column prop="file_count" label="文件" width="60" align="center">
          <template #default="{ row }">
            <span class="count-num">{{ row.file_count || 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="issue_count" label="问题" width="70" align="center">
          <template #default="{ row }">
            <span :class="['count-num', { 'has-issues': (row.issue_count || 0) > 0 }]">
              {{ row.issue_count || 0 }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="user" label="创建人" width="100">
          <template #default="{ row }">
            <span>{{ row.user?.nick_name || row.user?.username || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="create_time" label="创建时间" width="150" align="center">
          <template #default="{ row }">
            <span class="time-cell" :title="formatTime(row.create_time)">
              {{ formatTimeRelative(row.create_time) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right" align="center">
          <template #default="{ row }">
            <div class="action-btns">
              <!-- 主要操作：查看详情 -->
              <el-button
                type="primary"
                size="small"
                @click="handleViewResult(row)"
                class="primary-action"
              >
                <el-icon><View /></el-icon>
                详情
              </el-button>

              <!-- 次要操作：下拉菜单 -->
              <el-dropdown
                trigger="click"
                @command="(cmd: string) => handleActionCommand(cmd, row)"
              >
                <el-button size="small" class="more-action">
                  更多
                  <el-icon class="el-icon--right"><ArrowDown /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item
                      command="export"
                      :disabled="row.status !== 'COMPLETED'"
                    >
                      <el-icon><Download /></el-icon>
                      导出报告
                    </el-dropdown-item>
                    <el-dropdown-item
                      command="review"
                      :disabled="row.status === 'PROCESSING' || !row.file_count"
                      :divided="true"
                    >
                      <el-icon><Refresh /></el-icon>
                      重新审查
                    </el-dropdown-item>
                    <el-dropdown-item
                      command="delete"
                      divided
                      style="color: var(--color-danger)"
                    >
                      <el-icon><Delete /></el-icon>
                      删除任务
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>

        <!-- 空状态 -->
        <template #empty>
          <div class="empty-state">
            <template v-if="hasActiveFilters">
              <svg viewBox="0 0 120 100" fill="none" class="empty-svg">
                <rect x="20" y="15" width="80" height="70" rx="6" stroke="var(--color-gray-200)" stroke-width="2" fill="var(--color-gray-50)"/>
                <path d="M35 38H85M35 50H75M35 62H60" stroke="var(--color-gray-300)" stroke-width="2" stroke-linecap="round"/>
                <circle cx="78" cy="68" r="14" fill="var(--color-warning-bg)" stroke="var(--color-warning)" stroke-width="1.5"/>
                <path d="M78 63V70M78 73V74" stroke="var(--color-warning-600)" stroke-width="2" stroke-linecap="round"/>
              </svg>
              <p>未找到匹配的审查任务</p>
              <p class="empty-hint">尝试调整筛选条件或重置过滤器</p>
              <el-button type="primary" size="large" @click="resetFilter">
                重置筛选条件
              </el-button>
            </template>
            <template v-else>
              <svg viewBox="0 0 120 100" fill="none" class="empty-svg">
                <rect x="20" y="15" width="80" height="70" rx="6" stroke="var(--color-gray-200)" stroke-width="2" fill="var(--color-gray-50)"/>
                <path d="M35 38H85M35 50H75M35 62H60" stroke="var(--color-gray-300)" stroke-width="2" stroke-linecap="round"/>
                <circle cx="78" cy="68" r="14" fill="var(--color-primary-50)" stroke="var(--color-primary-500)" stroke-width="1.5"/>
                <path d="M73 68L77 72L84 64" stroke="var(--color-primary-700)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <p>暂无审查任务</p>
              <el-button type="primary" size="large" @click="$router.push('/tasks/new')">
                创建第一个审查任务
              </el-button>
            </template>
          </div>
        </template>
      </el-table>
    </div>

    <!-- 分页（增强版） -->
    <div class="pagination-enhanced">
      <!-- 左侧：统计信息 -->
      <div class="pagination-left">
        <el-text type="info" size="default">
          共 <strong class="total-count">{{ total }}</strong> 条记录
        </el-text>
        <el-tag
          v-if="selectedRows.length > 0"
          size="small"
          type="info"
          effect="plain"
          round
          class="selected-tag"
        >
          已选 {{ selectedRows.length }} 项
        </el-tag>
      </div>

      <!-- 右侧：分页器 -->
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        layout="sizes, prev, pager, next, jumper"
        :total="total"
        background
        small
        @size-change="handleSizeChange"
        @current-change="handleCurrentChange"
        class="pagination-component"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import {
  Download,
  Search,
  Select,
  Delete,
  View,
  ArrowDown,
  Refresh,
} from '@element-plus/icons-vue'
import { useTaskHistory } from './composables/useTaskHistory'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()

const {
  loading,
  currentPage,
  pageSize,
  total,
  tableData,
  selectedRows,
  reviewingMap,
  filters,
  showAdvancedFilter,
  hasActiveFilters,
  getStatusLabel,
  formatTime,
  formatTimeRelative,
  getReviewPlanSummary,
  reviewModeLabelMap,
  fetchTasks,
  resetFilter,
  handleSizeChange,
  handleCurrentChange,
  handleSelectionChange,
  handleViewResult,
  handleActionCommand,
  handleExportCommand,
  handleExportTask,
  handleExportAll,
  handleDelete,
  handleBatchExport,
  handleBatchDelete,
  handleReReview,
} = useTaskHistory()

onMounted(() => {
  fetchTasks()
})
</script>
<style scoped>
/* ===== 任务历史页样式（Swiss Industrial 设计语言）=====
   设计原则：数据为中心、强网格布局、单一蓝色强调（#2563eb）、
   细线分隔（1px #e5e7eb）、最小阴影、统一 4px 圆角
*/
.task-history {
  padding: 0;
  background: transparent;
  color: var(--corp-text-primary);
  font-feature-settings: 'tnum';
}

/* ===== 页面标题区 ===== */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--corp-border-light);
}

.page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--corp-text-primary);
  letter-spacing: -0.01em;
}

/* ===== 过滤栏 ===== */
.filter-bar-enhanced {
  margin-bottom: 16px;
  padding: 14px 16px;
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: var(--radius-sm);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.filter-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}

.filter-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  white-space: nowrap;
}

.search-box {
  min-width: 240px;
}

.filter-select {
  width: 140px !important;
}

.advanced-toggle {
  font-weight: 500;
  letter-spacing: 0;
}

.advanced-filter-enhanced {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--bg-surface-active);
  width: 100%;
}

.filter-row {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}

/* ===== 批量操作栏 ===== */
.batch-actions-enhanced {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  margin-bottom: 12px;
  background: var(--color-primary-50);
  border: 1px solid var(--color-primary-600);
  border-radius: var(--radius-sm);
}

.batch-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.batch-text {
  font-size: 13px;
  color: var(--color-gray-700);
}

.batch-text strong {
  color: var(--color-primary-600);
  font-size: 15px;
  font-weight: 700;
  margin: 0 2px;
}

.batch-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cancel-select {
  font-weight: 500;
}

.slide-fade-enter-active { transition: all 0.2s ease; }
.slide-fade-leave-active { transition: all 0.15s ease; }
.slide-fade-enter-from { opacity: 0; transform: translateY(-4px); }
.slide-fade-leave-to { opacity: 0; transform: translateY(-4px); }

.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}
.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  margin-top: 0;
}
.slide-down-enter-to,
.slide-down-leave-from {
  max-height: 80px;
}

/* ===== 表格 ===== */
.table-wrapper {
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

:deep(.table-wrapper .el-table) {
  font-size: 13px;
  --el-table-border-color: var(--bg-surface-active);
  --el-table-header-bg-color: var(--bg-surface-hover);
  --el-table-row-hover-bg-color: var(--bg-surface-hover);
}

:deep(.table-wrapper .el-table th.el-table__cell) {
  height: 44px;
  padding: 8px 0;
  font-weight: 600;
  color: var(--corp-text-secondary);
  font-size: 12px;
  background: var(--bg-surface-hover);
  border-bottom: 1px solid var(--corp-border-light);
}

:deep(.table-wrapper .el-table td.el-table__cell) {
  height: 48px;
  padding: 8px 0;
  border-bottom: 1px solid var(--bg-surface-active);
}

:deep(.table-wrapper .el-table .cell) {
  line-height: 1.5;
}

.task-row {
  cursor: default;
  transition: background 0.15s ease;
}

:deep(.task-row:hover td:first-child::before) {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--color-primary-600);
}

:deep(.el-table__inner-wrapper::before) {
  display: none;
}

.task-name-cell {
  font-size: 13px;
  line-height: 1.5;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.plan-summary-cell {
  font-size: 13px;
  color: var(--corp-text-secondary);
}

/* ===== 状态标签 ===== */
.status-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 56px;
  padding: 3px 10px;
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  border: 1px solid transparent;
}

.status-completed {
  color: var(--color-success-600);
  background: var(--color-success-bg);
  border-color: var(--color-success-bg);
}

.status-processing {
  color: var(--color-primary-600);
  background: var(--color-primary-50);
  border-color: var(--color-primary-200);
}

.status-pending {
  color: var(--color-warning-600);
  background: var(--color-warning-bg);
  border-color: var(--color-warning-bg);
}

.status-failed {
  color: var(--color-danger-600);
  background: var(--color-danger-bg);
  border-color: var(--color-danger-bg);
}

/* 进度条 */
.status-progress {
  text-align: center;
}

.status-progress :deep(.el-progress-bar__outer) {
  border-radius: 2px;
  background-color: var(--bg-surface-active);
}

.status-progress :deep(.el-progress-bar__inner) {
  background: var(--color-primary-600);
  border-radius: 2px;
}

.progress-label {
  display: block;
  margin-top: 3px;
  font-size: var(--text-sm);
  color: var(--color-primary-600);
  font-weight: 600;
}

/* ===== 数字列 ===== */
.count-num {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-gray-700);
  font-variant-numeric: tabular-nums;
}

.count-num.has-issues {
  color: var(--color-danger-600);
}

/* ===== 时间列 ===== */
.time-cell {
  font-size: 12px;
  color: var(--corp-text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* ===== 操作按钮 ===== */
.action-btns {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
}

.action-btns :deep(.el-button) {
  font-size: 12px;
  padding: 0 10px;
  height: 28px;
  border-radius: var(--radius-md);
}

.primary-action {
  font-weight: 500;
}

.more-action {
  font-weight: 500;
  background-color: var(--bg-surface-hover);
  border-color: var(--corp-border-light);
  color: var(--corp-text-secondary);
}

.more-action:hover {
  background-color: var(--color-primary-50);
  border-color: var(--color-primary-600);
  color: var(--color-primary-600);
}

/* ===== 空状态 ===== */
.empty-state {
  text-align: center;
  padding: 48px 0 32px;
}

.empty-svg {
  width: 100px;
  height: 80px;
  margin-bottom: 12px;
  opacity: 0.6;
}

.empty-state p {
  color: var(--corp-text-secondary);
  font-size: 14px;
  margin: 0 0 16px;
  font-weight: 500;
}

.empty-hint {
  font-size: 12px !important;
  color: var(--corp-text-tertiary) !important;
  margin: -10px 0 16px !important;
  font-weight: 400 !important;
}

/* ===== 分页 ===== */
.pagination-enhanced {
  margin-top: 16px;
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: var(--radius-sm);
}

.pagination-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.total-count {
  color: var(--color-primary-600);
  font-size: 15px;
  font-weight: 700;
  margin: 0 2px;
  font-variant-numeric: tabular-nums;
}

.selected-tag {
  font-weight: 600;
}

.pagination-component :deep(.el-pagination) {
  font-size: 12px;
  justify-content: flex-end;
}

.pagination-component :deep(.el-pager li),
.pagination-component :deep(.btn-prev),
.pagination-component :deep(.btn-next) {
  border-radius: var(--radius-md);
}

/* ===== 表格行 hover ===== */
.task-history :deep(.el-table__body tr:hover > td) {
  background-color: var(--bg-surface-hover) !important;
}

.task-history :deep(.el-table__body tr) {
  transition: background 0.15s ease;
}

/* ===== 响应式 ===== */
@media (max-width: 1200px) {
  .filter-bar-enhanced {
    gap: 12px;
    padding: 12px 14px;
  }
  .search-box {
    min-width: 200px;
  }
  .filter-select {
    width: 130px !important;
  }
}

@media (max-width: 992px) {
  .filter-bar-enhanced {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  .filter-left {
    justify-content: stretch;
  }
  .filter-right {
    justify-content: space-between;
    padding-top: 10px;
    border-top: 1px dashed var(--corp-border-light);
  }
  .search-box {
    min-width: auto;
    flex: 1;
  }
  .filter-select {
    flex: 1 !important;
    width: auto !important;
    min-width: 110px;
  }
}

@media (max-width: 768px) {
  .filter-bar-enhanced {
    padding: 10px 12px;
    gap: 10px;
  }
  .filter-left {
    flex-direction: column;
    gap: 8px;
  }
  .search-input :deep(.el-input__wrapper) {
    border-radius: var(--radius-md);
  }
  .filter-right {
    flex-wrap: wrap;
    gap: 6px;
  }
  .filter-right .el-button-group {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .filter-right .el-divider--vertical {
    display: none;
  }
  .advanced-toggle span:not(.el-icon) {
    display: none;
  }
}

@media (max-width: 480px) {
  .filter-bar-enhanced {
    padding: 10px;
  }
  .filter-right .el-button {
    font-size: 12px;
    padding: 6px 10px;
  }
}
</style>
