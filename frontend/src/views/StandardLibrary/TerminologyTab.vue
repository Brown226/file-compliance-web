<template>
  <div class="terminology-container">
    <div class="terminology-layout">
      <!-- 左侧分类 -->
      <div class="terminology-sidebar">
        <el-card class="terminology-sidebar-card">
          <template #header>
            <div class="folder-header">
              <span class="folder-title">术语分类</span>
              <el-tag size="small" type="info">{{ terminologyTotal }} 词</el-tag>
            </div>
          </template>
          <div class="folder-tree-wrapper">
            <div
              class="folder-node"
              :class="{ active: !termFilterCategory }"
              @click="termFilterCategory = ''"
            >
              <el-icon><Files /></el-icon>
              <span class="folder-name">全部分类</span>
              <span class="folder-count">{{ terminologyTotal }}</span>
            </div>
            <div
              v-for="cat in terminologyCategories"
              :key="cat.category"
              class="folder-node"
              :class="{ active: termFilterCategory === cat.category }"
              @click="termFilterCategory = cat.category"
            >
              <el-icon><Folder /></el-icon>
              <span class="folder-name">{{ cat.category }}</span>
              <span class="folder-count">{{ cat.count }}</span>
            </div>
          </div>
        </el-card>
      </div>

      <!-- 右侧术语列表 -->
      <div class="terminology-main">
        <el-card>
          <template #header>
            <div class="card-header">
              <div class="header-title">
                {{ termFilterCategory || '白名单术语库' }}
              </div>
              <div class="header-actions">
                <el-input
                  v-model="termSearchQuery"
                  placeholder="搜索术语或别名"
                  class="search-input"
                  clearable
                  :prefix-icon="Search"
                  @input="handleTermSearch"
                  @clear="handleTermSearch"
                  style="width:200px"
                />
                <!-- 新增按钮：仅 ADMIN/MANAGER 可见 -->
                <el-button v-if="canManage" type="primary" :icon="Plus" @click="openTermDialog('add')">新增术语</el-button>
              </div>
            </div>
          </template>

          <el-table :data="terminologyList" style="width:100%" v-loading="terminologyLoading" border>
            <el-table-column prop="term" label="术语" width="200" />
            <el-table-column prop="category" label="分类" width="120" align="center">
              <template #default="{ row }">
                <el-tag size="small" :type="termCategoryTagType(row.category)">{{ row.category }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="别名" min-width="280">
              <template #default="{ row }">
                <template v-if="row.aliases?.length">
                  <el-tag v-for="(alias, i) in row.aliases.slice(0, 5)" :key="i" size="small" type="info" style="margin:2px 4px 2px 0;">{{ alias }}</el-tag>
                  <el-tag v-if="row.aliases.length > 5" size="small" type="info" style="margin:2px;">+{{ row.aliases.length - 5 }}</el-tag>
                </template>
                <span v-else style="color:var(--el-text-color-secondary);">—</span>
              </template>
            </el-table-column>
            <el-table-column prop="isBuiltin" label="类型" width="80" align="center">
              <template #default="{ row }">
                <el-tag :type="row.isBuiltin ? 'warning' : 'success'" size="small">{{ row.isBuiltin ? '内置' : '自定义' }}</el-tag>
              </template>
            </el-table-column>
            <!-- 操作列：仅 ADMIN/MANAGER 可见 -->
            <el-table-column v-if="canManage" label="操作" width="150" align="center" fixed="right">
              <template #default="scope">
                <el-button size="small" type="primary" link @click="openTermDialog('edit', scope.row)">编辑</el-button>
                <el-button size="small" type="danger" link @click="handleDeleteTerm(scope.row)" :disabled="scope.row.isBuiltin">删除</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="pagination-container">
            <el-pagination
              v-model:current-page="termCurrentPage"
              v-model:page-size="termPageSize"
              :page-sizes="[20, 50, 100]"
              :background="true"
              layout="total, sizes, prev, pager, next"
              :total="terminologyTotal"
              @size-change="fetchTerminologyList"
              @current-change="fetchTerminologyList"
            />
          </div>
        </el-card>
      </div>
    </div>

    <!-- Terminology Add/Edit Dialog -->
    <el-dialog
      v-model="termDialogVisible"
      :title="termDialogType === 'add' ? '新增术语' : '编辑术语'"
      width="520px"
      @close="resetTermForm"
    >
      <el-form ref="termFormRef" :model="termFormData" :rules="termFormRules" label-width="80px">
        <el-form-item label="术语" prop="term">
          <el-input v-model="termFormData.term" placeholder="请输入专业术语" />
        </el-form-item>
        <el-form-item label="分类" prop="category">
          <el-select v-model="termFormData.category" placeholder="选择分类" style="width:100%">
            <el-option v-for="cat in termCategoryOptions" :key="cat" :label="cat" :value="cat" />
          </el-select>
        </el-form-item>
        <el-form-item label="别名">
          <div style="width:100%;">
            <el-tag
              v-for="(alias, index) in termFormData.aliases"
              :key="index"
              closable
              @close="termFormData.aliases.splice(index, 1)"
              style="margin:2px 4px;"
            >{{ alias }}</el-tag>
            <el-input
              v-if="termAliasInputVisible"
              ref="termAliasInputRef"
              v-model="termAliasInputValue"
              size="small"
              style="width:120px;margin:2px;"
              @keyup.enter="handleTermAliasConfirm"
              @blur="handleTermAliasConfirm"
            />
            <el-button v-else size="small" @click="termAliasInputVisible = true" style="margin:2px;">
              + 添加别名
            </el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="termDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitTermForm" :loading="termSubmitLoading">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { Plus, Search, Folder, Files } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import {
  getTerminologyCategoriesApi,
  getTerminologyListApi,
  createTerminologyApi,
  updateTerminologyApi,
  deleteTerminologyApi,
  type TerminologyEntry,
  type TerminologyCategory,
} from '@/api/terminology'
import { useUserStore } from '@/stores/user'

const emit = defineEmits<{
  'update:total': [value: number]
}>()

const userStore = useUserStore()
const canManage = computed(() => userStore.isAdminOrManager())

const terminologyLoading = ref(false)
const terminologyList = ref<TerminologyEntry[]>([])
const terminologyTotal = ref(0)
const terminologyCategories = ref<TerminologyCategory[]>([])
const termSearchQuery = ref('')
const termFilterCategory = ref('')
const termCurrentPage = ref(1)
const termPageSize = ref(50)

// 术语编辑对话框
const termDialogVisible = ref(false)
const termDialogType = ref<'add' | 'edit'>('add')
const termSubmitLoading = ref(false)
const termFormRef = ref<FormInstance>()
const termFormData = reactive({ id: '', term: '', category: '', aliases: [] as string[] })
const termFormRules = reactive<FormRules>({
  term: [{ required: true, message: '请输入术语', trigger: 'blur' }],
  category: [{ required: true, message: '请选择分类', trigger: 'change' }],
})

// 别名输入
const termAliasInputVisible = ref(false)
const termAliasInputValue = ref('')
const termAliasInputRef = ref<any>()

// 分类下拉选项
const termCategoryOptions = computed(() => {
  const cats = terminologyCategories.value.map(c => c.category)
  if (!cats.includes('自定义')) cats.push('自定义')
  return cats
})

const termCategoryTagType = (cat: string) => {
  const map: Record<string, string> = { '核安全术语': 'danger', '设备术语': 'warning', '工艺术语': '', '建筑术语': 'success', '电气术语': 'info', '自定义': '' }
  return map[cat] || ''
}

const fetchTerminologyCategories = async () => {
  try {
    const { data } = await getTerminologyCategoriesApi()
    terminologyCategories.value = data.categories || []
    terminologyTotal.value = data.totalCount || 0
    emit('update:total', terminologyTotal.value)
  } catch (e) {
    terminologyCategories.value = []
  }
}

const fetchTerminologyList = async () => {
  terminologyLoading.value = true
  try {
    const { data } = await getTerminologyListApi({
      q: termSearchQuery.value || undefined,
      category: termFilterCategory.value || undefined,
      page: termCurrentPage.value,
      pageSize: termPageSize.value,
    })
    terminologyList.value = data.terms || []
    terminologyTotal.value = data.total || 0
    emit('update:total', terminologyTotal.value)
  } catch (e) {
    terminologyList.value = []
  } finally {
    terminologyLoading.value = false
  }
}

const handleTermSearch = () => {
  termCurrentPage.value = 1
  fetchTerminologyList()
}

// 监听分类切换
watch(termFilterCategory, () => {
  termCurrentPage.value = 1
  fetchTerminologyList()
})

const openTermDialog = (type: 'add' | 'edit', row?: TerminologyEntry) => {
  termDialogType.value = type
  if (type === 'add') {
    termFormData.id = ''
    termFormData.term = ''
    termFormData.category = termFilterCategory.value || ''
    termFormData.aliases = []
  } else if (row) {
    termFormData.id = row.id
    termFormData.term = row.term
    termFormData.category = row.category
    termFormData.aliases = [...(row.aliases || [])]
  }
  termDialogVisible.value = true
}

const resetTermForm = () => {
  if (termFormRef.value) termFormRef.value.resetFields()
  termFormData.aliases = []
}

const handleTermAliasConfirm = () => {
  if (termAliasInputValue.value.trim()) {
    termFormData.aliases.push(termAliasInputValue.value.trim())
  }
  termAliasInputVisible.value = false
  termAliasInputValue.value = ''
}

const submitTermForm = async () => {
  if (!termFormRef.value) return
  await termFormRef.value.validate(async (valid) => {
    if (!valid) return
    termSubmitLoading.value = true
    try {
      if (termDialogType.value === 'add') {
        await createTerminologyApi({
          term: termFormData.term,
          category: termFormData.category,
          aliases: termFormData.aliases,
        })
        ElMessage.success('术语新增成功')
      } else {
        await updateTerminologyApi(termFormData.id, {
          term: termFormData.term,
          category: termFormData.category,
          aliases: termFormData.aliases,
        })
        ElMessage.success('术语更新成功')
      }
      termDialogVisible.value = false
      fetchTerminologyList()
      fetchTerminologyCategories()
    } catch (e: any) {
      ElMessage.error(e?.response?.data?.error || '操作失败')
    } finally {
      termSubmitLoading.value = false
    }
  })
}

const handleDeleteTerm = async (row: TerminologyEntry) => {
  try {
    await ElMessageBox.confirm(`确认删除术语 "${row.term}" 吗？`, '警告', {
      confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning',
    })
    await deleteTerminologyApi(row.id)
    ElMessage.success('删除成功')
    fetchTerminologyList()
    fetchTerminologyCategories()
  } catch (e: any) {
    if (e !== 'cancel') {
      ElMessage.error(e?.response?.data?.error || '删除失败')
    }
  }
}

onMounted(() => {
  fetchTerminologyCategories()
  fetchTerminologyList()
})
</script>

<style scoped>
.terminology-container {
  height: calc(100vh - 200px);
}

.terminology-layout {
  display: flex;
  gap: 16px;
  height: 100%;
  align-items: flex-start;
}

.terminology-sidebar {
  width: 220px;
  flex-shrink: 0;
}

.terminology-sidebar-card {
  height: 100%;
  overflow: hidden;
}

.terminology-sidebar-card :deep(.el-card__header) {
  /* 与右侧卡片 header 高度保持一致（右侧有搜索框+按钮） */
  min-height: 56px;
  box-sizing: border-box;
}

.terminology-sidebar-card :deep(.el-card__body) {
  padding: 8px 0;
  overflow-y: auto;
  height: calc(100% - 56px);
}

.terminology-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.terminology-main > .el-card {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.terminology-main > .el-card > .el-card__body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.folder-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.folder-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.folder-tree-wrapper {
  padding: 0 8px;
}

.folder-node {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.2s;
  font-size: 14px;
  color: var(--el-text-color-regular);
  margin-bottom: 2px;
}

.folder-node:hover {
  background: var(--el-fill-color-light);
}

.folder-node.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 500;
}

.folder-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  padding: 1px 6px;
  border-radius: 10px;
  min-width: 20px;
  text-align: center;
}

.card-header { display: flex; justify-content: space-between; align-items: center; }
.header-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  display: flex;
  align-items: center;
}
.header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.search-input { width: 300px; }
.pagination-container { margin-top: 20px; display: flex; justify-content: flex-end; }
</style>
