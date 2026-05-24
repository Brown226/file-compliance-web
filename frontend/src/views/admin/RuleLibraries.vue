<template>
  <div class="rl-page">
      <!-- 顶部工具栏 -->
      <section class="toolbar">
          <div class="toolbar-left">
            <div class="toolbar-stats">
              <span class="stat-item"><strong>{{ libraries.length }}</strong> 个规则库</span>
              <span class="stat-sep">·</span>
              <span class="stat-item"><strong>{{ publishedCount }}</strong> 已发布</span>
              <span class="stat-sep">·</span>
              <span class="stat-item"><strong>{{ executableCount }}</strong> 条可执行</span>
            </div>
          </div>
          <div class="toolbar-right">
            <el-input
              v-model="searchKeyword"
              placeholder="搜索规则库名称/描述..."
              clearable
              prefix-icon="Search"
              class="search-input"
              @keyup.enter="fetchLibraries"
              @clear="fetchLibraries"
            />
            <el-select v-model="statusFilter" placeholder="状态筛选" clearable class="status-filter" @change="fetchLibraries">
              <el-option label="草稿" value="DRAFT" />
              <el-option label="已发布" value="PUBLISHED" />
              <el-option label="归档" value="ARCHIVED" />
            </el-select>
            <el-button type="primary" @click="showCreateDialog">
              <el-icon><Plus /></el-icon> 新建规则库
            </el-button>
          </div>
        </section>

        <!-- 规则库表格 -->
        <el-card shadow="never" class="rl-card rl-table-card">
          <el-table
            :data="libraries"
            v-loading="loading"
            empty-text="暂无规则库"
            stripe
            row-class-name="rl-table-row"
          >
            <el-table-column prop="name" label="规则库名称" min-width="180">
              <template #default="{ row }">
                <div class="lib-name-cell">
                  <div :class="['status-indicator', getStatusClass(row.status)]"></div>
                  <span class="lib-name">{{ row.name }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="cell-muted">{{ row.description || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="sourceFileName" label="源文件" width="150" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="cell-muted">{{ row.sourceFileName || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="规则数" width="90" align="center">
              <template #default="{ row }">
                <span class="cell-num">{{ row._count?.items || 0 }}</span>
              </template>
            </el-table-column>
            <el-table-column label="可执行" width="90" align="center">
              <template #default="{ row }">
                <span class="cell-num cell-num--success">{{ row.enabledExecutableItemCount || 0 }}</span>
              </template>
            </el-table-column>
            <el-table-column label="待结构化" width="90" align="center">
              <template #default="{ row }">
                <span class="cell-num cell-num--warning">{{ row.pendingStructuredItemCount || 0 }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="getStatusTagType(row.status)" size="small" effect="light">
                  {{ getStatusLabel(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="180" fixed="right">
              <template #default="{ row }">
                <el-button type="primary" link size="small" @click="showDetail(row)">查看规则</el-button>
                <el-button type="primary" link size="small" @click="showEditDialog(row)">编辑</el-button>
                <el-dropdown trigger="click" @command="(cmd: string) => handleRowCommand(cmd, row)">
                  <el-button type="primary" link size="small">
                    更多<el-icon class="el-icon--right"><ArrowDown /></el-icon>
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="ai-parse">
                        <el-icon><UploadFilled /></el-icon> AI 解析
                      </el-dropdown-item>
                      <el-dropdown-item command="publish" :disabled="row.status === 'PUBLISHED' || (row.enabledExecutableItemCount || 0) === 0">
                        <el-icon><CircleCheck /></el-icon> 发布
                        <span v-if="(row.enabledExecutableItemCount || 0) === 0" class="publish-hint">（无可执行规则）</span>
                      </el-dropdown-item>
                      <el-dropdown-item command="draft" :disabled="row.status === 'DRAFT'">
                        <el-icon><Edit /></el-icon> 撤回草稿
                      </el-dropdown-item>
                      <el-dropdown-item command="archive" :disabled="row.status === 'ARCHIVED'">
                        <el-icon><Folder /></el-icon> 归档
                      </el-dropdown-item>
                      <el-dropdown-item command="delete" divided>
                        <span style="color: #f56c6c;"><el-icon><Delete /></el-icon> 删除</span>
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <!-- 规则详情面板 -->
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
                <el-tag v-if="row.category" size="small" type="info">{{ row.category }}</el-tag>
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
    </div>

    <!-- 新建/编辑规则库对话框 -->
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

    <!-- AI解析对话框 -->
    <el-dialog v-model="parseDialogVisible" :title="`AI 解析规则 — ${parseTarget?.name || ''}`" width="560px">
      <p class="helper-text">上传规范文档后先生成候选规则，确认后再导入当前规则库。</p>

      <!-- 解析中的局部加载状态 -->
      <div v-if="isParsing" class="parse-loading-state">
        <el-icon class="is-loading" :size="32"><Loading /></el-icon>
        <div class="parse-loading-text">
          <strong>正在解析文件...</strong>
          <span v-if="parseFile">{{ parseFile.name }} ({{ (parseFile.size / (1024 * 1024)).toFixed(1) }}MB)</span>
        </div>
        <div class="parse-loading-hint">请耐心等待，大文件可能需要较长时间</div>
      </div>

      <!-- 文件上传区域（非解析状态时显示） -->
      <template v-else>
        <el-upload
          drag
          :auto-upload="false"
          :limit="1"
          accept=".docx,.doc,.pdf,.xlsx,.xls,.txt,.md"
          :on-change="handleParseFileChange"
        >
          <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
          <div class="el-upload__text">拖拽文件到此处，或 <em>点击选择</em></div>
        </el-upload>
      </template>

      <template #footer>
        <el-button @click="parseDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          @click="handleParsePreview"
          :loading="parsing"
          :disabled="isParsing"
        >
          {{ isParsing ? '解析中...' : '生成候选规则' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 候选规则预览对话框 -->
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

    <!-- 编辑规则对话框 -->
    <el-dialog v-model="itemDialogVisible" :title="itemDialogMode === 'edit' ? '编辑规则' : '手动添加规则'" width="620px">
      <el-form :model="itemForm" label-width="100px">
        <el-form-item label="规则代码">
          <el-input v-model="itemForm.ruleCode" placeholder="如 NAME_001" />
        </el-form-item>
        <el-form-item label="规则名称" required>
          <el-input v-model="itemForm.ruleName" />
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="itemForm.category">
            <el-option v-for="cat in categories" :key="cat.id" :label="cat.name" :value="cat.name" />
            <el-option label="自定义" value="" />
          </el-select>
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
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  Plus, UploadFilled, CircleCheck, Edit, Delete, ArrowDown, Loading
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
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

// 加载状态
const loading = ref(false)
const submitting = ref(false)
const parsing = ref(false)
const importing = ref(false)

// 数据
const libraries = ref<RuleLibrary[]>([])
const selectedLibrary = ref<RuleLibrary | null>(null)

// 搜索与筛选
const searchKeyword = ref('')
const statusFilter = ref<string>('')

// 对话框状态
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
const isParsing = ref(false) // 新增：解析中的状态标记

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

// 计算属性
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

// 获取状态相关方法
const getStatusClass = (status: string) => {
  const map: Record<string, string> = {
    DRAFT: 'status-draft',
    PUBLISHED: 'status-published',
    ARCHIVED: 'status-archived',
  }
  return map[status] || 'status-draft'
}

const getStatusTagType = (status: string): 'warning' | 'success' | 'info' | 'danger' | 'primary' => {
  const map: Record<string, 'warning' | 'success' | 'info'> = {
    DRAFT: 'warning',
    PUBLISHED: 'success',
    ARCHIVED: 'info',
  }
  return map[status] || 'warning'
}

const getStatusLabel = (status: string) => {
  const map: Record<string, string> = {
    DRAFT: '草稿',
    PUBLISHED: '已发布',
    ARCHIVED: '归档',
  }
  return map[status] || status
}

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
    const params: Record<string, any> = {}
    if (searchKeyword.value.trim()) params.keyword = searchKeyword.value.trim()
    if (statusFilter.value) params.status = statusFilter.value
    const { data } = await getRuleLibrariesApi(params)
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
  console.debug('[RuleLibraries] showCreateDialog called')
  isEdit.value = false
  resetLibraryForm()
  dialogVisible.value = true
  console.debug('[RuleLibraries] dialogVisible set to:', dialogVisible.value)
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
      await updateRuleLibraryApi(editId.value, {
        name: formData.name.trim(),
        description: formData.description || '',
      })
    } else {
      await createRuleLibraryApi({
        name: formData.name.trim(),
        description: formData.description || '',
      })
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

const handleRowCommand = (cmd: string, row: RuleLibrary) => {
  switch (cmd) {
    case 'ai-parse':
      showUploadRules(row)
      break
    case 'publish':
      changeStatus(row, 'PUBLISHED')
      break
    case 'draft':
      changeStatus(row, 'DRAFT')
      break
    case 'archive':
      changeStatus(row, 'ARCHIVED')
      break
    case 'delete':
      ElMessageBox.confirm('确认删除此规则库？', '删除', { type: 'warning' })
        .then(() => handleDelete(row.id))
        .catch(() => {})
      break
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

  // 文件大小检查（前端预检）
  const fileSizeMB = parseFile.value.size / (1024 * 1024)
  if (fileSizeMB > 50) {
    ElMessage.error('文件大小超过50MB限制，请选择更小的文件')
    return
  }

  parsing.value = true
  isParsing.value = true // 标记解析中状态

  try {
    const fd = new FormData()
    fd.append('file', parseFile.value)
    const { data } = await parseRulesPreviewApi(parseTarget.value.id, fd)

    previewItems.value = data?.items || []
    previewSourceFileName.value = data?.sourceFileName || parseFile.value.name

    if (previewItems.value.length === 0) {
      ElMessage.warning('未解析出任何规则，请检查文件内容是否完整')
    } else {
      ElMessage.success(`成功解析 ${previewItems.value.length} 条候选规则`)
    }

    parseDialogVisible.value = false
    previewDialogVisible.value = true
  } catch (e: any) {
    // 区分不同类型的错误
    if (e?.code === 'ECONNABORTED' || e?.message?.includes('timeout')) {
      ElMessage.error('文件解析超时，可能是文件过大或服务器繁忙，请稍后重试')
    } else if (e?.message === 'canceled') {
      ElMessage.info('请求已取消')
    } else {
      const errorMsg = e?.response?.data?.message || e?.message || '解析预览失败'

      // 针对常见错误提供更友好的提示
      if (errorMsg.includes('文件大小') || errorMsg.includes('file size')) {
        ElMessage.error('文件过大，请压缩后重试（最大支持50MB）')
      } else if (errorMsg.includes('解析失败') || errorMsg.includes('parse')) {
        ElMessage.error('文件解析失败，请检查文件格式是否支持（支持PDF/DOCX/TXT/MD等）')
      } else {
        ElMessage.error(errorMsg)
      }
    }
  } finally {
    parsing.value = false
    isParsing.value = false // 解析完成
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
  min-height: 100vh;
  background: var(--bg-body);
}

/* 工具栏 */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-4) var(--space-6);
  margin-bottom: var(--space-5);
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  border: 1px solid var(--corp-border-light);
  gap: var(--space-5);
  flex-wrap: wrap;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.search-input {
  width: 240px;
}

.status-filter {
  width: 120px;
}

.publish-hint {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
  margin-left: var(--space-1);
}

.toolbar-stats {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  background: #f5f7fa;
  padding: 5px 14px;
  border-radius: 20px;
  border: 1px solid #ebeef5;
}

.toolbar-stats .stat-item strong {
  color: var(--corp-text-primary);
  font-weight: 700;
}

.stat-sep {
  color: #dcdfe6;
}

/* 卡片样式 */
.rl-card {
  border-radius: var(--radius-xl);
  border: 1px solid var(--corp-border-light);
  overflow: hidden;
  box-shadow: var(--shadow-surface);
  transition: all var(--corp-transition-base);
}

.rl-card:hover {
  box-shadow: var(--shadow-card);
}

.rl-table-card :deep(.el-card__body),
.detail-card :deep(.el-card__body) {
  padding: var(--space-6);
}

.rl-table-card :deep(.el-table th.el-table__cell) {
  background: var(--bg-elevated);
  color: var(--corp-text-secondary);
  font-weight: 600;
  font-size: var(--text-sm);
  border-bottom: 2px solid var(--corp-border-light);
}

.rl-table-card :deep(.el-table th.el-table__cell):first-child {
  border-radius: var(--radius-lg) 0 0 0;
}

.rl-table-card :deep(.el-table th.el-table__cell):last-child {
  border-radius: 0 var(--radius-lg) 0 0;
}

.rl-table-card :deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) {
  background: #fafbfc;
}

.rl-table-card :deep(.el-table tr:hover > td.el-table__cell),
.detail-card :deep(.el-table tr:hover > td.el-table__cell) {
  background: #f0f5ff !important;
}

.rl-table-card :deep(.el-table__row) {
  transition: all var(--corp-transition-fast);
}

.rl-table-card :deep(.el-table__body tr:last-child td.el-table__cell):first-child {
  border-radius: 0 0 0 var(--radius-lg);
}

.rl-table-card :deep(.el-table__body tr:last-child td.el-table__cell):last-child {
  border-radius: 0 0 var(--radius-lg) 0;
}

.detail-card {
  margin-top: var(--space-6);
}

.lib-name-cell {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.cell-muted {
  color: var(--corp-text-tertiary);
  font-size: var(--text-sm);
}

.cell-num {
  font-weight: 700;
  font-size: var(--text-sm);
  color: var(--corp-text-primary);
}
.cell-num--success { color: #10b981; }
.cell-num--warning { color: #f59e0b; }

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.status-indicator.status-draft {
  background: var(--corp-warning);
}

.status-indicator.status-published {
  background: var(--corp-success);
}

.status-indicator.status-archived {
  background: var(--color-primary-500);
}

.lib-name {
  font-weight: 600;
  color: var(--corp-text-primary);
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-4);
}

.detail-stats {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.filters {
  display: flex;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
  padding: var(--space-5);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  border: 1px solid var(--corp-border-light);
  flex-wrap: wrap;
}

.filter-input {
  width: 260px;
}

.filter-select {
  width: 140px;
}

.helper-text {
  font-size: var(--text-base);
  color: var(--corp-text-secondary);
  margin-bottom: var(--space-5);
}

.preview-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-5);
}

.preview-meta {
  font-size: var(--text-base);
  color: var(--corp-text-secondary);
}

/* 解析中的局部加载状态 */
.parse-loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-10) var(--space-6);
  gap: var(--space-4);
  background: var(--bg-elevated);
  border-radius: var(--radius-lg);
  border: 1px dashed var(--corp-border-light);
}

.parse-loading-state .el-icon {
  color: var(--corp-primary);
}

.parse-loading-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-base);
  color: var(--corp-text-primary);
}

.parse-loading-text strong {
  font-size: var(--text-lg);
  font-weight: 600;
}

.parse-loading-text span {
  color: var(--corp-text-secondary);
  font-size: var(--text-sm);
}

.parse-loading-hint {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
}

@media (max-width: 1200px) {
  .filters {
    flex-wrap: wrap;
    gap: var(--space-4);
  }

  .filter-input {
    width: 100%;
    max-width: 300px;
  }

  .filter-select {
    width: 140px;
  }
}

@media (max-width: 768px) {
  .filters {
    padding: var(--space-4);
    gap: var(--space-3);
  }

  .filter-input {
    width: 100%;
    max-width: 100%;
  }

  .filter-select {
    width: calc(50% - var(--space-2));
  }

  .detail-header {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-4);
  }
}

@media (max-width: 480px) {
  .lib-name-cell {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
  }
}
</style>
