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
            @change="handleFilter"
          />
        </el-form-item>
        <el-form-item label="操作类型">
          <el-select
            v-model="filters.actionType"
            placeholder="请选择操作类型"
            clearable
            @change="handleFilter"
            style="width: 200px"
          >
            <el-option label="登录" value="login" />
            <el-option label="上传任务" value="upload_task" />
            <el-option label="修改标准库" value="modify_standard" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleFilter">查询</el-button>
          <el-button @click="resetFilter">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 数据表格 -->
    <el-table :data="paginatedData" style="width: 100%" v-loading="loading" border stripe>
      <el-table-column prop="username" label="操作人" width="120" />
      <el-table-column prop="department" label="所属部门" width="150" />
      <el-table-column prop="actionType" label="操作类型" width="150">
        <template #default="scope">
          <el-tag :type="getActionTypeStyle(scope.row.actionType)">
            {{ getActionTypeLabel(scope.row.actionType) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="ipAddress" label="IP地址" width="150" />
      <el-table-column prop="actionTime" label="操作时间" min-width="180" />
      <el-table-column prop="details" label="操作详情" min-width="250" show-overflow-tooltip />
    </el-table>

    <!-- 分页 -->
    <div class="pagination-container">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        :total="filteredTableData.length"
        @size-change="handleSizeChange"
        @current-change="handleCurrentChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'

// --- 类型定义 ---
interface AuditLogItem {
  id: string
  username: string
  department: string
  actionType: 'login' | 'upload_task' | 'modify_standard'
  ipAddress: string
  actionTime: string
  details: string
}

// --- 状态与数据 ---
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(10)

const filters = reactive({
  dateRange: [] as string[],
  actionType: ''
})

// Mock 数据
const mockData: AuditLogItem[] = [
  { id: '1', username: '张三', department: '建筑设计部', actionType: 'login', ipAddress: '192.168.1.101', actionTime: '2023-10-25 08:30:15', details: '用户登录系统成功' },
  { id: '2', username: '李四', department: '结构工程部', actionType: 'upload_task', ipAddress: '192.168.1.105', actionTime: '2023-10-25 09:15:22', details: '上传了项目A结构图纸审查任务(JOB-20231025-001)' },
  { id: '3', username: '王五', department: '系统管理部', actionType: 'modify_standard', ipAddress: '192.168.1.200', actionTime: '2023-10-25 10:05:10', details: '修改了《建筑设计防火规范》GB 50016-2014(2018年版)' },
  { id: '4', username: '张三', department: '建筑设计部', actionType: 'upload_task', ipAddress: '192.168.1.101', actionTime: '2023-10-25 11:20:05', details: '上传了项目B建筑一期图纸审查任务(JOB-20231025-002)' },
  { id: '5', username: '赵六', department: '给排水设计部', actionType: 'login', ipAddress: '192.168.1.112', actionTime: '2023-10-25 13:30:45', details: '用户登录系统成功' },
  { id: '6', username: '钱七', department: '暖通设计部', actionType: 'login', ipAddress: '192.168.1.115', actionTime: '2023-10-25 14:00:12', details: '用户登录系统成功' },
  { id: '7', username: '钱七', department: '暖通设计部', actionType: 'upload_task', ipAddress: '192.168.1.115', actionTime: '2023-10-25 14:15:30', details: '上传了项目C暖通设计审查任务(JOB-20231025-003)' },
  { id: '8', username: '王五', department: '系统管理部', actionType: 'login', ipAddress: '192.168.1.200', actionTime: '2023-10-24 09:00:00', details: '用户登录系统成功' },
  { id: '9', username: '王五', department: '系统管理部', actionType: 'modify_standard', ipAddress: '192.168.1.200', actionTime: '2023-10-24 09:30:15', details: '新增了《无障碍设计规范》GB 50763-2012' },
  { id: '10', username: '孙八', department: '电气工程部', actionType: 'upload_task', ipAddress: '192.168.1.120', actionTime: '2023-10-24 10:45:20', details: '上传了项目D厂房电气图纸审查任务(JOB-20231024-001)' },
  { id: '11', username: '周九', department: '建筑设计部', actionType: 'login', ipAddress: '192.168.1.102', actionTime: '2023-10-24 11:10:05', details: '用户登录系统成功' },
  { id: '12', username: '吴十', department: '结构工程部', actionType: 'upload_task', ipAddress: '192.168.1.106', actionTime: '2023-10-23 15:20:40', details: '上传了项目E商场结构审查任务(JOB-20231023-001)' },
]

// 模拟前端过滤逻辑 (真实场景应调用后端接口)
const filteredTableData = computed(() => {
  return mockData.filter(item => {
    // 状态过滤
    if (filters.actionType && item.actionType !== filters.actionType) {
      return false
    }
    // 日期过滤
    if (filters.dateRange && filters.dateRange.length === 2) {
      const logDate = item.actionTime.split(' ')[0]
      const startDate = filters.dateRange[0]
      const endDate = filters.dateRange[1]
      if (logDate < startDate || logDate > endDate) {
        return false
      }
    }
    return true
  })
})

const paginatedData = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return filteredTableData.value.slice(start, end)
})

// --- 方法 ---

const getActionTypeStyle = (type: string) => {
  const map: Record<string, 'info' | 'primary' | 'success' | 'warning' | 'danger'> = {
    login: 'info',
    upload_task: 'primary',
    modify_standard: 'warning'
  }
  return map[type] || 'info'
}

const getActionTypeLabel = (type: string) => {
  const map: Record<string, string> = {
    login: '登录',
    upload_task: '上传任务',
    modify_standard: '修改标准库'
  }
  return map[type] || '未知操作'
}

const handleFilter = () => {
  currentPage.value = 1
}

const resetFilter = () => {
  filters.dateRange = []
  filters.actionType = ''
  currentPage.value = 1
}

const handleSizeChange = (val: number) => {
  pageSize.value = val
  currentPage.value = 1
}

const handleCurrentChange = (val: number) => {
  currentPage.value = val
}
</script>

<style scoped>
.audit-logs {
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
