<template>
  <div class="standard-library-container">
    <!-- 导入弹窗 -->
    <NormativeImportDialog
      v-model="importDialogVisible"
      @success="handleImportSuccess"
    />

    <!-- 数据管理区域 -->
    <el-card shadow="never" class="manage-card">
      <template #header>
        <div class="card-header">
          <span class="header-title">
            <el-icon><Document /></el-icon> 标准库列表
            <span class="total-badge">共 {{ total }} 条</span>
          </span>
          <div class="header-actions">
            <el-input
              v-model="searchKeyword"
              placeholder="搜索标准编号或名称"
              clearable
              style="width: 200px;"
              @keyup.enter="handleSearch"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
            <el-select v-model="filterStatus" placeholder="状态筛选" clearable style="width: 120px;" @change="handleSearch">
              <el-option label="全部状态" value="" />
              <el-option label="现行" value="CURRENT" />
              <el-option label="即将实施" value="UPCOMING" />
              <el-option label="已废止" value="ABOLISHED" />
            </el-select>
            <el-button type="primary" size="small" @click="handleSearch">
              <el-icon><Search /></el-icon> 搜索
            </el-button>
            <el-button size="small" @click="handleReset">重置</el-button>
            <el-divider direction="vertical" />
            <!-- 导入/下载按钮：仅 ADMIN/MANAGER 可见 -->
            <template v-if="canManage">
              <el-button type="primary" plain size="small" @click="openImportDialog">
                <el-icon><Upload /></el-icon> 导入 Excel
              </el-button>
              <el-button plain size="small" @click="handleDownloadTemplate">
                <el-icon><Download /></el-icon> 下载模板
              </el-button>
            </template>
          </div>
        </div>
      </template>

      <!-- 数据表格 -->
      <el-table
        v-loading="tableLoading"
        :data="tableData"
        border
        size="small"
        max-height="calc(100vh - 280px)"
        style="width: 100%; margin-top: 12px;"
        @selection-change="handleSelectionChange"
      >
        <el-table-column v-if="canManage" type="selection" width="45" />
        <el-table-column prop="standardNo" label="标准编号" min-width="150" fixed>
          <template #default="{ row }">
            <span class="standard-no">{{ row.standardNo || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="standardName" label="标准名称" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="standard-name">{{ row.standardName || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="standardIdent" label="标识符" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.standardIdent" size="small" type="info">{{ row.standardIdent }}</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="standardStatus" label="状态" width="90">
          <template #default="{ row }">
            <el-tag
              size="small"
              :type="row.standardStatus === 'CURRENT' ? 'success' : row.standardStatus === 'UPCOMING' ? 'warning' : 'info'"
            >
              {{ statusLabel(row.standardStatus) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="publishDate" label="发布日期" width="110">
          <template #default="{ row }">
            {{ formatDate(row.publishDate) }}
          </template>
        </el-table-column>
        <el-table-column prop="implementDate" label="实施日期" width="110">
          <template #default="{ row }">
            {{ formatDate(row.implementDate) }}
          </template>
        </el-table-column>
        <el-table-column prop="isActive" label="启用状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.isActive ? 'success' : 'info'" size="small">
              {{ row.isActive ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <!-- 操作列：仅 ADMIN/MANAGER 可见 -->
        <el-table-column v-if="canManage" label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="handleEdit(row)">
              <el-icon><Edit /></el-icon> 编辑
            </el-button>
            <el-button type="danger" link size="small" @click="handleDelete(row)">
              <el-icon><Delete /></el-icon> 删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页和操作栏 -->
      <div class="pagination-wrapper">
        <div class="left-actions">
          <div class="batch-actions" v-if="canManage && selectedRows.length > 0">
            <el-tag type="info" effect="plain" size="small">已选 {{ selectedRows.length }} 项</el-tag>
            <el-button type="success" size="small" @click="handleBatchEnable">
              <el-icon><CircleCheck /></el-icon> 批量启用
            </el-button>
            <el-button type="warning" size="small" @click="handleBatchDisable">
              <el-icon><CloseBold /></el-icon> 批量禁用
            </el-button>
            <el-button type="danger" size="small" @click="handleBatchDelete">
              <el-icon><Delete /></el-icon> 批量删除
            </el-button>
          </div>
        </div>
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="total"
          layout="total, sizes, prev, pager, next, jumper"
          background
          @size-change="handleSizeChange"
          @current-change="handlePageChange"
        />
      </div>
    </el-card>

    <!-- 编辑对话框 -->
    <el-dialog v-model="editDialogVisible" title="编辑标准" width="500px" @close="resetEditForm">
      <el-form ref="editFormRef" :model="editForm" label-width="100px">
        <el-form-item label="标准编号" prop="standardNo" :rules="[{ required: true, message: '请输入标准编号', trigger: 'blur' }]">
          <el-input v-model="editForm.standardNo" placeholder="如 GB/T 50001-2017" />
        </el-form-item>
        <el-form-item label="标准名称" prop="standardName" :rules="[{ required: true, message: '请输入标准名称', trigger: 'blur' }]">
          <el-input v-model="editForm.standardName" placeholder="请输入标准名称" />
        </el-form-item>
        <el-form-item label="标识符" prop="standardIdent">
          <el-input v-model="editForm.standardIdent" placeholder="自动提取，如 GB/T" disabled />
        </el-form-item>
        <el-form-item label="状态" prop="standardStatus">
          <el-select v-model="editForm.standardStatus" style="width: 100%;">
            <el-option label="现行" value="CURRENT" />
            <el-option label="即将实施" value="UPCOMING" />
            <el-option label="已废止" value="ABOLISHED" />
          </el-select>
        </el-form-item>
        <el-form-item label="发布日期" prop="publishDate">
          <el-date-picker
            v-model="editForm.publishDate"
            type="date"
            placeholder="选择发布日期"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
            style="width: 100%;"
          />
        </el-form-item>
        <el-form-item label="实施日期" prop="implementDate">
          <el-date-picker
            v-model="editForm.implementDate"
            type="date"
            placeholder="选择实施日期"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
            style="width: 100%;"
          />
        </el-form-item>
        <el-form-item label="废止日期" prop="abolishDate">
          <el-date-picker
            v-model="editForm.abolishDate"
            type="date"
            placeholder="选择废止日期"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
            style="width: 100%;"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmitEdit" :loading="editLoading">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import {
  Document, Download, Upload, Search,
  Edit, Delete, CircleCheck, CloseBold,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, type FormInstance } from 'element-plus'
import {
  getStandardsApi,
  updateStandardApi,
  deleteStandardApi,
  downloadNormativeTemplateApi,
} from '@/api/standard'
import { useUserStore } from '@/stores/user'
import type { Standard } from '@/types/models'
import NormativeImportDialog from './NormativeImportDialog.vue'

const userStore = useUserStore()
const canManage = computed(() => userStore.isAdminOrManager())

// ==================== 导入弹窗相关 ====================
const importDialogVisible = ref(false)

const openImportDialog = () => {
  importDialogVisible.value = true
}

const handleImportSuccess = () => {
  fetchTableData()
}

const handleDownloadTemplate = async () => {
  try {
    const { data } = await downloadNormativeTemplateApi()
    const blob = new Blob([data], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'normative_standards_template.xlsx'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    ElMessage.success('模板下载成功')
  } catch (e) {
    console.error('下载模板失败:', e)
    ElMessage.error('下载模板失败')
  }
}

// ==================== 数据表格相关 ====================
const tableData = ref<Standard[]>([])
const tableLoading = ref(false)
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)
const searchKeyword = ref('')
const filterStatus = ref('')
const selectedRows = ref<Standard[]>([])

const fetchTableData = async () => {
  tableLoading.value = true
  try {
    const params: any = {
      page: currentPage.value,
      limit: pageSize.value,
    }
    if (searchKeyword.value) {
      params.search = searchKeyword.value
    }
    if (filterStatus.value) {
      params.isActive = filterStatus.value === 'CURRENT' ? true : filterStatus.value
    }
    const { data } = await getStandardsApi(params)
    tableData.value = data?.items || []
    total.value = data?.total || 0
  } catch (e) {
    console.error('获取数据失败:', e)
    ElMessage.error('获取数据失败')
  } finally {
    tableLoading.value = false
  }
}

const handleSearch = () => {
  currentPage.value = 1
  fetchTableData()
}

const handleReset = () => {
  searchKeyword.value = ''
  filterStatus.value = ''
  currentPage.value = 1
  fetchTableData()
}

const handlePageChange = (page: number) => {
  currentPage.value = page
  fetchTableData()
}

const handleSizeChange = (size: number) => {
  pageSize.value = size
  currentPage.value = 1
  fetchTableData()
}

const handleSelectionChange = (rows: Standard[]) => {
  selectedRows.value = rows
}

// ==================== 编辑对话框 ====================
const editDialogVisible = ref(false)
const editFormRef = ref<FormInstance>()
const editLoading = ref(false)
const currentEditId = ref('')

const editForm = reactive({
  standardNo: '',
  standardName: '',
  standardIdent: '',
  standardStatus: 'CURRENT' as 'CURRENT' | 'UPCOMING' | 'ABOLISHED',
  publishDate: '',
  implementDate: '',
  abolishDate: '',
})

const handleEdit = (row: Standard) => {
  currentEditId.value = row.id
  editForm.standardNo = row.standardNo || ''
  editForm.standardName = row.title || row.standardName || ''
  editForm.standardIdent = row.standardIdent || ''
  editForm.standardStatus = row.standardStatus || 'CURRENT'
  editForm.publishDate = row.publishDate ? formatDateToStr(row.publishDate) : ''
  editForm.implementDate = row.implementDate ? formatDateToStr(row.implementDate) : ''
  editForm.abolishDate = row.abolishDate ? formatDateToStr(row.abolishDate) : ''
  editDialogVisible.value = true
}

const resetEditForm = () => {
  editFormRef.value?.resetFields()
}

const handleSubmitEdit = async () => {
  try {
    await editFormRef.value?.validate()
  } catch {
    return
  }
  editLoading.value = true
  try {
    await updateStandardApi(currentEditId.value, {
      title: editForm.standardName,
      standardNo: editForm.standardNo,
      standardIdent: editForm.standardIdent || undefined,
      standardStatus: editForm.standardStatus,
      publishDate: editForm.publishDate || null,
      implementDate: editForm.implementDate || null,
      abolishDate: editForm.abolishDate || null,
    })
    ElMessage.success('保存成功')
    editDialogVisible.value = false
    fetchTableData()
  } catch (e: any) {
    console.error('保存失败:', e)
    ElMessage.error(e?.response?.data?.error || '保存失败')
  } finally {
    editLoading.value = false
  }
}

// ==================== 删除 ====================
const handleDelete = async (row: Standard) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除标准 "${row.standardNo || row.title}" 吗？此操作不可恢复。`,
      '删除确认',
      { type: 'warning' }
    )
    await deleteStandardApi(row.id)
    ElMessage.success('删除成功')
    fetchTableData()
  } catch (e: any) {
    if (e !== 'cancel') {
      console.error('删除失败:', e)
      ElMessage.error(e?.response?.data?.error || '删除失败')
    }
  }
}

const handleBatchDelete = async () => {
  try {
    await ElMessageBox.confirm(
      `确定要删除选中的 ${selectedRows.value.length} 条标准吗？此操作不可恢复。`,
      '批量删除确认',
      { type: 'warning' }
    )
    const deletePromises = selectedRows.value.map((row) => deleteStandardApi(row.id))
    await Promise.all(deletePromises)
    ElMessage.success(`成功删除 ${selectedRows.value.length} 条标准`)
    selectedRows.value = []
    fetchTableData()
  } catch (e: any) {
    if (e !== 'cancel') {
      console.error('批量删除失败:', e)
      ElMessage.error(e?.response?.data?.error || '批量删除失败')
    }
  }
}

// ==================== 批量启用/禁用 ====================
const handleBatchEnable = async () => {
  try {
    await ElMessageBox.confirm(
      `确定要启用选中的 ${selectedRows.value.length} 条标准吗？`,
      '批量启用确认',
      { type: 'info' }
    )
    const updatePromises = selectedRows.value.map((row) => updateStandardApi(row.id, { isActive: true }))
    await Promise.all(updatePromises)
    ElMessage.success(`成功启用 ${selectedRows.value.length} 条标准`)
    selectedRows.value = []
    fetchTableData()
  } catch (e: any) {
    if (e !== 'cancel') {
      console.error('批量启用失败:', e)
      ElMessage.error(e?.response?.data?.error || '批量启用失败')
    }
  }
}

const handleBatchDisable = async () => {
  try {
    await ElMessageBox.confirm(
      `确定要禁用选中的 ${selectedRows.value.length} 条标准吗？`,
      '批量禁用确认',
      { type: 'warning' }
    )
    const updatePromises = selectedRows.value.map((row) => updateStandardApi(row.id, { isActive: false }))
    await Promise.all(updatePromises)
    ElMessage.success(`成功禁用 ${selectedRows.value.length} 条标准`)
    selectedRows.value = []
    fetchTableData()
  } catch (e: any) {
    if (e !== 'cancel') {
      console.error('批量禁用失败:', e)
      ElMessage.error(e?.response?.data?.error || '批量禁用失败')
    }
  }
}

// ==================== 工具函数 ====================
const statusLabel = (status: string) => {
  const map: Record<string, string> = {
    CURRENT: '现行',
    UPCOMING: '即将实施',
    ABOLISHED: '已废止',
  }
  return map[status] || status || '-'
}

const formatDate = (date: any) => {
  if (!date) return '-'
  const d = new Date(date)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

const formatDateToStr = (date: any) => {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) return ''
  return d.toISOString().split('T')[0]
}

// ==================== 初始化 ====================
onMounted(() => {
  fetchTableData()
})
</script>

<style scoped>
.standard-library-container {
  padding: 0 16px 16px;
  height: calc(100vh - 140px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--el-fill-color-lighter);
}

/* 卡片 */
.manage-card {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: none;
  border-radius: 12px;
}

.manage-card :deep(.el-card__header) {
  padding: 16px 20px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: linear-gradient(135deg, var(--el-color-primary-light-9) 0%, var(--el-fill-color-light) 100%);
  border-radius: 12px 12px 0 0;
}

.manage-card :deep(.el-card__body) {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 16px 20px;
}

/* 卡片头部 */
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.header-title .el-icon {
  font-size: 22px;
  color: var(--el-color-primary);
}

.total-badge {
  display: inline-flex;
  align-items: center;
  padding: 5px 16px;
  font-size: 15px;
  font-weight: 500;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-radius: 12px;
  margin-left: 8px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

/* 分页和操作栏 */
.pagination-wrapper {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-lighter);
  flex-wrap: wrap;
  gap: 16px;
}

.left-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.batch-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.batch-actions :deep(.el-tag) {
  margin-right: 4px;
  font-size: 15px;
}

/* 文本样式 */
.standard-no {
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-color-primary);
  letter-spacing: 0.5px;
}

.standard-name {
  color: var(--el-text-color-primary);
  font-size: 15px;
}

/* 表格优化 */
.manage-card :deep(.el-table) {
  --el-table-border-color: var(--el-border-color-lighter);
  --el-table-header-bg-color: var(--el-fill-color-light);
  border-radius: 8px;
  overflow: hidden;
}

.manage-card :deep(.el-table th.el-table__cell) {
  font-weight: 600;
  font-size: 15px;
  color: var(--el-text-color-regular);
}

.manage-card :deep(.el-table td.el-table__cell) {
  font-size: 15px;
}

/* 分页器样式 */
.manage-card :deep(.el-pagination) {
  --el-pagination-font-size: 15px;
  --el-pagination-button-bg-color: var(--el-fill-color-light);
}

.manage-card :deep(.el-pagination.is-background .el-pager li:not(.is-disabled).is-active) {
  background: var(--el-color-primary);
}
</style>
