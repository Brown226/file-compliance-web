<template>
  <div class="audit-logs">
    <div class="header">
      <h2>系统操作审计日志</h2>
    </div>

    <!-- 过滤栏 -->
    <div class="filter-bar">
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
          <el-select
            v-model="filters.action"
            placeholder="请选择操作类型"
            clearable
            @change="fetchLogs"
            style="width: 200px"
          >
            <el-option label="POST (创建)" value="POST" />
            <el-option label="PUT (修改)" value="PUT" />
            <el-option label="DELETE (删除)" value="DELETE" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="fetchLogs">查询</el-button>
          <el-button @click="resetFilter">重置</el-button>
          <el-button type="success" plain @click="handleExportCsv" :loading="exporting">导出CSV</el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 数据表格 -->
    <el-table :data="tableData" style="width: 100%" v-loading="loading" border stripe>
      <el-table-column prop="user" label="操作人" width="120">
        <template #default="{ row }">
          {{ row.user?.name || row.user?.username || '-' }}
        </template>
      </el-table-column>
      <el-table-column prop="action" label="操作类型" width="120">
        <template #default="{ row }">
          <el-tag :type="getActionTypeStyle(row.action)" size="small">
            {{ row.action }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="resource" label="操作资源" min-width="200" show-overflow-tooltip />
      <el-table-column prop="ipAddress" label="IP地址" width="150" />
      <el-table-column prop="createdAt" label="操作时间" width="180">
        <template #default="{ row }">
          {{ formatTime(row.createdAt) }}
        </template>
      </el-table-column>
      <el-table-column prop="details" label="操作详情" min-width="250" show-overflow-tooltip>
        <template #default="{ row }">
          {{ formatDetails(row.details) }}
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
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

const getActionTypeStyle = (type: string) => {
  const map: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
    POST: 'success',
    PUT: 'warning',
    DELETE: 'danger',
  }
  return map[type] || 'info'
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
    // 适配审查平台后端返回格式
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
    // 如果 MaxKB 没有 /system/log 端点，显示空数据
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
    // 如果后端接口不可用，前端手动导出当前页数据
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
  padding: 0;
  background-color: transparent;
  border-radius: 0;
  box-shadow: none;
}

.header {
  margin-bottom: 24px;
}

.header h2 {
  margin: 0;
  font-size: 20px;
  color: var(--corp-text-primary);
  font-weight: 600;
}

.filter-bar {
  margin-bottom: 20px;
  padding: 16px;
  background-color: var(--corp-bg-panel);
  border: 1px solid var(--corp-border-light);
  border-radius: 8px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.05);
}

.filter-form {
  display: flex;
  flex-wrap: wrap;
}

::deep(.el-form--inline .el-form-item) {
  margin-bottom: 0;
  margin-right: 24px;
}

.pagination-container {
  margin-top: 24px;
  display: flex;
  justify-content: flex-end;
}
</style>
