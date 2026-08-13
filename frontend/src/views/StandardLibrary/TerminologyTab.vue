<template>
  <div class="wl-page">
    <!-- 页头 -->
    <header class="page-header">
      <div>
        <h3 class="page-title">白名单库</h3>
        <p class="page-sub">审查时自动忽略白名单内的专业词条，避免误报，让审查聚焦真实问题。</p>
      </div>
      <div class="page-actions">
        <el-input
          v-model="termSearchQuery"
          placeholder="搜索词条或别名…"
          clearable
          class="quick-search"
          :prefix-icon="Search"
          @input="handleTermSearch"
          @clear="handleTermSearch"
        />
        <el-button v-if="canManage" type="primary" :icon="Plus" @click="openTermDialog('add')">新增词条</el-button>
        <el-button
          v-if="canManage && selectedRows.length > 0"
          type="danger"
          :icon="Delete"
          @click="handleBatchDelete"
        >
          批量删除 ({{ selectedRows.length }})
        </el-button>
      </div>
    </header>

    <!-- 左右布局 -->
    <div class="wl-body">
      <!-- 左栏：分类 -->
      <aside class="wl-sidebar">
        <div class="sidebar-header">
          <span class="sidebar-title">词条分类</span>
          <el-tooltip content="按专业领域分类管理白名单词条" placement="top">
            <el-icon class="sidebar-help"><QuestionFilled /></el-icon>
          </el-tooltip>
        </div>
        <div class="sidebar-search">
          <el-input v-model="categorySearchQuery" placeholder="搜索分类…" clearable size="default" :prefix-icon="Search" />
        </div>
        <div class="sidebar-list">
          <div
            class="sidebar-item"
            :class="{ active: !termFilterCategory }"
            @click="termFilterCategory = ''"
          >
            <div class="sidebar-item-top">
              <el-icon class="cat-icon"><Files /></el-icon>
              <span class="cat-name">全部分类</span>
              <span class="sidebar-item-count">{{ terminologyTotal }}</span>
            </div>
          </div>
          <div class="sidebar-group-label">专业分类</div>
          <div
            v-for="cat in filteredCategories"
            :key="cat.category"
            class="sidebar-item"
            :class="{ active: termFilterCategory === cat.category }"
            @click="termFilterCategory = cat.category"
          >
            <div class="sidebar-item-top">
              <el-icon class="cat-icon" :style="{ color: `var(--color-${termCategoryColor(cat.category)})` }"><Folder /></el-icon>
              <span class="cat-name">{{ cat.category }}</span>
              <span class="sidebar-item-count">{{ cat.count }}</span>
            </div>
          </div>
          <div v-if="filteredCategories.length === 0" class="sidebar-empty">未找到匹配分类</div>
        </div>
      </aside>

      <!-- 右栏：词条列表 -->
      <main class="wl-main">
        <div class="scope-bar">
          <span class="scope-badge" :class="{ 'scope-badge-all': !termFilterCategory }">
            {{ termFilterCategory || '全部分类' }}
          </span>
          <span class="scope-hint">审查时这些词条将被自动忽略，不计入问题</span>
        </div>

        <el-table
          v-loading="terminologyLoading"
          :data="terminologyList"
          class="wl-table"
          stripe
          size="default"
          max-height="calc(100vh - 480px)"
          empty-text="暂无词条"
          @selection-change="handleSelectionChange"
        >
          <el-table-column v-if="canManage" type="selection" width="44" align="center" />
          <el-table-column prop="term" label="词条" min-width="200" sortable="custom">
            <template #default="{ row }">
              <span class="term-name">{{ row.term }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="category" label="分类" width="140" align="center" sortable="custom">
            <template #default="{ row }">
              <el-tag size="small" effect="light" :type="termCategoryTagType(row.category)">{{ row.category }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="别名" min-width="260">
            <template #default="{ row }">
              <template v-if="row.aliases?.length">
                <el-popover v-if="row.aliases.length > 5" trigger="hover" placement="top" :width="260">
                  <template #reference>
                    <div class="alias-preview">
                      <el-tag v-for="(alias, i) in row.aliases.slice(0, 5)" :key="i" size="small" effect="plain" class="alias-tag">{{ alias }}</el-tag>
                      <el-tag size="small" type="primary" class="alias-tag">+{{ row.aliases.length - 5 }}</el-tag>
                    </div>
                  </template>
                  <div class="alias-full-list">
                    <el-tag v-for="(alias, i) in row.aliases" :key="i" size="small" effect="plain" class="alias-tag">{{ alias }}</el-tag>
                  </div>
                </el-popover>
                <div v-else class="alias-preview">
                  <el-tag v-for="(alias, i) in row.aliases" :key="i" size="small" effect="plain" class="alias-tag">{{ alias }}</el-tag>
                </div>
              </template>
              <span v-else class="alias-empty">—</span>
            </template>
          </el-table-column>
          <el-table-column prop="isBuiltin" label="类型" width="100" align="center">
            <template #default="{ row }">
              <el-tag :type="row.isBuiltin ? 'info' : 'success'" size="small" effect="light">
                {{ row.isBuiltin ? '内置' : '自定义' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column v-if="canManage" label="操作" width="140" align="center" fixed="right">
            <template #default="scope">
              <el-button link type="primary" size="small" @click="openTermDialog('edit', scope.row)">编辑</el-button>
              <el-tooltip :content="scope.row.isBuiltin ? '内置词条不可删除' : '删除此词条'" placement="top">
                <el-button link type="danger" size="small" @click="handleDeleteTerm(scope.row)" :disabled="scope.row.isBuiltin">删除</el-button>
              </el-tooltip>
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
      </main>
    </div>

    <!-- 词条新增/编辑对话框 -->
    <el-dialog
      v-model="termDialogVisible"
      :title="termDialogType === 'add' ? '新增词条' : '编辑词条'"
      width="520px"
      @close="resetTermForm"
    >
      <el-form ref="termFormRef" :model="termFormData" :rules="termFormRules" label-width="80px">
        <el-form-item label="词条" prop="term">
          <el-input v-model="termFormData.term" placeholder="请输入专业词条，如：余热排出系统" />
        </el-form-item>
        <el-form-item label="分类" prop="category">
          <el-select v-model="termFormData.category" placeholder="选择或输入新分类" class="full-width" filterable allow-create default-first-option>
            <el-option v-for="cat in termCategoryOptions" :key="cat" :label="cat" :value="cat" />
          </el-select>
        </el-form-item>
        <el-form-item label="别名">
          <div class="full-width">
            <div class="alias-edit-wrap">
              <el-tag
                v-for="(alias, index) in termFormData.aliases"
                :key="index"
                closable
                effect="plain"
                class="alias-tag"
                @close="termFormData.aliases.splice(index, 1)"
              >{{ alias }}</el-tag>
              <el-input
                v-if="termAliasInputVisible"
                ref="termAliasInputRef"
                v-model="termAliasInputValue"
                size="small"
                class="alias-input"
                @keyup.enter="handleTermAliasConfirm"
                @blur="handleTermAliasConfirm"
              />
              <el-button v-else size="small" class="alias-add-btn" @click="termAliasInputVisible = true">
                + 添加别名
              </el-button>
            </div>
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
import { Plus, Search, Folder, Files, Delete, QuestionFilled } from '@element-plus/icons-vue'
import { useEnterToConfirm } from '@/composables/useEnterToConfirm'
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
const categorySearchQuery = ref('')
const selectedRows = ref<TerminologyEntry[]>([])

// 词条编辑对话框
const termDialogVisible = ref(false)
const termDialogType = ref<'add' | 'edit'>('add')
const termSubmitLoading = ref(false)
const termFormRef = ref<FormInstance>()
const termFormData = reactive({ id: '', term: '', category: '', aliases: [] as string[] })
const termFormRules = reactive<FormRules>({
  term: [{ required: true, message: '请输入词条', trigger: 'blur' }],
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

const filteredCategories = computed(() => {
  const q = categorySearchQuery.value.trim().toLowerCase()
  if (!q) return terminologyCategories.value
  return terminologyCategories.value.filter(c => c.category.toLowerCase().includes(q))
})

// 分类主题色（映射到 --color-* 体系）
const CATEGORY_COLORS: Record<string, string> = {
  '核安全术语': 'danger',
  '设备术语': 'warning',
  '工艺术语': 'info',
  '建筑术语': 'success',
  '电气术语': 'primary',
  '自定义': 'info',
}

const termCategoryColor = (cat: string): string => CATEGORY_COLORS[cat] || 'gray'

const termCategoryTagType = (cat: string): 'warning' | 'info' | 'success' | 'danger' | 'primary' => {
  const map: Record<string, 'warning' | 'info' | 'success' | 'danger' | 'primary'> = CATEGORY_COLORS as any
  return map[cat] || 'info'
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
        ElMessage.success('词条新增成功')
      } else {
        await updateTerminologyApi(termFormData.id, {
          term: termFormData.term,
          category: termFormData.category,
          aliases: termFormData.aliases,
        })
        ElMessage.success('词条更新成功')
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

useEnterToConfirm(termDialogVisible, submitTermForm, { disabled: termSubmitLoading })

const handleDeleteTerm = async (row: TerminologyEntry) => {
  try {
    await ElMessageBox.confirm(`确认删除词条 "${row.term}" 吗？`, '警告', {
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

const handleSelectionChange = (rows: TerminologyEntry[]) => {
  selectedRows.value = rows
}

const handleBatchDelete = async () => {
  const rows = selectedRows.value.filter(r => !r.isBuiltin)
  if (rows.length === 0) {
    ElMessage.warning('所选词条均为内置项，不可删除')
    return
  }
  const builtinCountInSel = selectedRows.value.length - rows.length
  const hint = builtinCountInSel > 0 ? `\n（已自动排除 ${builtinCountInSel} 个内置词条）` : ''
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${rows.length} 条词条吗？${hint}`, '批量删除', {
      confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning',
    })
    for (const row of rows) {
      await deleteTerminologyApi(row.id)
    }
    ElMessage.success(`成功删除 ${rows.length} 条词条`)
    selectedRows.value = []
    fetchTerminologyList()
    fetchTerminologyCategories()
  } catch (e: any) {
    if (e !== 'cancel') {
      ElMessage.error(e?.response?.data?.error || '批量删除失败')
    }
  }
}

onMounted(() => {
  fetchTerminologyCategories()
  fetchTerminologyList()
})
</script>

<style scoped>
/* ===== 整体布局 ===== */
.wl-page {
  height: calc(100vh - 200px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-gray-50);
  padding: 20px 24px;
}

/* ===== 页头 ===== */
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 4px 0 16px;
  flex-shrink: 0;
}
.page-title {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 700;
  color: var(--color-gray-900);
}
.page-sub {
  margin: 0;
  font-size: 13px;
  color: var(--color-gray-500);
}
.page-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.quick-search {
  width: 260px;
}

/* ===== 左右布局 ===== */
.wl-body {
  flex: 1;
  display: flex;
  gap: 16px;
  overflow: hidden;
  min-height: 0;
}

/* ===== 左栏：分类 ===== */
.wl-sidebar {
  width: 240px;
  min-width: 240px;
  background: #fff;
  border: 1px solid var(--color-gray-200);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow-surface);
}
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 8px;
}
.sidebar-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-gray-800);
}
.sidebar-help {
  color: var(--color-gray-400);
  font-size: 14px;
}
.sidebar-search {
  padding: 8px 12px;
}
.sidebar-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
}
.sidebar-group-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-gray-400);
  letter-spacing: 0.4px;
  padding: 10px 8px 4px;
}
.sidebar-item {
  position: relative;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s ease;
  margin-bottom: 2px;
}
.sidebar-item:hover {
  background: var(--color-gray-50);
}
.sidebar-item.active {
  background: var(--color-primary-50);
}
.sidebar-item.active::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--color-primary-500);
}
.sidebar-item-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cat-icon {
  font-size: 14px;
  color: var(--color-gray-400);
  flex-shrink: 0;
}
.sidebar-item.active .cat-icon {
  color: var(--color-primary-500);
}
.cat-name {
  flex: 1;
  font-size: 13px;
  color: var(--color-gray-700);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sidebar-item.active .cat-name {
  color: var(--color-gray-900);
  font-weight: 500;
}
.sidebar-item-count {
  font-size: 12px;
  color: var(--color-gray-500);
  background: var(--color-gray-100);
  padding: 1px 7px;
  border-radius: 10px;
  min-width: 22px;
  text-align: center;
  flex-shrink: 0;
}
.sidebar-item.active .sidebar-item-count {
  background: var(--color-primary-100);
  color: var(--color-primary-700);
}
.sidebar-empty {
  text-align: center;
  padding: 40px 0;
  color: var(--color-gray-400);
  font-size: 13px;
}

/* ===== 右栏 ===== */
.wl-main {
  flex: 1;
  background: #fff;
  border: 1px solid var(--color-gray-200);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  padding: 0 16px 16px;
  box-shadow: var(--shadow-surface);
}
.scope-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--color-gray-100);
  flex-shrink: 0;
  min-height: 44px;
}
.scope-badge {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 5px;
  background: var(--color-primary-50);
  color: var(--color-primary-600);
  font-size: 12px;
  font-weight: 600;
}
.scope-badge-all {
  background: var(--color-gray-100);
  color: var(--color-gray-600);
}
.scope-hint {
  font-size: 12px;
  color: var(--color-gray-400);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ===== 表格 ===== */
.term-name {
  font-weight: 500;
  color: var(--color-gray-800);
}
.alias-preview {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}
.alias-tag {
  margin: 2px 4px 2px 0;
}
.alias-empty {
  color: var(--color-gray-400);
}
.alias-full-list {
  max-height: 160px;
  overflow-y: auto;
  display: flex;
  flex-wrap: wrap;
}
.pagination-container {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
  flex-shrink: 0;
}

/* ===== 对话框 ===== */
.full-width {
  width: 100%;
}
.alias-edit-wrap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.alias-input {
  width: 140px;
}
.alias-add-btn {
  margin: 2px;
}
</style>
