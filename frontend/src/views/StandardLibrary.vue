<template>
  <div class="standard-library-container">
    <el-card class="box-card">
      <template #header>
        <div class="card-header">
          <div class="header-title">企业标准规范库</div>
          <div class="header-actions">
            <el-button type="primary" :icon="Plus" @click="openAddDialog">新增</el-button>
            <el-upload
              class="upload-demo"
              action="#"
              :show-file-list="false"
              :auto-upload="false"
              :on-change="handleMockImport"
              accept=".xls,.xlsx"
            >
              <el-button type="success" :icon="Upload">Excel 批量导入</el-button>
            </el-upload>
            <el-button type="warning" :icon="Download" @click="handleExportTemplate">导出模板</el-button>
          </div>
        </div>
      </template>

      <!-- Search / Filter (optional, but good for UX) -->
      <div class="filter-bar">
        <el-input
          v-model="searchQuery"
          placeholder="搜索标准号或内容"
          class="search-input"
          clearable
          :prefix-icon="Search"
          @input="handleSearch"
        />
      </div>

      <!-- Data Table -->
      <el-table :data="paginatedData" style="width: 100%" v-loading="loading" border>
        <el-table-column prop="standardCode" label="标准号" width="200" />
        <el-table-column prop="content" label="规范内容" />
        <el-table-column prop="version" label="版本" width="120" align="center" />
        <el-table-column prop="updateTime" label="更新时间" width="180" align="center" />
        <el-table-column label="操作" width="180" align="center" fixed="right">
          <template #default="scope">
            <el-button size="small" type="primary" link @click="openEditDialog(scope.row)">编辑</el-button>
            <el-button size="small" type="danger" link @click="handleDelete(scope.row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- Pagination -->
      <div class="pagination-container">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :background="true"
          layout="total, sizes, prev, pager, next, jumper"
          :total="filteredData.length"
          @size-change="handleSizeChange"
          @current-change="handleCurrentChange"
        />
      </div>
    </el-card>

    <!-- Add/Edit Dialog -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogType === 'add' ? '新增标准规范' : '编辑标准规范'"
      width="500px"
      @close="resetForm"
    >
      <el-form
        ref="formRef"
        :model="formData"
        :rules="rules"
        label-width="100px"
      >
        <el-form-item label="标准号" prop="standardCode">
          <el-input v-model="formData.standardCode" placeholder="请输入标准号 (如: GB 50016-2014)" />
        </el-form-item>
        <el-form-item label="规范内容" prop="content">
          <el-input
            v-model="formData.content"
            type="textarea"
            :rows="4"
            placeholder="请输入规范详细内容"
          />
        </el-form-item>
        <el-form-item label="版本" prop="version">
          <el-input v-model="formData.version" placeholder="请输入版本 (如: 2018年版)" />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" @click="submitForm" :loading="submitLoading">
            确认
          </el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { Plus, Upload, Download, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'

// --- Interfaces ---
interface StandardItem {
  id: string
  standardCode: string
  content: string
  version: string
  updateTime: string
}

// --- Mock Data ---
const generateMockData = (): StandardItem[] => {
  const data: StandardItem[] = []
  for (let i = 1; i <= 55; i++) {
    data.push({
      id: `STD-${1000 + i}`,
      standardCode: `GB 50016-201${i % 10}`,
      content: `建筑设计防火规范 - 第 ${i} 条相关说明及要求内容，本条款详细说明了建筑防火设计的相关规定。`,
      version: `201${i % 10}年版`,
      updateTime: `2023-10-${String((i % 28) + 1).padStart(2, '0')} 10:00:00`
    })
  }
  return data
}

// --- State ---
const loading = ref(false)
const tableData = ref<StandardItem[]>([])
const searchQuery = ref('')

const currentPage = ref(1)
const pageSize = ref(10)

const dialogVisible = ref(false)
const dialogType = ref<'add' | 'edit'>('add')
const submitLoading = ref(false)
const formRef = ref<FormInstance>()

const formData = reactive({
  id: '',
  standardCode: '',
  content: '',
  version: ''
})

const rules = reactive<FormRules>({
  standardCode: [
    { required: true, message: '请输入标准号', trigger: 'blur' }
  ],
  content: [
    { required: true, message: '请输入规范内容', trigger: 'blur' }
  ],
  version: [
    { required: true, message: '请输入版本', trigger: 'blur' }
  ]
})

// --- Computed ---
const filteredData = computed(() => {
  if (!searchQuery.value) return tableData.value
  const query = searchQuery.value.toLowerCase()
  return tableData.value.filter(item => 
    item.standardCode.toLowerCase().includes(query) || 
    item.content.toLowerCase().includes(query)
  )
})

const paginatedData = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return filteredData.value.slice(start, end)
})

// --- Lifecycle ---
onMounted(() => {
  loading.value = true
  setTimeout(() => {
    tableData.value = generateMockData()
    loading.value = false
  }, 500)
})

// --- Methods ---
const handleSearch = () => {
  currentPage.value = 1
}

const handleSizeChange = (val: number) => {
  pageSize.value = val
  currentPage.value = 1
}

const handleCurrentChange = (val: number) => {
  currentPage.value = val
}

const openAddDialog = () => {
  dialogType.value = 'add'
  dialogVisible.value = true
}

const openEditDialog = (row: StandardItem) => {
  dialogType.value = 'edit'
  Object.assign(formData, row)
  dialogVisible.value = true
}

const resetForm = () => {
  if (formRef.value) {
    formRef.value.resetFields()
  }
  formData.id = ''
  formData.standardCode = ''
  formData.content = ''
  formData.version = ''
}

const submitForm = async () => {
  if (!formRef.value) return
  
  await formRef.value.validate((valid) => {
    if (valid) {
      submitLoading.value = true
      
      // Simulate API call
      setTimeout(() => {
        const now = new Date().toISOString().replace('T', ' ').substring(0, 19)
        
        if (dialogType.value === 'add') {
          const newItem: StandardItem = {
            id: `STD-${Date.now()}`,
            standardCode: formData.standardCode,
            content: formData.content,
            version: formData.version,
            updateTime: now
          }
          tableData.value.unshift(newItem)
          ElMessage.success('新增成功')
        } else {
          const index = tableData.value.findIndex(item => item.id === formData.id)
          if (index !== -1) {
            tableData.value[index] = {
              ...tableData.value[index],
              standardCode: formData.standardCode,
              content: formData.content,
              version: formData.version,
              updateTime: now
            }
            ElMessage.success('编辑成功')
          }
        }
        
        submitLoading.value = false
        dialogVisible.value = false
      }, 500)
    }
  })
}

const handleDelete = (row: StandardItem) => {
  ElMessageBox.confirm(
    `确认删除标准号为 "${row.standardCode}" 的规范吗？`,
    '警告',
    {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    }
  ).then(() => {
    const index = tableData.value.findIndex(item => item.id === row.id)
    if (index !== -1) {
      tableData.value.splice(index, 1)
      ElMessage.success('删除成功')
      
      // Handle page boundary when deleting the last item on the page
      if (paginatedData.value.length === 0 && currentPage.value > 1) {
        currentPage.value -= 1
      }
    }
  }).catch(() => {
    // cancelled
  })
}

const handleMockImport = (file: any) => {
  ElMessage.success(`模拟成功导入文件: ${file.name}`)
}

const handleExportTemplate = () => {
  ElMessage.success('模板导出成功 (模拟)')
}

</script>

<style scoped>
.standard-library-container {
  padding: 20px;
}

.box-card {
  width: 100%;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-title {
  font-size: 18px;
  font-weight: bold;
}

.header-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.upload-demo {
  display: inline-block;
}

.filter-bar {
  margin-bottom: 20px;
}

.search-input {
  width: 300px;
}

.pagination-container {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}
</style>
