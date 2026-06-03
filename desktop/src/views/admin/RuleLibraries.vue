<template>
  <div class="rl-page">
      <!-- 顶部工具栏 -->
      <section class="toolbar">
          <div class="toolbar-left">
            <div class="toolbar-stats">
              <span class="stat-item"><strong>{{ libraries.length }}</strong> 规则库</span>
              <span class="stat-sep">·</span>
              <span class="stat-item"><strong>{{ publishedCount }}</strong> 已发布</span>
              <span class="stat-sep">·</span>
              <span class="stat-item"><strong>{{ executableCount }}</strong> 可执行</span>
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
            <el-button v-if="canManage" type="primary" @click="showCreateDialog">
              <el-icon><Plus /></el-icon> 新建规则库
            </el-button>
          </div>
        </section>

        <!-- 规则库卡片网格 -->
        <div class="rl-library-grid">
          <div
            v-for="library in libraries"
            :key="library.id"
            class="rl-library-card"
            :class="{ 'rl-library-card--active': selectedLibrary?.id === library.id }"
          >
            <div class="card-header">
              <div :class="['status-badge', getStatusClass(library.status)]"></div>
              <h3 class="card-title">{{ library.name }}</h3>
            </div>
            <p class="card-desc">{{ library.description || '暂无描述' }}</p>
            <div class="card-stats">
              <div class="stat">
                <span class="stat-value">{{ library._count?.items || 0 }}</span>
                <span class="stat-label">规则数</span>
              </div>
              <div class="stat stat--success">
                <span class="stat-value">{{ library.enabledExecutableItemCount || 0 }}</span>
                <span class="stat-label">可执行</span>
              </div>
              <div class="stat stat--warning">
                <span class="stat-value">{{ library.pendingStructuredItemCount || 0 }}</span>
                <span class="stat-label">待结构化</span>
              </div>
            </div>
            <div class="card-footer">
              <el-tag :type="getStatusTagType(library.status)" size="small" effect="light">{{ getStatusLabel(library.status) }}</el-tag>
              <div class="card-actions">
                <el-button type="primary" size="small" @click.stop="showDetail(library)">查看详情</el-button>
                <el-button type="success" size="small" @click.stop="showUploadRules(library)">AI 解析</el-button>
                <el-dropdown trigger="click" @command="(cmd: string) => handleRowCommand(cmd, library)">
                  <el-button type="text" size="small">更多</el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="edit">
                        <el-icon><Edit /></el-icon> 编辑
                      </el-dropdown-item>
                      <el-dropdown-item command="publish" :disabled="library.status === 'PUBLISHED' || (library.enabledExecutableItemCount || 0) === 0">
                        <el-icon><CircleCheck /></el-icon> 发布
                      </el-dropdown-item>
                      <el-dropdown-item command="draft" :disabled="library.status === 'DRAFT'">
                        <el-icon><Edit /></el-icon> 撤回草稿
                      </el-dropdown-item>
                      <el-dropdown-item command="archive" :disabled="library.status === 'ARCHIVED'">
                        <el-icon><Folder /></el-icon> 归档
                      </el-dropdown-item>
                      <el-dropdown-item command="delete" divided>
                        <span style="color: #f56c6c;"><el-icon><Delete /></el-icon> 删除</span>
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="libraries.length === 0 && !loading" class="empty-state">
          <div class="empty-icon">
            <el-icon :size="48"><Folder /></el-icon>
          </div>
          <h3 class="empty-title">暂无规则库</h3>
          <p class="empty-desc">点击右上角按钮创建第一个规则库</p>
          <el-button v-if="canManage" type="primary" @click="showCreateDialog">
            <el-icon><Plus /></el-icon> 新建规则库
          </el-button>
        </div>

        <!-- 右侧抽屉详情面板 -->
        <el-drawer 
          v-model="drawerVisible" 
          :title="selectedLibrary?.name || '规则详情'" 
          :direction="'rtl'"
          :size="780"
          class="detail-drawer"
        >
          <div v-if="selectedLibrary" class="drawer-content">
            <div class="drawer-header-info">
              <div class="header-stats">
                <el-tag type="success" size="small">启用且可执行 {{ selectedLibrary.enabledExecutableItemCount || 0 }}</el-tag>
                <el-tag type="warning" size="small">待结构化 {{ selectedLibrary.pendingStructuredItemCount || 0 }}</el-tag>
              </div>
              <div class="header-actions">
                <el-button v-if="canManage" type="primary" size="small" @click="showAddItemDialog">手动添加</el-button>
              </div>
            </div>

            <div class="filters">
              <el-input v-model="itemFilters.keyword" placeholder="搜索规则名/描述" clearable class="filter-input" />
              <el-select v-model="itemFilters.severity" placeholder="验证程度" clearable class="filter-select">
                <el-option label="错误" value="error" />
                <el-option label="警告" value="warning" />
                <el-option label="提示" value="info" />
              </el-select>
              <el-select v-model="itemFilters.enabled" placeholder="启用状态" clearable class="filter-select">
                <el-option label="启用" value="enabled" />
                <el-option label="停用" value="disabled" />
              </el-select>
            </div>

            <el-table :data="filteredItems" empty-text="暂无规则" max-height="500">
              <el-table-column prop="ruleName" label="规则名称" min-width="180" show-overflow-tooltip>
                <template #default="{ row }">
                  <span class="rule-name-cell">{{ row.ruleName || '-' }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="description" label="规则内容" min-width="250" show-overflow-tooltip>
                <template #default="{ row }">
                  <span class="rule-desc-cell">{{ row.description || row.checkMethod || '-' }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="severity" label="验证程度" width="100" align="center">
                <template #default="{ row }">
                  <el-tag :type="row.severity === 'error' ? 'danger' : row.severity === 'warning' ? 'warning' : 'info'" size="small" effect="dark">
                    {{ row.severity === 'error' ? '错误' : row.severity === 'warning' ? '警告' : '提示' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="enabled" label="启用" width="70" align="center">
                <template #default="{ row }">
                  <el-switch v-if="canManage" v-model="row.enabled" size="small" @change="toggleItem(row)" />
                  <span v-else>{{ row.enabled ? '是' : '否' }}</span>
                </template>
              </el-table-column>
              <el-table-column v-if="canManage" label="操作" width="100" fixed="right">
                <template #default="{ row }">
                  <el-button type="text" size="small" @click="showEditItemDialog(row)">编辑</el-button>
                  <el-popconfirm title="确认删除？" @confirm="handleDeleteItem(row.id)">
                    <template #reference>
                      <el-button type="danger" text size="small">删除</el-button>
                    </template>
                  </el-popconfirm>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-drawer>
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
    <el-dialog
      v-model="parseDialogVisible"
      :title="`AI 解析规则 — ${parseTarget?.name || ''}`"
      width="560px"
      :close-on-click-modal="!isParsing"
      :close-on-press-escape="!isParsing"
      :show-close="!isParsing"
      :before-close="handleParseDialogClose"
    >
      <p class="helper-text">上传规范文档后先生成候选规则，确认后再导入当前规则库。支持大文档后台异步解析，无需等待。</p>

      <!-- 解析中的进度展示 -->
      <div v-if="isParsing" class="parse-loading-state">
        <div class="parse-progress-header">
          <el-icon class="is-loading" :size="24"><Loading /></el-icon>
          <strong>{{ parseStep || '准备中...' }}</strong>
        </div>
        <el-progress
          :percentage="parseProgress"
          :stroke-width="10"
          :indeterminate="parseProgress < 10"
          style="margin: 14px 0 10px;"
        />
        <div class="parse-loading-text">
          <span v-if="parseFiles.length > 0">📄 共 {{ parseFiles.length }} 个文件，合计 {{ (parseFiles.reduce((s, f) => s + f.size, 0) / (1024 * 1024)).toFixed(1) }}MB</span>
        </div>
        <div class="parse-loading-hint">{{ parseMessage || '请耐心等待，长文档可能需要数分钟' }}</div>
        <div v-if="parseTaskId" class="parse-loading-hint" style="color: #909399; font-size: 12px; margin-top: 4px;">
          任务 ID：{{ parseTaskId.slice(0, 8) }}... 可关闭对话框，稍后在“任务列表”中查看结果
        </div>
      </div>

      <!-- 文件上传区域（非解析状态时显示） -->
      <template v-else>
        <el-upload
          drag
          multiple
          :auto-upload="false"
          :limit="5"
          accept=".docx,.doc,.pdf,.xlsx,.xls,.txt,.md"
          :on-change="handleParseFileChange"
          :on-remove="handleParseFileRemove"
          :on-exceed="() => ElMessage.warning('最多只能上传 5 个文件')"
        >
          <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
          <div class="el-upload__text">拖拽文件到此处，或 <em>点击选择</em></div>
          <template #tip>
            <div class="el-upload__tip">支持 .docx / .pdf / .xlsx / .txt / .md 等，单文件 ≤ 50MB，最多 5 个文件</div>
          </template>
        </el-upload>
      </template>

      <template #footer>
        <el-button @click="handleParseDialogClose">关闭</el-button>
        <el-button
          v-if="!isParsing"
          type="primary"
          @click="handleParsePreview"
          :loading="parsing"
        >
          生成候选规则
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
    <el-dialog v-model="itemDialogVisible" :title="itemDialogMode === 'edit' ? '编辑规则' : '手动添加规则'" width="560px">
      <el-form :model="itemForm" label-width="80px">
        <el-form-item label="规则名称" required>
          <el-input v-model="itemForm.ruleName" placeholder="请输入规则名称" />
        </el-form-item>
        <el-form-item label="验证程度">
          <el-select v-model="itemForm.severity" style="width: 100%">
            <el-option label="错误 (必须修改)" value="error" />
            <el-option label="警告 (建议修改)" value="warning" />
            <el-option label="提示 (仅供参考)" value="info" />
          </el-select>
        </el-form-item>
        <el-form-item label="规则内容">
          <el-input v-model="itemForm.description" type="textarea" :rows="4" placeholder="请输入规则的具体描述或检查方法" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="itemDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSaveItem" :loading="submitting">保存</el-button>
      </template>
    </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useUserStore } from '@/stores/user'
import { useEnterToConfirm } from '@/composables/useEnterToConfirm'
import {
  Plus, UploadFilled, CircleCheck, Edit, Delete, Folder, Loading, Search, Sparkles
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getRuleLibrariesApi,
  getRuleLibraryApi,
  createRuleLibraryApi,
  updateRuleLibraryApi,
  deleteRuleLibraryApi,
  parseRulesPreviewAsyncApi,
  getRuleParseTaskApi,
  importRulePreviewItemsApi,
  addRuleItemApi,
  updateRuleItemApi,
  deleteRuleItemApi,
  type RuleLibrary,
  type RuleLibraryItem,
  type RuleLibraryPreviewItem,
} from '@/api/rule-library'

const userStore = useUserStore()
const canManage = computed(() => userStore.isAdminOrManager())

const loading = ref(false)
const submitting = ref(false)
const parsing = ref(false)
const importing = ref(false)

const libraries = ref<RuleLibrary[]>([])
const selectedLibrary = ref<RuleLibrary | null>(null)
const drawerVisible = ref(false)

const searchKeyword = ref('')
const statusFilter = ref<string>('')

const dialogVisible = ref(false)
const isEdit = ref(false)
const editId = ref('')
const formData = reactive({ name: '', description: '' })

const parseDialogVisible = ref(false)
const previewDialogVisible = ref(false)
const parseTarget = ref<RuleLibrary | null>(null)
const parseFiles = ref<File[]>([])
const previewItems = ref<RuleLibraryPreviewItem[]>([])
const previewSourceFileName = ref('')
const importMode = ref<'merge' | 'replace'>('merge')
const isParsing = ref(false)

// 异步解析进度状态
const parseTaskId = ref<string | null>(null)
const parseProgress = ref(0)
const parseMessage = ref('')
const parseStep = ref('')
const parsePollTimer = ref<number | null>(null)

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

useEnterToConfirm(dialogVisible, handleSubmit, { disabled: submitting })

const handleDelete = async (id: string) => {
  try {
    await deleteRuleLibraryApi(id)
    ElMessage.success('删除成功')
    if (selectedLibrary.value?.id === id) {
      selectedLibrary.value = null
      drawerVisible.value = false
    }
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
    case 'edit':
      showEditDialog(row)
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
    drawerVisible.value = true
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '获取详情失败')
  }
}

const showUploadRules = (row: RuleLibrary) => {
  parseTarget.value = row
  parseFiles.value = []
  previewItems.value = []
  previewSourceFileName.value = ''
  parseTaskId.value = null
  parseProgress.value = 0
  parseMessage.value = ''
  parseStep.value = ''
  stopParsePolling()
  parseDialogVisible.value = true
}

const handleParseFileChange = (file: any, fileList: any[]) => {
  parseFiles.value = fileList.map(f => f.raw).filter(Boolean)
}

const handleParseFileRemove = (file: any) => {
  parseFiles.value = parseFiles.value.filter(f => f !== file.raw)
}

const stopParsePolling = () => {
  if (parsePollTimer.value) {
    window.clearInterval(parsePollTimer.value)
    parsePollTimer.value = null
  }
}

/** 轮询解析任务状态，直到完成或失败 */
const startParsePolling = (taskId: string) => {
  parseTaskId.value = taskId
  let attempts = 0
  const maxAttempts = 600 // 10 分钟（每秒 1 次）
  parsePollTimer.value = window.setInterval(async () => {
    attempts++
    try {
      const { data } = await getRuleParseTaskApi(taskId)
      if (data?.status === 'COMPLETED') {
        stopParsePolling()
        parseProgress.value = 100
        parseStep.value = '解析完成'
        const report = data.selfCheckReport
        const items = report?.items || []
        previewItems.value = items
        previewSourceFileName.value = report?.sourceFileName || report?.fileName || ''
        parsing.value = false
        isParsing.value = false
        parseDialogVisible.value = false
        previewDialogVisible.value = true
        if (items.length === 0) {
          ElMessage.warning('未解析出任何规则，请检查文件内容是否完整')
        } else {
          ElMessage.success(`成功解析 ${items.length} 条候选规则`)
        }
        return
      }
      if (data?.status === 'FAILED') {
        stopParsePolling()
        parsing.value = false
        isParsing.value = false
        ElMessage.error('规则解析失败，请稍后重试或检查文件内容')
        return
      }
      if (attempts >= maxAttempts) {
        stopParsePolling()
        parsing.value = false
        isParsing.value = false
        ElMessage.warning('解析时间过长，已停止轮询。请稍后在“任务列表”中查看结果')
        parseDialogVisible.value = false
      }
    } catch (err) {
      // 轮询失败仅忽略，保持继续
      console.warn('poll parse task failed', err)
    }
  }, 1000)
}

const handleParseDialogClose = () => {
  if (isParsing.value) {
    ElMessageBox.confirm(
      '解析任务正在后台执行，关闭对话框不会停止解析。完成后可在“任务列表”中查看结果。确认关闭？',
      '关闭解析对话框',
      { type: 'info', confirmButtonText: '继续解析', cancelButtonText: '关闭' },
    ).then(() => {
      // 用户选择“继续解析”，不做任何操作
    }).catch(() => {
      // 用户选择“关闭”，停止轮询并关闭
      stopParsePolling()
      parsing.value = false
      isParsing.value = false
      parseDialogVisible.value = false
    })
  } else {
    parseDialogVisible.value = false
  }
}

const handleParsePreview = async () => {
  if (!parseTarget.value?.id || parseFiles.value.length === 0) {
    ElMessage.warning('请选择至少一个文件')
    return
  }
  if (parseFiles.value.length > 5) {
    ElMessage.error('最多支持同时上传 5 个文件')
    return
  }

  // 校验单文件大小
  const oversize = parseFiles.value.find(f => f.size / (1024 * 1024) > 50)
  if (oversize) {
    ElMessage.error(`文件 "${oversize.name}" 超过 50MB 限制`)
    return
  }

  parsing.value = true
  isParsing.value = true
  parseProgress.value = 5
  parseStep.value = '上传文件'
  parseMessage.value = `正在上传 ${parseFiles.value.length} 个文件...`

  try {
    const fd = new FormData()
    parseFiles.value.forEach(f => fd.append('files', f))
    const { data } = await parseRulesPreviewAsyncApi(parseTarget.value.id, fd)

    parseProgress.value = 10
    parseStep.value = '排队解析'
    parseMessage.value = `文件已上传，正在后台排队解析（共 ${parseFiles.value.length} 个文件）...`

    if (data?.taskId) {
      startParsePolling(data.taskId)
    } else {
      ElMessage.warning('任务创建异常，请重试')
      parsing.value = false
      isParsing.value = false
    }
  } catch (e: any) {
    parsing.value = false
    isParsing.value = false
    parseProgress.value = 0
    parseMessage.value = ''
    parseStep.value = ''
    if (e?.code === 'ECONNABORTED' || e?.message?.includes('timeout')) {
      ElMessage.error('文件上传超时，可能是网络波动或服务器繁忙，请稍后重试')
    } else if (e?.message === 'canceled') {
      ElMessage.info('请求已取消')
    } else {
      const errorMsg = e?.response?.data?.message || e?.message || '解析预览失败'
      if (errorMsg.includes('文件大小') || errorMsg.includes('file size')) {
        ElMessage.error('文件过大，请压缩后重试（单文件最大 50MB）')
      } else if (errorMsg.includes('解析失败') || errorMsg.includes('parse')) {
        ElMessage.error('文件解析失败，请检查文件格式是否支持（支持 PDF/DOCX/TXT/MD 等）')
      } else {
        ElMessage.error(errorMsg)
      }
    }
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

onBeforeUnmount(() => {
  stopParsePolling()
})

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

/* 卡片网格布局 */
.rl-library-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-5);
  padding: 0 var(--space-6) var(--space-6);
}

/* 规则库卡片 */
.rl-library-card {
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: var(--radius-xl);
  padding: var(--space-5);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);

  &:hover {
    border-color: var(--corp-border-heavy);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  }
  
  &--active {
    border-color: var(--corp-primary);
    background: linear-gradient(135deg, var(--bg-surface) 0%, rgba(59, 130, 246, 0.05) 100%);
  }
}

.card-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.status-badge {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  
  &.status-draft { background: var(--corp-warning); }
  &.status-published { background: var(--corp-success); }
  &.status-archived { background: var(--color-primary-500); }
}

.card-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--corp-text-primary);
  margin: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-desc {
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  margin: 0 0 var(--space-4);
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-stats {
  display: flex;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--bg-elevated);
  border-radius: var(--radius-lg);
  margin-bottom: var(--space-4);
}

.stat {
  flex: 1;
  text-align: center;
  
  .stat-value {
    display: block;
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--corp-text-primary);
  }
  
  .stat-label {
    font-size: var(--text-xs);
    color: var(--corp-text-tertiary);
  }
  
  &--success .stat-value { color: var(--corp-success); }
  &--warning .stat-value { color: var(--corp-warning); }
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-actions {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.card-actions :deep(.el-button) {
  font-size: var(--text-xs);
  padding: 4px 12px;
  border-radius: 6px;
  font-weight: 500;
  
  &.el-button--primary,
  &.el-button--success {
    width: 80px;
    height: 32px;
    margin-left: 0;
  }
  
  &.el-button--text {
    color: var(--corp-text-secondary);
    
    &:hover {
      color: var(--corp-primary);
    }
  }
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-16) var(--space-6);
  text-align: center;
}

.empty-icon {
  color: var(--corp-text-tertiary);
  margin-bottom: var(--space-4);
}

.empty-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--corp-text-primary);
  margin: 0 0 var(--space-2);
}

.empty-desc {
  font-size: var(--text-base);
  color: var(--corp-text-secondary);
  margin: 0 0 var(--space-5);
}

/* 抽屉样式 */
.detail-drawer :deep(.el-drawer__body) {
  padding: var(--space-6);
}

.drawer-content {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.drawer-header-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-5);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--corp-border-light);
}

.header-stats {
  display: flex;
  gap: var(--space-2);
}

.header-actions {
  display: flex;
  gap: var(--space-2);
}

.filters {
  display: flex;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  border: 1px solid var(--corp-border-light);
  flex-wrap: wrap;
}

.filter-input {
  width: 220px;
}

.filter-select {
  width: 120px;
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

.parse-progress-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--corp-primary);
  font-size: var(--text-lg);
}

.parse-progress-header strong {
  color: var(--corp-text-primary);
}

/* 响应式 */
@media (max-width: 1200px) {
  .filters {
    flex-wrap: wrap;
    gap: var(--space-4);
  }

  .filter-input {
    width: 100%;
    max-width: 280px;
  }

  .filter-select {
    width: 120px;
  }
}

@media (max-width: 768px) {
  .toolbar {
    padding: var(--space-3);
  }

  .rl-library-grid {
    padding: 0 var(--space-3) var(--space-4);
    grid-template-columns: 1fr;
  }

  .search-input {
    width: 100%;
  }

  .status-filter {
    width: 100%;
  }

  .card-stats {
    gap: var(--space-2);
    padding: var(--space-3);
  }

  .stat .stat-value {
    font-size: var(--text-base);
  }

  .filters {
    padding: var(--space-3);
    gap: var(--space-3);
  }

  .filter-input {
    width: 100%;
    max-width: 100%;
  }

  .filter-select {
    width: calc(50% - var(--space-2));
  }
}

.rule-name-cell {
  font-weight: 600;
  color: var(--text-primary);
}

.rule-desc-cell {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}
</style>