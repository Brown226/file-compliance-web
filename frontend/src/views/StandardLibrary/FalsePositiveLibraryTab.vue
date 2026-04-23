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
      <el-card shadow="hover" class="stat-card" v-for="item in stats.byType" :key="item.type">
        <div class="stat-icon type"><el-icon><Collection /></el-icon></div>
        <div class="stat-content">
          <div class="stat-value">{{ item.count }}</div>
          <div class="stat-label">{{ getIssueTypeLabel(item.type) }}</div>
        </div>
      </el-card>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <el-select v-model="queryParams.issueType" placeholder="问题分类" clearable size="default" style="width:130px">
          <el-option v-for="t in issueTypes" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>
        <el-input v-model="queryParams.keyword" placeholder="搜索原文/误报原因..." clearable size="default" style="width:220px">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button @click="handleSearch"><el-icon><Search /></el-icon> 搜索</el-button>
        <el-button @click="handleReset"><el-icon><RefreshRight /></el-icon> 重置</el-button>
      </div>
      <div class="toolbar-right">
        <el-button type="primary" @click="handleExport" :loading="exporting">
          <el-icon><Download /></el-icon> 导出 Excel
        </el-button>
      </div>
    </div>

    <!-- 数据表格 -->
    <div class="table-container">
      <el-table :data="tableData" v-loading="loading" stripe border>
        <el-table-column type="index" label="序号" width="60" align="center" />
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
            <el-badge :value="row.count" :max="99" type="primary" />
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
            <el-button type="danger" size="small" link @click="handleDelete(row)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </template>
        </el-table-column>
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const canManage = computed(() => userStore.isAdminOrManager())
import { Document, Clock, Collection, Search, RefreshRight, Download, Delete } from '@element-plus/icons-vue'
import {
  getFpLibraryListApi,
  getFpLibraryStatsApi,
  deleteFpLibraryItemApi,
  exportFpLibraryApi,
  type FpLibraryItem,
  type FpLibraryStats,
} from '@/api/falsePositiveLibrary'

const emit = defineEmits<{
  'update:total': [value: number]
}>()

const loading = ref(false)
const exporting = ref(false)
const tableData = ref<FpLibraryItem[]>([])

const stats = ref<FpLibraryStats>({
  total: 0,
  recentCount: 0,
  byType: [],
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
  { value: 'TYPO', label: '错别字' },
  { value: 'VIOLATION', label: '合规违规' },
  { value: 'NAMING', label: '命名规范' },
  { value: 'ENCODING', label: '编码一致性' },
  { value: 'ATTRIBUTE', label: '封面属性' },
  { value: 'HEADER', label: '页眉检查' },
  { value: 'PAGE', label: '页码检查' },
  { value: 'SCAN', label: '图纸扫描' },
  { value: 'TEMPLATE', label: '模板统一' },
  { value: 'FORMAT', label: '格式规范' },
  { value: 'COMPLETENESS', label: '数据完整性' },
  { value: 'CONSISTENCY', label: '一致性' },
  { value: 'LAYOUT', label: '排版布局' },
  { value: 'STD_REF', label: '标准引用' },
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
    emit('update:total', data.total)
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

const handleDelete = async (row: FpLibraryItem) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除误报记录"${row.originalText.slice(0, 30)}..."吗？`,
      '确认删除',
      { type: 'warning' }
    )
    await deleteFpLibraryItemApi(row.id)
    ElMessage.success('删除成功')
    fetchData()
    fetchStats()
  } catch (e: any) {
    if (e !== 'cancel') {
      console.error('删除失败', e)
    }
  }
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

onMounted(() => {
  fetchStats()
  fetchData()
})
</script>

<style scoped>
.fp-library-container {
  padding: 0;
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
</style>
