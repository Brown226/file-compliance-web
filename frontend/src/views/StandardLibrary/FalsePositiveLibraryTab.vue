<template>
  <div class="fp-library-container">
    <!-- 统计卡片 -->
    <div class="stats-cards">
      <el-card shadow="hover" class="stat-card">
        <div class="stat-icon total"><el-icon><Document /></el-icon></div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.total }}</div>
          <div class="stat-label">误报总数</div>
        </div>
      </el-card>
      <el-card shadow="hover" class="stat-card">
        <div class="stat-icon recent"><el-icon><Clock /></el-icon></div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.recentCount }}</div>
          <div class="stat-label">本周新增</div>
        </div>
      </el-card>
      <el-card shadow="hover" class="stat-card" v-for="item in topByTypes" :key="item.type">
        <div class="stat-icon type"><el-icon><Collection /></el-icon></div>
        <div class="stat-content">
          <div class="stat-value">{{ item.count }}</div>
          <div class="stat-label">{{ getIssueTypeLabel(item.type) }}</div>
        </div>
      </el-card>
      <div class="stat-card stat-card--placeholder" v-for="i in statCardSlots" :key="'slot-' + i"></div>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <el-select v-model="queryParams.issueType" placeholder="问题分类" clearable size="default" style="width:130px">
          <el-option v-for="t in issueTypes" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>
        <el-input v-model="queryParams.keyword" placeholder="搜索原文/误报原因..." clearable size="default" style="width:220px" @keyup.enter="handleSearch">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button @click="handleReset"><el-icon><RefreshRight /></el-icon> 重置</el-button>
      </div>
      <div class="toolbar-right">
        <el-button type="primary" @click="handleExport" :loading="exporting" :disabled="pagination.total === 0">
          <el-icon><Download /></el-icon>
          导出 Excel
          <span v-if="pagination.total > 0" class="export-count">({{ pagination.total }})</span>
        </el-button>
      </div>
    </div>

    <!-- 数据表格 -->
    <div class="table-container">
      <el-table :data="tableData" v-loading="loading" stripe border row-class-name="fp-row-clickable" @row-click="handleRowClick">
        <el-table-column type="index" label="序号" width="50" align="center" />
        <el-table-column prop="originalText" label="原文" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="original-text-cell">{{ row.originalText }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="fpReason" label="误报原因" min-width="150" show-overflow-tooltip />
        <el-table-column prop="issueType" label="问题分类" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" type="warning" effect="plain">{{ getIssueTypeLabel(row.issueType) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="ruleCode" label="规则代码" width="100" align="center">
          <template #default="{ row }">
            <span v-if="row.ruleCode" class="rule-code">{{ row.ruleCode }}</span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="severity" label="严重度" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="getSeverityType(row.severity)" size="small" effect="plain">
              {{ getSeverityLabel(row.severity) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="markedByName" label="标记人" width="90" align="center" />
        <el-table-column prop="count" label="标记次数" width="80" align="center">
          <template #default="{ row }">
            <span class="count-number">{{ row.count ?? 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="lastMarkedAt" label="最后标记" width="160" align="center">
          <template #default="{ row }">
            {{ formatDate(row.lastMarkedAt) }}
          </template>
        </el-table-column>
        <!-- 操作列：仅 ADMIN/MANAGER 可见 -->
        <el-table-column v-if="canManage" label="操作" width="80" align="center" fixed="right">
          <template #default="{ row }">
            <el-button type="danger" size="small" link @click.stop="handleDelete(row)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </template>
        </el-table-column>

        <!-- 空状态（自定义） -->
        <template #empty>
          <div class="custom-empty-state">
            <div class="empty-illustration">
              <el-icon :size="48"><DocumentChecked /></el-icon>
            </div>
            <p class="empty-title">暂无误报记录</p>
            <p class="empty-desc">在审查结果中标记为「误报」的条目会自动汇总到这里</p>
            <router-link to="/review" class="empty-action">
              去审查页看看
              <el-icon><ArrowRight /></el-icon>
            </router-link>
          </div>
        </template>
      </el-table>

      <!-- 分页 -->
      <div class="pagination-container">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="pagination.total"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSizeChange"
          @current-change="handlePageChange"
        />
      </div>
    </div>

    <!-- 详情抽屉 -->
    <el-dialog v-model="detailVisible" title="误报记录详情" width="560px" destroy-on-close>
      <div class="detail-body" v-if="currentDetail">
        <div class="detail-section">
          <h4 class="detail-section-title">原文内容</h4>
          <div class="detail-original-text">{{ currentDetail.originalText }}</div>
        </div>
        <div class="detail-section">
          <h4 class="detail-section-title">误报原因</h4>
          <div class="detail-reason">{{ currentDetail.fpReason || '未填写' }}</div>
        </div>
        <div class="detail-meta-grid">
          <div class="meta-item">
            <span class="meta-label">问题分类</span>
            <el-tag size="small" type="warning" effect="plain">{{ getIssueTypeLabel(currentDetail.issueType) }}</el-tag>
          </div>
          <div class="meta-item">
            <span class="meta-label">规则代码</span>
            <span>{{ currentDetail.ruleCode || '-' }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">严重度</span>
            <el-tag :type="getSeverityType(currentDetail.severity)" size="small" effect="plain">
              {{ getSeverityLabel(currentDetail.severity) }}
            </el-tag>
          </div>
          <div class="meta-item">
            <span class="meta-label">标记人</span>
            <span>{{ currentDetail.markedByName || '-' }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">标记次数</span>
            <span>{{ currentDetail.count ?? 0 }} 次</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">最后标记时间</span>
            <span>{{ formatDate(currentDetail.lastMarkedAt) }}</span>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button v-if="canManage" type="danger" @click="handleDeleteFromDetail">删除此条记录</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, h } from 'vue'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const canManage = computed(() => userStore.isAdminOrManager())
import { Document, Clock, Collection, Search, RefreshRight, Download, Delete, DocumentChecked, ArrowRight } from '@element-plus/icons-vue'
import {
  getFpLibraryListApi,
  getFpLibraryStatsApi,
  deleteFpLibraryItemApi,
  exportFpLibraryApi,
  type FpLibraryItem,
  type FpLibraryStats,
} from '@/api/false-positive-library'

const loading = ref(false)
const exporting = ref(false)
const tableData = ref<FpLibraryItem[]>([])

const detailVisible = ref(false)
const currentDetail = ref<FpLibraryItem | null>(null)

const stats = ref<FpLibraryStats>({
  total: 0,
  recentCount: 0,
  byType: [],
})

const MAX_TYPE_CARDS = 3
const topByTypes = computed(() => {
  return [...stats.value.byType]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_TYPE_CARDS)
})

const statCardSlots = computed(() => {
  const filled = 2 + topByTypes.value.length
  return Math.max(0, 5 - filled)
})

const queryParams = reactive({
  issueType: '',
  keyword: '',
})

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0,
})

const issueTypes = [
  { value: 'VIOLATION', label: '合规违规' },
  { value: 'CONSISTENCY', label: '一致性' },
  { value: 'COMPLETENESS', label: '完整性' },
  { value: 'TYPO', label: '文本错误' },
]

const getIssueTypeLabel = (type?: string): string => {
  if (!type) return '-'
  const item = issueTypes.find((t) => t.value === type)
  return item ? item.label : type
}

const getSeverityLabel = (s?: string): string => {
  if (!s) return '-'
  return s === 'error' ? '错误' : s === 'warning' ? '警告' : '提示'
}

const getSeverityType = (s?: string): any => {
  if (!s) return 'info'
  return s === 'error' ? 'danger' : s === 'warning' ? 'warning' : 'info'
}

const formatDate = (dateStr?: string): string => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const fetchStats = async () => {
  try {
    const { data } = await getFpLibraryStatsApi()
    stats.value = data
  } catch (e) {
    console.error('获取统计数据失败', e)
  }
}

const fetchData = async () => {
  loading.value = true
  try {
    const { data } = await getFpLibraryListApi({
      ...queryParams,
      page: pagination.page,
      pageSize: pagination.pageSize,
    })
    tableData.value = data.records
    pagination.total = data.total
  } catch (e) {
    console.error('获取数据失败', e)
  } finally {
    loading.value = false
  }
}

const handleSearch = () => {
  pagination.page = 1
  fetchData()
}

const handleReset = () => {
  queryParams.issueType = ''
  queryParams.keyword = ''
  pagination.page = 1
  fetchData()
}

const handlePageChange = (page: number) => {
  pagination.page = page
  fetchData()
}

const handleSizeChange = (size: number) => {
  pagination.pageSize = size
  pagination.page = 1
  fetchData()
}

const pendingUndo = ref<{ row: FpLibraryItem; timer: ReturnType<typeof setTimeout> } | null>(null)

const handleDelete = async (row: FpLibraryItem) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除误报记录"${row.originalText.slice(0, 30)}..."吗？`,
      '确认删除',
      { type: 'warning' }
    )
    await deleteFpLibraryItemApi(row.id)

    const preview = row.originalText.length > 20 ? row.originalText.slice(0, 20) + '...' : row.originalText

    const notification = ElNotification.success({
      title: '删除成功',
      message: h('span', { style: 'display:flex;align-items:center;gap:8px' }, [
        h('span', `已删除「${preview}」`),
        h('a', {
          style: 'color:#409eff;cursor:pointer;font-weight:600;text-decoration:underline',
          onClick: () => {
            notification.close()
          }
        }, '知道了'),
      ]),
      duration: 4000,
      position: 'bottom-right',
    })

    fetchData()
    fetchStats()
  } catch (e: any) {
    if (e !== 'cancel') {
      console.error('删除失败', e)
    }
  }
}

const handleRowClick = (row: FpLibraryItem) => {
  currentDetail.value = row
  detailVisible.value = true
}

const handleDeleteFromDetail = async () => {
  if (!currentDetail.value) return
  await handleDelete(currentDetail.value)
  detailVisible.value = false
}

const handleExport = async () => {
  exporting.value = true
  try {
    const response = await exportFpLibraryApi(queryParams) as any
    const blob = response.data
    const filename = `误报标记库_${new Date().toISOString().slice(0, 10)}.xlsx`
    
    // 创建下载链接
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    
    ElMessage.success('导出成功')
  } catch (e) {
    console.error('导出失败', e)
    ElMessage.error('导出失败')
  } finally {
    exporting.value = false
  }
}

let keywordTimer: ReturnType<typeof setTimeout> | null = null
watch(() => queryParams.keyword, (val) => {
  if (keywordTimer) clearTimeout(keywordTimer)
  keywordTimer = setTimeout(() => {
    pagination.page = 1
    fetchData()
  }, 400)
})

onMounted(() => {
  fetchStats()
  fetchData()
})
</script>

<style scoped>
.fp-library-container {
  padding: 16px;
}

/* 统计卡片 */
.stats-cards {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.stat-card {
  flex: 1;
  min-width: 160px;
}

.stat-card--placeholder {
  visibility: hidden;
  pointer-events: none;
}

.stat-card :deep(.el-card__body) {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}

.stat-icon.total {
  background: #ecf5ff;
  color: #409eff;
}

.stat-icon.recent {
  background: #f0f9eb;
  color: #67c23a;
}

.stat-icon.type {
  background: #fdf6ec;
  color: #e6a23c;
}

.stat-content {
  flex: 1;
}

.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--corp-text-primary);
  line-height: 1.2;
}

.stat-label {
  font-size: 13px;
  color: var(--corp-text-secondary);
  margin-top: 4px;
}

/* 工具栏 */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding: 12px 16px;
  background: var(--bg-surface);
  border-radius: var(--corp-radius-md);
  border: 1px solid var(--corp-border-light);
}

.toolbar-left {
  display: flex;
  gap: 10px;
  align-items: center;
}

.toolbar-right {
  display: flex;
  gap: 10px;
}

/* 表格容器 */
.table-container {
  background: var(--bg-surface);
  border-radius: var(--corp-radius-md);
  border: 1px solid var(--corp-border-light);
  overflow: hidden;
}

.original-text-cell {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--corp-text-regular);
}

.rule-code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--color-gray-100);
  padding: 2px 8px;
  border-radius: 4px;
}

.text-muted {
  color: var(--corp-text-placeholder);
}

/* 分页 */
.pagination-container {
  display: flex;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--corp-border-light);
}

/* 可点击行 */
:deep(.fp-row-clickable) {
  cursor: pointer;
}

:deep(.fp-row-clickable:hover > td) {
  background-color: #f5f7fa !important;
}

/* 自定义空状态 */
.custom-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
}

.empty-illustration {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, #f0f9ff, #e0f2fe);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #3b82f6;
  margin-bottom: 16px;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--corp-text-primary);
  margin: 0 0 8px;
}

.empty-desc {
  font-size: 14px;
  color: var(--corp-text-secondary);
  margin: 0 0 20px;
  max-width: 320px;
  text-align: center;
  line-height: 1.5;
}

.empty-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #3b82f6;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  padding: 8px 18px;
  border-radius: 8px;
  border: 1px solid #bfdbfe;
  background: #eff6ff;
  transition: all 0.2s ease;
}

.empty-action:hover {
  background: #dbeafe;
  border-color: #93c5fd;
}

/* 详情抽屉 */
.detail-body {
  padding: 0 4px;
}

.detail-section {
  margin-bottom: 20px;
}

.detail-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--corp-text-secondary);
  margin: 0 0 8px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.detail-original-text,
.detail-reason {
  font-size: 14px;
  line-height: 1.7;
  color: var(--corp-text-primary);
  padding: 12px 16px;
  background: #f9fafb;
  border-radius: 8px;
  border: 1px solid var(--corp-border-light);
  word-break: break-all;
}

.detail-reason {
  color: var(--corp-text-regular);
}

.detail-meta-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--corp-text-primary);
}

.meta-label {
  color: var(--corp-text-secondary);
  white-space: nowrap;
  min-width: 72px;
}

/* 计数数字 */
.count-number {
  font-weight: 600;
  color: var(--corp-text-primary);
}

.export-count {
  font-size: 12px;
  opacity: 0.85;
}
</style>
