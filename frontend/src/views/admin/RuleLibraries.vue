<template>
  <div class="rl-page">
    <section class="hero-panel">
      <div class="hero-copy">
        <div class="hero-eyebrow">RULE LIBRARIES</div>
        <h2>规则库管理</h2>
        <p class="subtitle">把规范文档沉淀成可发布、可筛选、可提审的结构化规则资产。</p>
        <div class="hero-metrics">
          <div class="metric-pill">
            <span class="metric-label">规则库总数</span>
            <strong>{{ libraries.length }}</strong>
          </div>
          <div class="metric-pill">
            <span class="metric-label">已发布</span>
            <strong>{{ publishedCount }}</strong>
          </div>
          <div class="metric-pill">
            <span class="metric-label">可执行规则</span>
            <strong>{{ executableCount }}</strong>
          </div>
        </div>
      </div>
      <div class="hero-actions">
        <div class="hero-badge">治理视图</div>
        <el-button type="primary" class="create-button" @click="showCreateDialog">
          <el-icon><Plus /></el-icon> 新建规则库
        </el-button>
      </div>
    </section>

    <el-card shadow="never" class="rl-card rl-table-card">
      <el-table :data="libraries" v-loading="loading" empty-text="暂无规则库">
        <el-table-column prop="name" label="规则库名称" min-width="180">
          <template #default="{ row }">
            <span class="lib-name">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="220" show-overflow-tooltip />
        <el-table-column prop="sourceFileName" label="源文件" width="160" show-overflow-tooltip />
        <el-table-column label="规则数" width="100" align="center">
          <template #default="{ row }">
            <el-tag type="info" size="small">{{ row._count?.items || 0 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="可执行" width="100" align="center">
          <template #default="{ row }">
            <el-tag type="success" size="small">{{ row.enabledExecutableItemCount || 0 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="待结构化" width="100" align="center">
          <template #default="{ row }">
            <el-tag type="warning" size="small">{{ row.pendingStructuredItemCount || 0 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'PUBLISHED' ? 'success' : row.status === 'ARCHIVED' ? 'info' : 'warning'" size="small">
              {{ { DRAFT: '草稿', PUBLISHED: '已发布', ARCHIVED: '归档' }[row.status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="420" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="showDetail(row)">查看规则</el-button>
            <el-button type="primary" link size="small" @click="showUploadRules(row)">AI 解析</el-button>
            <el-button type="primary" link size="small" @click="showEditDialog(row)">编辑</el-button>
            <el-button
              v-if="row.status !== 'PUBLISHED'"
              type="success"
              link
              size="small"
              @click="changeStatus(row, 'PUBLISHED')"
            >
              发布
            </el-button>
            <el-button
              v-if="row.status !== 'DRAFT'"
              type="warning"
              link
              size="small"
              @click="changeStatus(row, 'DRAFT')"
            >
              撤回
            </el-button>
            <el-button
              v-if="row.status !== 'ARCHIVED'"
              type="info"
              link
              size="small"
              @click="changeStatus(row, 'ARCHIVED')"
            >
              归档
            </el-button>
            <el-popconfirm title="确认删除此规则库？" @confirm="handleDelete(row.id)">
              <template #reference>
                <el-button type="danger" link size="small">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card v-if="selectedLibrary" shadow="never" class="rl-card detail-card">
      <template #header>
        <div class="detail-header">
          <div>
            <span>{{ selectedLibrary.name }} — 规则列表（{{ filteredItems.length }} / {{ selectedLibrary.items?.length || 0 }}）</span>
            <div class="detail-stats">
              <el-tag type="success" size="small">启用且可执行 {{ selectedLibrary.enabledExecutableItemCount || 0 }}</el-tag>
              <el-tag type="warning" size="small">待结构化 {{ selectedLibrary.pendingStructuredItemCount || 0 }}</el-tag>
            </div>
          </div>
          <div>
            <el-button type="primary" size="small" @click="showAddItemDialog">手动添加</el-button>
            <el-button type="primary" link @click="selectedLibrary = null">关闭</el-button>
          </div>
        </div>
      </template>

      <div class="filters">
        <el-input v-model="itemFilters.keyword" placeholder="搜索规则名/代码/描述" clearable class="filter-input" />
        <el-select v-model="itemFilters.category" placeholder="分类" clearable class="filter-select">
          <el-option v-for="category in categoryOptions" :key="category" :label="category" :value="category" />
        </el-select>
        <el-select v-model="itemFilters.severity" placeholder="严重度" clearable class="filter-select">
          <el-option label="error" value="error" />
          <el-option label="warning" value="warning" />
          <el-option label="info" value="info" />
        </el-select>
        <el-select v-model="itemFilters.enabled" placeholder="启用状态" clearable class="filter-select">
          <el-option label="启用" value="enabled" />
          <el-option label="停用" value="disabled" />
        </el-select>
      </div>

      <el-table :data="filteredItems" empty-text="暂无规则">
        <el-table-column prop="ruleCode" label="规则代码" width="120" />
        <el-table-column prop="ruleName" label="规则名称" min-width="180" />
        <el-table-column prop="category" label="分类" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.category" size="small">{{ row.category }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="执行类型" width="130">
          <template #default="{ row }">
            <el-tag :type="row.executionType === 'MANUAL' ? 'info' : 'success'" size="small">
              {{ row.executionType || 'BUILTIN_PREFIX' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="内置前缀" width="110">
          <template #default="{ row }">
            <span>{{ row.builtinPrefix || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="severity" label="严重度" width="90">
          <template #default="{ row }">
            <el-tag :type="row.severity === 'error' ? 'danger' : row.severity === 'warning' ? 'warning' : 'info'" size="small">
              {{ row.severity }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="250" show-overflow-tooltip />
        <el-table-column prop="enabled" label="启用" width="70" align="center">
          <template #default="{ row }">
            <el-switch v-model="row.enabled" size="small" @change="toggleItem(row)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="showEditItemDialog(row)">编辑</el-button>
            <el-popconfirm title="确认删除？" @confirm="handleDeleteItem(row.id)">
              <template #reference>
                <el-button type="danger" link size="small">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑规则库' : '新建规则库'" width="480px">
      <el-form :model="formData" label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="formData.name" placeholder="如：GB 50265 规则库" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="formData.description" type="textarea" :rows="3" placeholder="规则库用途说明" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="parseDialogVisible" :title="`AI 解析规则 — ${parseTarget?.name || ''}`" width="560px">
      <p class="helper-text">上传规范文档后先生成候选规则，确认后再导入当前规则库。</p>
      <el-upload drag :auto-upload="false" :limit="1" accept=".docx,.doc,.pdf,.xlsx,.xls,.txt,.md" :on-change="handleParseFileChange">
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
        <div class="el-upload__text">拖拽文件到此处，或 <em>点击选择</em></div>
      </el-upload>
      <template #footer>
        <el-button @click="parseDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleParsePreview" :loading="parsing">生成候选规则</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="previewDialogVisible" title="候选规则预览" width="960px">
      <div class="preview-toolbar">
        <el-radio-group v-model="importMode" size="small">
          <el-radio-button label="merge">合并导入</el-radio-button>
          <el-radio-button label="replace">覆盖导入</el-radio-button>
        </el-radio-group>
        <div class="preview-meta">候选 {{ previewItems.length }} 条</div>
      </div>
      <el-table :data="previewItems" max-height="420">
        <el-table-column prop="ruleCode" label="规则代码" width="120" />
        <el-table-column prop="ruleName" label="规则名称" min-width="180" />
        <el-table-column prop="category" label="分类" width="120" />
        <el-table-column prop="executionType" label="执行类型" width="140" />
        <el-table-column prop="builtinPrefix" label="前缀" width="100" />
        <el-table-column prop="severity" label="严重度" width="90" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.duplicate" type="warning" size="small">重复</el-tag>
            <el-tag v-if="!row.executable" type="info" size="small">人工项</el-tag>
            <el-tag v-if="row.executable && !row.duplicate" type="success" size="small">可执行</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="220" show-overflow-tooltip />
      </el-table>
      <template #footer>
        <el-button @click="previewDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleImportPreview" :loading="importing">确认导入</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="itemDialogVisible" :title="itemDialogMode === 'edit' ? '编辑规则' : '手动添加规则'" width="620px">
      <el-form :model="itemForm" label-width="100px">
        <el-form-item label="规则代码">
          <el-input v-model="itemForm.ruleCode" placeholder="如 NAME_001" />
        </el-form-item>
        <el-form-item label="规则名称" required>
          <el-input v-model="itemForm.ruleName" />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="itemForm.category" placeholder="NAMING / FORMAT / DWG" />
        </el-form-item>
        <el-form-item label="执行类型">
          <el-select v-model="itemForm.executionType">
            <el-option label="BUILTIN_PREFIX" value="BUILTIN_PREFIX" />
            <el-option label="REGEX" value="REGEX" />
            <el-option label="KEYWORD_REQUIRED" value="KEYWORD_REQUIRED" />
            <el-option label="KEYWORD_FORBIDDEN" value="KEYWORD_FORBIDDEN" />
            <el-option label="MANUAL" value="MANUAL" />
          </el-select>
        </el-form-item>
        <el-form-item label="内置前缀">
          <el-input v-model="itemForm.builtinPrefix" placeholder="NAME / FORMAT / DWG" />
        </el-form-item>
        <el-form-item label="目标范围">
          <el-select v-model="itemForm.targetScope">
            <el-option label="TEXT" value="TEXT" />
            <el-option label="FILE_NAME" value="FILE_NAME" />
            <el-option label="HEADER" value="HEADER" />
            <el-option label="TABLE" value="TABLE" />
            <el-option label="DWG" value="DWG" />
          </el-select>
        </el-form-item>
        <el-form-item label="严重度">
          <el-select v-model="itemForm.severity">
            <el-option label="error" value="error" />
            <el-option label="warning" value="warning" />
            <el-option label="info" value="info" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="itemForm.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="检查方法">
          <el-input v-model="itemForm.checkMethod" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="itemDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSaveItem" :loading="submitting">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Plus, UploadFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  getRuleLibrariesApi,
  getRuleLibraryApi,
  createRuleLibraryApi,
  updateRuleLibraryApi,
  deleteRuleLibraryApi,
  parseRulesPreviewApi,
  importRulePreviewItemsApi,
  addRuleItemApi,
  updateRuleItemApi,
  deleteRuleItemApi,
  type RuleLibrary,
  type RuleLibraryItem,
  type RuleLibraryPreviewItem,
} from '@/api/rule-library'

const loading = ref(false)
const submitting = ref(false)
const parsing = ref(false)
const importing = ref(false)

const libraries = ref<RuleLibrary[]>([])
const selectedLibrary = ref<RuleLibrary | null>(null)

const dialogVisible = ref(false)
const isEdit = ref(false)
const editId = ref('')
const formData = reactive({ name: '', description: '' })

const parseDialogVisible = ref(false)
const previewDialogVisible = ref(false)
const parseTarget = ref<RuleLibrary | null>(null)
const parseFile = ref<File | null>(null)
const previewItems = ref<RuleLibraryPreviewItem[]>([])
const previewSourceFileName = ref('')
const importMode = ref<'merge' | 'replace'>('merge')

const itemDialogVisible = ref(false)
const itemDialogMode = ref<'create' | 'edit'>('create')
const editingItemId = ref('')
const itemForm = reactive({
  ruleCode: '',
  ruleName: '',
  category: '',
  description: '',
  checkMethod: '',
  severity: 'warning',
  executionType: 'BUILTIN_PREFIX',
  builtinPrefix: '',
  targetScope: 'TEXT',
})

const itemFilters = reactive({
  keyword: '',
  category: '',
  severity: '',
  enabled: '',
})

const categoryOptions = computed(() => {
  const values = new Set<string>()
  ;(selectedLibrary.value?.items || []).forEach((item) => {
    if (item.category) values.add(item.category)
  })
  return Array.from(values)
})

const publishedCount = computed(() => libraries.value.filter(item => item.status === 'PUBLISHED').length)
const executableCount = computed(() => libraries.value.reduce((sum, item) => sum + (item.enabledExecutableItemCount || 0), 0))

const filteredItems = computed(() => {
  let items = selectedLibrary.value?.items || []
  if (itemFilters.keyword.trim()) {
    const keyword = itemFilters.keyword.trim().toLowerCase()
    items = items.filter(item =>
      [item.ruleCode, item.ruleName, item.description].some(v => (v || '').toLowerCase().includes(keyword)),
    )
  }
  if (itemFilters.category) items = items.filter(item => item.category === itemFilters.category)
  if (itemFilters.severity) items = items.filter(item => item.severity === itemFilters.severity)
  if (itemFilters.enabled === 'enabled') items = items.filter(item => item.enabled)
  if (itemFilters.enabled === 'disabled') items = items.filter(item => !item.enabled)
  return items
})

const resetLibraryForm = () => {
  formData.name = ''
  formData.description = ''
}

const resetItemForm = () => {
  editingItemId.value = ''
  itemForm.ruleCode = ''
  itemForm.ruleName = ''
  itemForm.category = ''
  itemForm.description = ''
  itemForm.checkMethod = ''
  itemForm.severity = 'warning'
  itemForm.executionType = 'BUILTIN_PREFIX'
  itemForm.builtinPrefix = ''
  itemForm.targetScope = 'TEXT'
}

const fetchLibraries = async () => {
  loading.value = true
  try {
    const { data } = await getRuleLibrariesApi()
    libraries.value = data || []
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '获取规则库列表失败')
  } finally {
    loading.value = false
  }
}

const refreshSelectedLibrary = async () => {
  if (!selectedLibrary.value?.id) return
  const { data } = await getRuleLibraryApi(selectedLibrary.value.id)
  selectedLibrary.value = data
}

const showCreateDialog = () => {
  isEdit.value = false
  resetLibraryForm()
  dialogVisible.value = true
}

const showEditDialog = (row: RuleLibrary) => {
  isEdit.value = true
  editId.value = row.id
  formData.name = row.name
  formData.description = row.description || ''
  dialogVisible.value = true
}

const handleSubmit = async () => {
  if (!formData.name.trim()) {
    ElMessage.warning('请输入名称')
    return
  }
  submitting.value = true
  try {
    if (isEdit.value) {
      await updateRuleLibraryApi(editId.value, { name: formData.name.trim(), description: formData.description || '' })
    } else {
      await createRuleLibraryApi({ name: formData.name.trim(), description: formData.description || '' })
    }
    ElMessage.success(isEdit.value ? '更新成功' : '创建成功')
    dialogVisible.value = false
    await fetchLibraries()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '操作失败')
  } finally {
    submitting.value = false
  }
}

const handleDelete = async (id: string) => {
  try {
    await deleteRuleLibraryApi(id)
    ElMessage.success('删除成功')
    if (selectedLibrary.value?.id === id) selectedLibrary.value = null
    await fetchLibraries()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '删除失败')
  }
}

const changeStatus = async (row: RuleLibrary, status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED') => {
  try {
    await updateRuleLibraryApi(row.id, { status })
    ElMessage.success('状态更新成功')
    await fetchLibraries()
    if (selectedLibrary.value?.id === row.id) await refreshSelectedLibrary()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '状态更新失败')
  }
}

const showDetail = async (row: RuleLibrary) => {
  try {
    const { data } = await getRuleLibraryApi(row.id)
    selectedLibrary.value = data
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '获取详情失败')
  }
}

const showUploadRules = (row: RuleLibrary) => {
  parseTarget.value = row
  parseFile.value = null
  previewItems.value = []
  previewSourceFileName.value = ''
  parseDialogVisible.value = true
}

const handleParseFileChange = (file: any) => {
  parseFile.value = file.raw
}

const handleParsePreview = async () => {
  if (!parseTarget.value?.id || !parseFile.value) {
    ElMessage.warning('请选择文件')
    return
  }
  parsing.value = true
  try {
    const fd = new FormData()
    fd.append('file', parseFile.value)
    const { data } = await parseRulesPreviewApi(parseTarget.value.id, fd)
    previewItems.value = data?.items || []
    previewSourceFileName.value = data?.sourceFileName || parseFile.value.name
    parseDialogVisible.value = false
    previewDialogVisible.value = true
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '解析预览失败')
  } finally {
    parsing.value = false
  }
}

const handleImportPreview = async () => {
  if (!parseTarget.value?.id) return
  importing.value = true
  try {
    const { data } = await importRulePreviewItemsApi(parseTarget.value.id, {
      items: previewItems.value,
      mode: importMode.value,
      sourceFileName: previewSourceFileName.value,
    })
    ElMessage.success(`导入成功，共 ${data?.count || 0} 条`)
    previewDialogVisible.value = false
    await fetchLibraries()
    if (selectedLibrary.value?.id === parseTarget.value.id) await refreshSelectedLibrary()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '导入失败')
  } finally {
    importing.value = false
  }
}

const showAddItemDialog = () => {
  itemDialogMode.value = 'create'
  resetItemForm()
  itemDialogVisible.value = true
}

const showEditItemDialog = (row: RuleLibraryItem) => {
  itemDialogMode.value = 'edit'
  editingItemId.value = row.id
  itemForm.ruleCode = row.ruleCode || ''
  itemForm.ruleName = row.ruleName || ''
  itemForm.category = row.category || ''
  itemForm.description = row.description || ''
  itemForm.checkMethod = row.checkMethod || ''
  itemForm.severity = row.severity || 'warning'
  itemForm.executionType = row.executionType || 'BUILTIN_PREFIX'
  itemForm.builtinPrefix = row.builtinPrefix || ''
  itemForm.targetScope = row.targetScope || 'TEXT'
  itemDialogVisible.value = true
}

const handleSaveItem = async () => {
  if (!selectedLibrary.value?.id || !itemForm.ruleName.trim()) {
    ElMessage.warning('请输入规则名称')
    return
  }
  submitting.value = true
  try {
    const payload = {
      ruleCode: itemForm.ruleCode || undefined,
      ruleName: itemForm.ruleName.trim(),
      category: itemForm.category || undefined,
      description: itemForm.description || undefined,
      checkMethod: itemForm.checkMethod || undefined,
      severity: itemForm.severity,
      executionType: itemForm.executionType as any,
      builtinPrefix: itemForm.builtinPrefix || undefined,
      targetScope: itemForm.targetScope as any,
    }
    if (itemDialogMode.value === 'edit' && editingItemId.value) {
      await updateRuleItemApi(selectedLibrary.value.id, editingItemId.value, payload)
    } else {
      await addRuleItemApi(selectedLibrary.value.id, payload)
    }
    ElMessage.success(itemDialogMode.value === 'edit' ? '更新成功' : '添加成功')
    itemDialogVisible.value = false
    await refreshSelectedLibrary()
    await fetchLibraries()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '保存失败')
  } finally {
    submitting.value = false
  }
}

const toggleItem = async (row: RuleLibraryItem) => {
  if (!selectedLibrary.value?.id) return
  try {
    await updateRuleItemApi(selectedLibrary.value.id, row.id, { enabled: row.enabled })
    await fetchLibraries()
  } catch (e: any) {
    row.enabled = !row.enabled
    ElMessage.error(e?.response?.data?.message || '更新失败')
  }
}

const handleDeleteItem = async (itemId: string) => {
  if (!selectedLibrary.value?.id) return
  try {
    await deleteRuleItemApi(selectedLibrary.value.id, itemId)
    ElMessage.success('删除成功')
    await refreshSelectedLibrary()
    await fetchLibraries()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '删除失败')
  }
}

onMounted(() => {
  fetchLibraries()
})
</script>

<style scoped>
.rl-page {
  padding: 0;
  --rl-ink: #10233f;
  --rl-subtle: #61758f;
  --rl-line: rgba(16, 35, 63, 0.08);
  --rl-accent: #0f172a;
  --rl-accent-soft: #e8f1ff;
  --rl-gold: #c48b2d;
}
.hero-panel {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: stretch;
  padding: 24px 28px;
  margin-bottom: 18px;
  border-radius: 18px;
  background:
    radial-gradient(circle at top right, rgba(196, 139, 45, 0.22), transparent 28%),
    linear-gradient(135deg, #f8fbff 0%, #eef4fb 52%, #ffffff 100%);
  border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.08);
}
.hero-copy {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hero-eyebrow {
  font-size: 11px;
  letter-spacing: 0.2em;
  color: var(--rl-gold);
  font-weight: 700;
}
.hero-panel h2 {
  font-size: 28px;
  line-height: 1.1;
  margin: 0;
  color: var(--rl-ink);
  font-weight: 700;
}
.subtitle {
  font-size: 14px;
  color: var(--rl-subtle);
  margin: 0;
  max-width: 760px;
}
.hero-actions {
  min-width: 180px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}
.hero-badge {
  padding: 8px 12px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--rl-ink);
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(15, 23, 42, 0.08);
}
.hero-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
}
.metric-pill {
  min-width: 120px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(15, 23, 42, 0.06);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65);
}
.metric-label {
  display: block;
  font-size: 12px;
  color: var(--rl-subtle);
  margin-bottom: 4px;
}
.metric-pill strong {
  font-size: 24px;
  color: var(--rl-ink);
  line-height: 1;
}
.create-button {
  min-width: 148px;
  border-radius: 14px;
  background: linear-gradient(135deg, #0f172a 0%, #16335d 100%);
  border: none;
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.18);
}
.rl-card {
  border-radius: 16px;
  border: 1px solid var(--rl-line);
  overflow: hidden;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06);
}
.rl-table-card :deep(.el-card__body),
.detail-card :deep(.el-card__body) {
  padding: 18px;
}
.rl-table-card :deep(.el-table th.el-table__cell) {
  background: #fbfdff;
  color: var(--rl-ink);
  font-weight: 600;
}
.rl-table-card :deep(.el-table tr:hover > td.el-table__cell),
.detail-card :deep(.el-table tr:hover > td.el-table__cell) {
  background: rgba(232, 241, 255, 0.44);
}
.detail-card { margin-top: 16px; }
.lib-name { font-weight: 600; color: var(--rl-ink); }
.detail-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.detail-stats { display: flex; gap: 8px; margin-top: 6px; }
.filters {
  display: flex;
  gap: 12px;
  margin-bottom: 14px;
  padding: 14px;
  border-radius: 14px;
  background: linear-gradient(180deg, #fbfdff 0%, #f4f8fc 100%);
  border: 1px solid var(--rl-line);
  flex-wrap: wrap;
}
.filter-input { width: 260px; }
.filter-select { width: 140px; }
.helper-text { font-size: 13px; color: var(--rl-subtle); margin-bottom: 12px; }
.preview-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.preview-meta { font-size: 13px; color: var(--rl-subtle); }

@media (max-width: 960px) {
  .hero-panel {
    flex-direction: column;
    padding: 20px;
  }
  .hero-actions {
    min-width: 0;
    align-items: flex-start;
  }
  .hero-panel h2 {
    font-size: 24px;
  }
  .metric-pill {
    min-width: 108px;
  }
}
</style>
