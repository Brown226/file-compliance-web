<template>
  <div class="task-history">
    <div class="header">
      <h2>审查任务列表</h2>
    </div>

    <!-- 过滤栏 -->
    <div class="filter-bar">
      <el-form :inline="true" :model="filters" class="filter-form">
        <el-form-item label="上传时间">
          <el-date-picker
            v-model="filters.dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            @change="handleFilter"
          />
        </el-form-item>
        <el-form-item label="任务状态">
          <el-select
            v-model="filters.status"
            placeholder="请选择状态"
            clearable
            @change="handleFilter"
            style="width: 200px"
          >
            <el-option label="排队中" value="queued" />
            <el-option label="审查中" value="processing" />
            <el-option label="已完成" value="completed" />
            <el-option label="失败" value="failed" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleFilter">查询</el-button>
          <el-button @click="resetFilter">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 数据表格 -->
    <el-table :data="filteredTableData" style="width: 100%" v-loading="loading">
      <el-table-column prop="jobId" label="任务ID" width="180" />
      <el-table-column prop="taskName" label="任务名称" min-width="200" show-overflow-tooltip />
      <el-table-column prop="fileCount" label="总文件数" width="120" align="center" />
      <el-table-column prop="uploadTime" label="上传时间" width="180" />
      <el-table-column prop="status" label="当前状态" width="120">
        <template #default="scope">
          <el-tag :type="getStatusType(scope.row.status)">
            {{ getStatusLabel(scope.row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="scope">
          <el-button
            type="primary"
            link
            @click="handleViewResult(scope.row)"
            :disabled="scope.row.status === 'queued' || scope.row.status === 'processing'"
          >
            查看结果
          </el-button>
          <el-button
            type="primary"
            link
            @click="handleExport(scope.row)"
            :disabled="scope.row.status !== 'completed'"
          >
            导出 Excel
          </el-button>
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
import { ref, reactive, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'

const router = useRouter()

// --- 类型定义 ---
interface TaskItem {
  jobId: string
  taskName: string
  fileCount: number
  uploadTime: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
}

// --- 状态与数据 ---
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(10)
const total = ref(6) // mock 数据总数

const filters = reactive({
  dateRange: [] as string[],
  status: ''
})

// Mock 数据
const mockData: TaskItem[] = [
  { jobId: 'JOB-20231024-001', taskName: 'A项目一期建筑图纸审查', fileCount: 15, uploadTime: '2023-10-24 10:30:00', status: 'completed' },
  { jobId: 'JOB-20231024-002', taskName: 'B项目结构图纸审查', fileCount: 8, uploadTime: '2023-10-24 11:15:00', status: 'processing' },
  { jobId: 'JOB-20231024-003', taskName: 'C小区给排水设计审查', fileCount: 22, uploadTime: '2023-10-24 14:00:00', status: 'queued' },
  { jobId: 'JOB-20231023-004', taskName: 'D商场暖通图纸审查', fileCount: 5, uploadTime: '2023-10-23 09:20:00', status: 'failed' },
  { jobId: 'JOB-20231023-005', taskName: 'E厂房电气图纸审查', fileCount: 12, uploadTime: '2023-10-23 15:45:00', status: 'completed' },
  { jobId: 'JOB-20231022-006', taskName: 'F办公楼综合审查', fileCount: 30, uploadTime: '2023-10-22 10:00:00', status: 'completed' },
]

// 模拟前端过滤逻辑 (真实场景应调用后端接口)
const filteredTableData = computed(() => {
  return mockData.filter(item => {
    // 状态过滤
    if (filters.status && item.status !== filters.status) {
      return false
    }
    // 日期过滤
    if (filters.dateRange && filters.dateRange.length === 2) {
      const uploadDate = item.uploadTime.split(' ')[0]
      const startDate = filters.dateRange[0]
      const endDate = filters.dateRange[1]
      if (uploadDate < startDate || uploadDate > endDate) {
        return false
      }
    }
    return true
  })
})

// --- 方法 ---

const getStatusType = (status: string) => {
  const map: Record<string, 'info' | 'primary' | 'success' | 'danger'> = {
    queued: 'info',
    processing: 'primary',
    completed: 'success',
    failed: 'danger'
  }
  return map[status] || 'info'
}

const getStatusLabel = (status: string) => {
  const map: Record<string, string> = {
    queued: '排队中',
    processing: '审查中',
    completed: '已完成',
    failed: '失败'
  }
  return map[status] || '未知状态'
}

const handleFilter = () => {
  ElMessage.success('执行查询')
}

const resetFilter = () => {
  filters.dateRange = []
  filters.status = ''
  handleFilter()
}

const handleViewResult = (row: TaskItem) => {
  router.push(`/tasks/${row.jobId}`)
}

const handleExport = (row: TaskItem) => {
  ElMessage.success(`开始导出任务报告: ${row.jobId}`)
}

const handleSizeChange = (val: number) => {
  console.log(`${val} items per page`)
}

const handleCurrentChange = (val: number) => {
  console.log(`current page: ${val}`)
}
</script>

<style scoped>
.task-history {
  padding: 24px;
  background-color: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}

.header {
  margin-bottom: 24px;
}

.header h2 {
  margin: 0;
  font-size: 20px;
  color: #303133;
  font-weight: 500;
}

.filter-bar {
  margin-bottom: 20px;
  padding: 16px;
  background-color: #f8f9fa;
  border-radius: 4px;
}

.filter-form {
  display: flex;
  flex-wrap: wrap;
}

/* 覆盖 Element Plus 默认样式让过滤栏更紧凑 */
:deep(.el-form--inline .el-form-item) {
  margin-bottom: 0;
  margin-right: 24px;
}

.pagination-container {
  margin-top: 24px;
  display: flex;
  justify-content: flex-end;
}
</style>

