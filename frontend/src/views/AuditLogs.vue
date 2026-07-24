<template>
  <div class="audit-logs">
    <div class="page-intro">
      <h3>系统操作审计日志</h3>
      <p>记录所有管理员和用户对系统配置的变更操作，支持按时间和操作类型筛选导出。</p>
    </div>

    <!-- 过滤栏 -->
    <section class="filter-card">
      <el-form :inline="true" :model="filters" class="filter-form">
        <el-form-item label="操作时间">
          <el-date-picker
            v-model="filters.dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            @change="fetchLogs"
          />
        </el-form-item>
        <el-form-item label="操作类型">
          <el-select v-model="filters.action" placeholder="全部" clearable @change="fetchLogs">
            <el-option label="全部" value="" />
            <el-option label="POST (创建)" value="POST" />
            <el-option label="PUT (修改)" value="PUT" />
            <el-option label="PATCH (部分更新)" value="PATCH" />
            <el-option label="DELETE (删除)" value="DELETE" />
          </el-select>
        </el-form-item>
        <div class="filter-actions">
          <el-button type="primary" @click="fetchLogs" :icon="Search">查询</el-button>
          <el-button @click="resetFilter" :icon="Refresh">重置</el-button>
          <el-button @click="handleExportCsv" :loading="exporting" :icon="Download">导出 CSV</el-button>
        </div>
      </el-form>
    </section>

    <!-- 数据表格 -->
    <section class="table-card">
      <div class="table-summary">
        <span class="summary-label">共</span>
        <span class="summary-value">{{ total }}</span>
        <span class="summary-label">条记录</span>
      </div>
      <el-table :data="tableData" v-loading="loading" stripe class="audit-table">
        <el-table-column prop="user" label="操作人" width="120">
          <template #default="{ row }">
            <div class="user-cell">
              <span class="user-name">{{ row.user?.name || row.user?.username || '-' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作类型" width="100">
          <template #default="{ row }">
            <span class="action-badge" :class="getActionClass(row.action)">
              {{ row.action }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="resource" label="操作资源" min-width="220" show-overflow-tooltip />
        <el-table-column prop="ipAddress" label="IP 地址" width="140" />
        <el-table-column label="操作时间" width="170">
          <template #default="{ row }">
            <span class="time-cell">{{ formatTime(row.createdAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作详情" min-width="260" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="details-cell">{{ formatDetails(row.details) }}</span>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination-container">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
          @size-change="handleSizeChange"
          @current-change="handleCurrentChange"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Refresh, Download } from '@element-plus/icons-vue'
import { getAuditLogsApi, exportAuditLogsApi } from '@/api/audit'
import { useFormatTime } from '@/composables/useFormatTime'

const { formatTime } = useFormatTime()

const loading = ref(false)
const exporting = ref(false)
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(0)
const tableData = ref<any[]>([])

const filters = reactive({
  dateRange: [] as string[],
  action: ''
})

const getActionClass = (type: string) => {
  const map: Record<string, string> = {
    POST: 'create',
    PUT: 'update',
    PATCH: 'patch',
    DELETE: 'delete'
  }
  return map[type] || 'default'
}

const formatDetails = (details: any) => {
  if (!details) return '-'
  if (typeof details === 'string') return details
  try {
    const obj = typeof details === 'object' ? details : JSON.parse(details)
    const parts: string[] = []
    if (obj.statusCode) parts.push(`状态码: ${obj.statusCode}`)
    if (obj.body) {
      const bodyStr = JSON.stringify(obj.body)
      if (bodyStr.length > 100) parts.push(`请求体: ${bodyStr.substring(0, 100)}...`)
      else parts.push(`请求体: ${bodyStr}`)
    }
    return parts.join(' | ') || JSON.stringify(obj).substring(0, 200)
  } catch {
    return String(details).substring(0, 200)
  }
}

const fetchLogs = async () => {
  loading.value = true
  try {
    const { data } = await getAuditLogsApi({
      page: currentPage.value,
      limit: pageSize.value,
      action: filters.action || undefined,
    })
    tableData.value = (data?.items || []).map((log: any) => ({
      user: { name: log.user?.name || log.user?.username || '-', username: log.user?.username || '-' },
      action: log.action || '-',
      resource: log.resource || '-',
      ipAddress: log.ipAddress || '-',
      createdAt: log.createdAt,
      details: log.details,
    }))
    total.value = data?.total || 0
  } catch (e) {
    tableData.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

const resetFilter = () => {
  filters.dateRange = []
  filters.action = ''
  currentPage.value = 1
  fetchLogs()
}

const handleSizeChange = () => {
  currentPage.value = 1
  fetchLogs()
}

const handleCurrentChange = () => {
  fetchLogs()
}

const handleExportCsv = async () => {
  exporting.value = true
  try {
    const params: any = {
      action: filters.action || undefined,
      startDate: filters.dateRange?.[0] || undefined,
      endDate: filters.dateRange?.[1] || undefined,
    }
    const { data } = await exportAuditLogsApi(params)
    const blob = new Blob([data as any], { type: 'text/csv;charset=utf-8' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `审计日志_${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  } catch (e: any) {
    try {
      const headers = ['操作人', '操作类型', '操作资源', 'IP地址', '操作时间', '操作详情']
      const rows = tableData.value.map((row: any) => [
        row.user?.name || row.user?.username || '-',
        row.action || '-',
        row.resource || '-',
        row.ipAddress || '-',
        formatTime(row.createdAt) || '-',
        typeof row.details === 'string' ? row.details : JSON.stringify(row.details || '').substring(0, 200),
      ])
      const BOM = '\uFEFF'
      const csvContent = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
      const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `审计日志_${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      window.URL.revokeObjectURL(url)
      ElMessage.success('已导出当前页数据')
    } catch {
      ElMessage.error('导出失败')
    }
  } finally {
    exporting.value = false
  }
}

onMounted(() => {
  fetchLogs()
})
</script>

<style scoped>
.audit-logs {
  padding: 20px 24px 32px;
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-intro {
  padding: 4px 0 4px 12px;
  border-left: 3px solid #2563eb;
}

.page-intro h3 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: #0f172a;
}

.page-intro p {
  margin: 0;
  font-size: 12.5px;
  color: #64748b;
  line-height: 1.5;
}

/* 过滤卡片 */
.filter-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  padding: 16px 20px;
}

.filter-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
}

.filter-form :deep(.el-form-item) {
  margin: 0;
}

.filter-actions {
  display: flex;
  gap: 10px;
  margin-left: auto;
}

/* 表格卡片 */
.table-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  overflow: hidden;
}

.table-summary {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 20px;
  border-bottom: 1px solid #f1f5f9;
  background: #fafbfc;
}

.summary-label {
  font-size: 12px;
  color: #64748b;
}

.summary-value {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}

.audit-table {
  --el-table-header-bg-color: #fafbfc;
}

.user-cell {
  display: flex;
  align-items: center;
}

.user-name {
  font-weight: 500;
  color: #0f172a;
}

.action-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 48px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid transparent;
}

.action-badge.create {
  background: #f0fdf4;
  color: #15803d;
  border-color: #bbf7d0;
}

.action-badge.update {
  background: #fffbeb;
  color: #b45309;
  border-color: #fde68a;
}

.action-badge.patch {
  background: #eff6ff;
  color: #2563eb;
  border-color: #bfdbfe;
}

.action-badge.delete {
  background: #fef2f2;
  color: #b91c1c;
  border-color: #fecaca;
}

.action-badge.default {
  background: #f1f5f9;
  color: #64748b;
  border-color: #e2e8f0;
}

.time-cell {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12.5px;
  color: #475569;
}

.details-cell {
  color: #475569;
  font-size: 13px;
}

/* 分页 */
.pagination-container {
  padding: 12px 20px;
  border-top: 1px solid #f1f5f9;
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 860px) {
  .filter-actions {
    width: 100%;
    margin-left: 0;
  }
}
</style>
