<template>
  <div class="rs-page">
    <div class="rs-layout">
      <aside class="rs-sidebar">
        <div class="sidebar-header">
          <h3 class="sidebar-title">规范集目录</h3>
          <div class="sidebar-actions">
            <el-button size="small" icon="FolderPlus" @click="showCreateFolderDialog">新建目录</el-button>
          </div>
        </div>
        
        <div class="folder-section">
          <el-tree
            :data="folderTree"
            :props="treeProps"
            :default-expanded-keys="expandedFolderKeys"
            :default-checked-keys="checkedFolderKeys"
            show-checkbox
            node-key="id"
            class="folder-tree"
            ref="folderTreeRef"
            @node-click="handleFolderClick"
            @check-change="handleFolderCheck"
          >
            <template #default="{ node, data }">
              <span class="tree-node">
                <el-icon v-if="data.children && data.children.length > 0" class="expand-icon">
                  <ArrowRight />
                </el-icon>
                <el-icon v-else size="14"><Files /></el-icon>
                <span class="node-label">{{ data.label }}</span>
                <span v-if="data.count !== undefined" class="tree-count">{{ data.count }}</span>
                <span class="tree-node-actions" @click.stop>
                  <el-button 
                    size="small" 
                    :icon="Plus" 
                    @click="showCreateSpecificationUnderFolder(data)" 
                    title="在此目录下新建审查规范集"
                    aria-label="在此目录下新建审查规范集"
                    class="action-btn-create-spec"
                  />
                  <el-button 
                    size="small" 
                    :icon="Edit" 
                    @click="showEditFolderDialog(data)" 
                    title="编辑"
                    aria-label="编辑目录"
                  />
                  <el-button 
                    size="small" 
                    :icon="Delete" 
                    type="danger" 
                    @click="handleDeleteFolder(data.id)" 
                    title="删除"
                    aria-label="删除目录"
                  />
                </span>
              </span>
            </template>
          </el-tree>
        </div>
      </aside>

      <main class="rs-main">
        <section class="toolbar">
          <div class="toolbar-left">
            <div class="toolbar-stats">
              <span class="stat-item"><strong>{{ specifications.length }}</strong> 个规范集</span>
              <span class="stat-sep">·</span>
              <span class="stat-item"><strong>{{ publishedCount }}</strong> 已发布</span>
              <span class="stat-sep">·</span>
              <span class="stat-item"><strong>{{ executableCount }}</strong> 条可执行</span>
            </div>
            <div v-if="activeFolderId" class="active-filter-tag">
              <el-tag closable @close="clearFolderFilter" size="small" type="info">
                当前目录: {{ activeFolderLabel }}
              </el-tag>
            </div>
          </div>
          <div class="toolbar-right">
            <el-input
              v-model="searchKeyword"
              placeholder="搜索规范集名称/描述..."
              clearable
              prefix-icon="Search"
              class="search-input"
              @keyup.enter="fetchSpecifications"
              @clear="fetchSpecifications"
            />
            <el-select v-model="statusFilter" placeholder="状态筛选" clearable class="status-filter" @change="fetchSpecifications">
              <el-option label="草稿" value="DRAFT" />
              <el-option label="已发布" value="PUBLISHED" />
              <el-option label="归档" value="ARCHIVED" />
            </el-select>
            <el-button type="primary" @click="showCreateDialog">
              <el-icon><Plus /></el-icon> 新建审查规范集
            </el-button>
          </div>
        </section>

        <el-card shadow="never" class="rs-card rs-table-card">
          <el-table :data="specifications" v-loading="loading" empty-text="暂无审查规范集">
            <el-table-column prop="name" label="规范集名称" min-width="180">
              <template #default="{ row }">
                <div class="spec-name-cell">
                  <div :class="['status-indicator', getStatusClass(row.status)]"></div>
                  <span class="spec-name">{{ row.name }}</span>
                </div>
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
                <el-tag :type="getStatusTagType(row.status)" size="small">{{ getStatusText(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="createdAt" label="创建时间" width="140">
              <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="200">
              <template #default="{ row }">
                <div class="action-buttons">
                  <el-button size="small" @click="showDetail(row)">查看</el-button>
                  <el-button size="small" type="primary" @click="showParseDialog(row)">解析规则</el-button>
                  <el-button size="small" type="success" v-if="row.status === 'DRAFT'" @click="handlePublish(row)">发布</el-button>
                  <el-button size="small" type="warning" v-if="row.status === 'PUBLISHED'" @click="handleUnpublish(row)">撤回</el-button>
                  <el-button size="small" type="danger" @click="handleDelete(row)">删除</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </main>
    </div>

    <el-dialog title="新建审查规范集" :visible="createDialogVisible" width="500px" @close="resetSpecificationForm">
      <el-form :model="formData" label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="formData.name" placeholder="如：企业新闻稿书写规范" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="formData.description" type="textarea" :rows="3" placeholder="简要描述此规范集的用途" />
        </el-form-item>
        <el-form-item label="所属目录">
          <el-tree-select
            :data="folderTree"
            v-model="formData.folderId"
            placeholder="选择目录（可选）"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetSpecificationForm">取消</el-button>
        <el-button type="primary" @click="handleCreate">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog title="编辑目录" :visible="editFolderDialogVisible" width="400px">
      <el-form :model="folderForm" label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="folderForm.name" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editFolderDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleUpdateFolder">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog title="新建目录" :visible="createFolderDialogVisible" width="400px">
      <el-form :model="folderForm" label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="folderForm.name" placeholder="目录名称" />
        </el-form-item>
        <el-form-item label="父目录">
          <el-tree-select
            :data="folderTree"
            v-model="folderForm.parentId"
            placeholder="选择父目录（可选）"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createFolderDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleCreateFolder">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog title="解析规则文件" :visible="parseDialogVisible" width="500px">
      <div v-if="!parsePreviewDone" class="parse-upload-area">
        <el-upload
          class="parse-upload"
          :action="''"
          :show-file-list="false"
          :auto-upload="false"
          :on-change="handleParseFileChange"
          accept=".docx,.pdf,.xlsx,.txt,.md"
        >
          <el-button type="primary" size="large" icon="Upload">选择文件</el-button>
          <div class="upload-hint">支持 .docx, .pdf, .xlsx, .txt, .md 格式</div>
        </el-upload>
      </div>
      <div v-else class="parse-preview-area">
        <div class="preview-header">
          <span class="preview-title">解析结果预览</span>
          <span class="preview-count">共 {{ parsePreviewItems.length }} 条候选规则</span>
        </div>
        <el-table :data="parsePreviewItems" max-height="400" border>
          <el-table-column label="规则代码" prop="ruleCode" width="120" />
          <el-table-column label="规则名称" prop="ruleName" />
          <el-table-column label="分类" prop="category" width="100" />
          <el-table-column label="执行类型" width="120">
            <template #default="{ row }">
              <el-tag :type="row.executable ? 'success' : 'warning'" size="small">
                {{ row.executable ? '可执行' : '人工审查' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="重复" width="80" align="center">
            <template #default="{ row }">
              <el-icon v-if="row.duplicate" color="#f56c6c"><Warning /></el-icon>
              <span v-else class="text-success">✓</span>
            </template>
          </el-table-column>
        </el-table>
        <div class="preview-actions">
          <el-radio-group v-model="importMode" class="import-mode">
            <el-radio label="merge">合并导入（跳过重复）</el-radio>
            <el-radio label="replace">覆盖导入（清空原有）</el-radio>
          </el-radio-group>
        </div>
      </div>
      <template #footer>
        <el-button v-if="parsePreviewDone" @click="resetParseDialog">重新选择</el-button>
        <el-button @click="parseDialogVisible = false">取消</el-button>
        <el-button v-if="parsePreviewDone" type="primary" @click="handleImportPreview">确认导入</el-button>
      </template>
    </el-dialog>

    <el-dialog title="审查规范集详情" :visible="detailDialogVisible" width="800px">
      <div v-if="currentSpecification" class="detail-content">
        <div class="detail-header">
          <div class="detail-title">{{ currentSpecification.name }}</div>
          <el-tag :type="getStatusTagType(currentSpecification.status)" size="small">{{ getStatusText(currentSpecification.status) }}</el-tag>
        </div>
        <div class="detail-info">
          <div class="info-row">
            <span class="info-label">描述：</span>
            <span class="info-value">{{ currentSpecification.description || '-' }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">源文件：</span>
            <span class="info-value">{{ currentSpecification.sourceFileName || '-' }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">创建时间：</span>
            <span class="info-value">{{ formatDate(currentSpecification.createdAt) }}</span>
          </div>
        </div>
        <div class="detail-actions">
          <el-button size="small" @click="showAddItemDialog">添加规则</el-button>
        </div>
        <el-table :data="currentSpecification.items || []" border>
          <el-table-column prop="ruleCode" label="规则代码" width="120" />
          <el-table-column prop="ruleName" label="规则名称" min-width="150" />
          <el-table-column prop="category" label="分类" width="100" />
          <el-table-column prop="severity" label="严重度" width="80">
            <template #default="{ row }">
              <el-tag :type="getSeverityTagType(row.severity)" size="small">{{ row.severity }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="executionType" label="执行类型" width="120" />
          <el-table-column prop="builtinPrefix" label="内置前缀" width="100" />
          <el-table-column label="启用" width="80" align="center">
            <template #default="{ row }">
              <el-switch :model-value="row.enabled" @change="toggleItemEnabled(row)" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120">
            <template #default="{ row }">
              <el-button size="small" @click="showEditItemDialog(row)">编辑</el-button>
              <el-button size="small" type="danger" @click="handleDeleteItem(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="detailDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog title="添加规则" :visible="addItemDialogVisible" width="600px">
      <el-form :model="itemForm" label-width="100px">
        <el-form-item label="规则代码">
          <el-input v-model="itemForm.ruleCode" placeholder="如：NAMING_001" />
        </el-form-item>
        <el-form-item label="规则名称" required>
          <el-input v-model="itemForm.ruleName" placeholder="规则名称" />
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="itemForm.category">
            <el-option label="NAMING" value="NAMING" />
            <el-option label="ENCODING" value="ENCODING" />
            <el-option label="ATTRIBUTE" value="ATTRIBUTE" />
            <el-option label="HEADER" value="HEADER" />
            <el-option label="PAGE" value="PAGE" />
            <el-option label="FORMAT" value="FORMAT" />
            <el-option label="CONSISTENCY" value="CONSISTENCY" />
            <el-option label="COMPLETENESS" value="COMPLETENESS" />
            <el-option label="DWG" value="DWG" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="itemForm.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="严重度">
          <el-select v-model="itemForm.severity">
            <el-option label="error" value="error" />
            <el-option label="warning" value="warning" />
            <el-option label="info" value="info" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addItemDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleAddItem">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog title="编辑规则" :visible="editItemDialogVisible" width="600px">
      <el-form :model="itemForm" label-width="100px">
        <el-form-item label="规则代码">
          <el-input v-model="itemForm.ruleCode" />
        </el-form-item>
        <el-form-item label="规则名称" required>
          <el-input v-model="itemForm.ruleName" />
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="itemForm.category">
            <el-option label="NAMING" value="NAMING" />
            <el-option label="ENCODING" value="ENCODING" />
            <el-option label="ATTRIBUTE" value="ATTRIBUTE" />
            <el-option label="HEADER" value="HEADER" />
            <el-option label="PAGE" value="PAGE" />
            <el-option label="FORMAT" value="FORMAT" />
            <el-option label="CONSISTENCY" value="CONSISTENCY" />
            <el-option label="COMPLETENESS" value="COMPLETENESS" />
            <el-option label="DWG" value="DWG" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="itemForm.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="严重度">
          <el-select v-model="itemForm.severity">
            <el-option label="error" value="error" />
            <el-option label="warning" value="warning" />
            <el-option label="info" value="info" />
          </el-select>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="itemForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editItemDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleUpdateItem">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { Plus, Edit, Delete, ArrowRight, Files, Upload, Warning } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import type { ReviewSpecification, ReviewSpecificationItem, SpecificationPreviewItem } from '@/api/review-specification'
import type { SpecificationFolderTreeNode } from '@/api/specification-folder'
import {
  getReviewSpecificationsApi,
  createReviewSpecificationApi,
  updateReviewSpecificationApi,
  deleteReviewSpecificationApi,
  parseRulesPreviewApi,
  importPreviewItemsApi,
  addSpecificationItemApi,
  updateSpecificationItemApi,
  deleteSpecificationItemApi,
} from '@/api/review-specification'
import {
  getSpecificationFoldersApi,
  createSpecificationFolderApi,
  updateSpecificationFolderApi,
  deleteSpecificationFolderApi,
} from '@/api/specification-folder'

const loading = ref(false)
const specifications = ref<ReviewSpecification[]>([])
const folderTree = ref<SpecificationFolderTreeNode[]>([])
const expandedFolderKeys = ref<string[]>([])
const checkedFolderKeys = ref<string[]>([])
const activeFolderId = ref<string>('')
const activeFolderLabel = ref('')
const searchKeyword = ref('')
const statusFilter = ref('')

const createDialogVisible = ref(false)
const editFolderDialogVisible = ref(false)
const createFolderDialogVisible = ref(false)
const parseDialogVisible = ref(false)
const detailDialogVisible = ref(false)
const addItemDialogVisible = ref(false)
const editItemDialogVisible = ref(false)

const currentSpecification = ref<ReviewSpecification | null>(null)
const parseSpecificationId = ref('')
const parsePreviewDone = ref(false)
const parsePreviewItems = ref<SpecificationPreviewItem[]>([])
const parseSourceFileName = ref('')
const importMode = ref<'merge' | 'replace'>('merge')

const formData = ref({
  name: '',
  description: '',
  folderId: '',
})

const folderForm = ref({
  id: '',
  name: '',
  parentId: '',
})

const itemForm = ref({
  id: '',
  ruleCode: '',
  ruleName: '',
  category: '',
  description: '',
  checkMethod: '',
  severity: 'warning',
  executionType: 'BUILTIN_PREFIX',
  builtinPrefix: '',
  targetScope: 'TEXT',
  params: null,
  messageTemplate: '',
  sourceQuote: '',
  sourceLocation: '',
  enabled: true,
})

const treeProps = {
  children: 'children',
  label: 'label',
}

const publishedCount = computed(() => specifications.value.filter((s) => s.status === 'PUBLISHED').length)
const executableCount = computed(() => specifications.value.reduce((sum, s) => sum + (s.enabledExecutableItemCount || 0), 0))

const fetchSpecifications = async () => {
  loading.value = true
  try {
    const params: Record<string, any> = {}
    if (searchKeyword.value) params.keyword = searchKeyword.value
    if (statusFilter.value) params.status = statusFilter.value
    if (activeFolderId.value) params.folderId = activeFolderId.value
    const res = await getReviewSpecificationsApi(params)
    specifications.value = res.data
  } catch (err) {
    console.error('Fetch specifications error:', err)
  } finally {
    loading.value = false
  }
}

const fetchFolders = async () => {
  try {
    const res = await getSpecificationFoldersApi()
    folderTree.value = res.data
  } catch (err) {
    console.error('Fetch folders error:', err)
  }
}

const showCreateDialog = () => {
  isEdit.value = false
  resetSpecificationForm()
  createDialogVisible.value = true
}

const isEdit = ref(false)

const showCreateSpecificationUnderFolder = (folderData: SpecificationFolderTreeNode) => {
  isEdit.value = false
  resetSpecificationForm()
  formData.value.folderId = folderData.id
  createDialogVisible.value = true
  ElMessage.info(`将在目录 "${folderData.label}" 下创建审查规范集`)
}

const resetSpecificationForm = () => {
  formData.value = { name: '', description: '', folderId: '' }
  createDialogVisible.value = false
}

const handleCreate = async () => {
  if (!formData.value.name.trim()) {
    ElMessage.warning('请输入名称')
    return
  }
  try {
    await createReviewSpecificationApi({
      name: formData.value.name.trim(),
      description: formData.value.description,
      folderId: formData.value.folderId || null,
    })
    ElMessage.success('创建成功')
    resetSpecificationForm()
    fetchSpecifications()
    fetchFolders()
  } catch (err) {
    ElMessage.error('创建失败')
  }
}

const showEditFolderDialog = (data: SpecificationFolderTreeNode) => {
  folderForm.value = { id: data.id, name: data.label, parentId: data.parentId || '' }
  editFolderDialogVisible.value = true
}

const handleUpdateFolder = async () => {
  if (!folderForm.value.name.trim()) {
    ElMessage.warning('请输入名称')
    return
  }
  try {
    await updateSpecificationFolderApi(folderForm.value.id, { name: folderForm.value.name.trim() })
    ElMessage.success('更新成功')
    editFolderDialogVisible.value = false
    fetchFolders()
  } catch (err) {
    ElMessage.error('更新失败')
  }
}

const showCreateFolderDialog = () => {
  folderForm.value = { id: '', name: '', parentId: '' }
  createFolderDialogVisible.value = true
}

const handleCreateFolder = async () => {
  if (!folderForm.value.name.trim()) {
    ElMessage.warning('请输入名称')
    return
  }
  try {
    await createSpecificationFolderApi({ name: folderForm.value.name.trim(), parentId: folderForm.value.parentId || null })
    ElMessage.success('创建成功')
    createFolderDialogVisible.value = false
    fetchFolders()
  } catch (err) {
    ElMessage.error('创建失败')
  }
}

const handleDeleteFolder = async (id: string) => {
  const confirm = await ElMessageBox.confirm('确定删除该目录？目录下的规范集将被移动到根目录。', '提示', { type: 'warning' })
  if (confirm !== 'confirm') return
  try {
    await deleteSpecificationFolderApi(id)
    ElMessage.success('删除成功')
    fetchFolders()
    fetchSpecifications()
  } catch (err) {
    ElMessage.error('删除失败')
  }
}

const handleFolderClick = (data: SpecificationFolderTreeNode) => {
  activeFolderId.value = data.id
  activeFolderLabel.value = data.label
  fetchSpecifications()
}

const handleFolderCheck = () => {}

const clearFolderFilter = () => {
  activeFolderId.value = ''
  activeFolderLabel.value = ''
  fetchSpecifications()
}

const showParseDialog = (row: ReviewSpecification) => {
  parseSpecificationId.value = row.id
  parsePreviewDone.value = false
  parsePreviewItems.value = []
  parseDialogVisible.value = true
}

const handleParseFileChange = async (file: any) => {
  const formData = new FormData()
  formData.append('file', file.raw)
  try {
    const res = await parseRulesPreviewApi(parseSpecificationId.value, formData)
    parsePreviewItems.value = res.data.items
    parseSourceFileName.value = res.data.sourceFileName || ''
    parsePreviewDone.value = true
  } catch (err) {
    ElMessage.error('解析失败')
  }
}

const resetParseDialog = () => {
  parsePreviewDone.value = false
  parsePreviewItems.value = []
  parseSourceFileName.value = ''
}

const handleImportPreview = async () => {
  try {
    await importPreviewItemsApi(parseSpecificationId.value, {
      items: parsePreviewItems.value,
      mode: importMode.value,
      sourceFileName: parseSourceFileName.value,
    })
    ElMessage.success('导入成功')
    parseDialogVisible.value = false
    fetchSpecifications()
  } catch (err) {
    ElMessage.error('导入失败')
  }
}

const showDetail = async (row: ReviewSpecification) => {
  try {
    const res = await getReviewSpecificationsApi({})
    currentSpecification.value = res.data.find((s) => s.id === row.id) || row
    detailDialogVisible.value = true
  } catch (err) {
    currentSpecification.value = row
    detailDialogVisible.value = true
  }
}

const showAddItemDialog = () => {
  itemForm.value = {
    id: '',
    ruleCode: '',
    ruleName: '',
    category: '',
    description: '',
    checkMethod: '',
    severity: 'warning',
    executionType: 'BUILTIN_PREFIX',
    builtinPrefix: '',
    targetScope: 'TEXT',
    params: null,
    messageTemplate: '',
    sourceQuote: '',
    sourceLocation: '',
    enabled: true,
  }
  addItemDialogVisible.value = true
}

const handleAddItem = async () => {
  if (!itemForm.value.ruleName.trim()) {
    ElMessage.warning('请输入规则名称')
    return
  }
  try {
    await addSpecificationItemApi(currentSpecification.value!.id, {
      ruleCode: itemForm.value.ruleCode,
      ruleName: itemForm.value.ruleName.trim(),
      category: itemForm.value.category,
      description: itemForm.value.description,
      checkMethod: itemForm.value.checkMethod,
      severity: itemForm.value.severity,
      executionType: itemForm.value.executionType as any,
      builtinPrefix: itemForm.value.builtinPrefix,
      targetScope: itemForm.value.targetScope as any,
      params: itemForm.value.params,
      messageTemplate: itemForm.value.messageTemplate,
      sourceQuote: itemForm.value.sourceQuote,
      sourceLocation: itemForm.value.sourceLocation,
    })
    ElMessage.success('添加成功')
    addItemDialogVisible.value = false
    await showDetail(currentSpecification.value!)
  } catch (err) {
    ElMessage.error('添加失败')
  }
}

const showEditItemDialog = (item: ReviewSpecificationItem) => {
  itemForm.value = {
    id: item.id,
    ruleCode: item.ruleCode || '',
    ruleName: item.ruleName || '',
    category: item.category || '',
    description: item.description || '',
    checkMethod: item.checkMethod || '',
    severity: item.severity || 'warning',
    executionType: item.executionType as any || 'BUILTIN_PREFIX',
    builtinPrefix: item.builtinPrefix || '',
    targetScope: item.targetScope as any || 'TEXT',
    params: item.params || null,
    messageTemplate: item.messageTemplate || '',
    sourceQuote: item.sourceQuote || '',
    sourceLocation: item.sourceLocation || '',
    enabled: item.enabled,
  }
  editItemDialogVisible.value = true
}

const handleUpdateItem = async () => {
  if (!itemForm.value.ruleName.trim()) {
    ElMessage.warning('请输入规则名称')
    return
  }
  try {
    await updateSpecificationItemApi(itemForm.value.id, {
      ruleCode: itemForm.value.ruleCode,
      ruleName: itemForm.value.ruleName.trim(),
      category: itemForm.value.category,
      description: itemForm.value.description,
      checkMethod: itemForm.value.checkMethod,
      severity: itemForm.value.severity,
      enabled: itemForm.value.enabled,
      executionType: itemForm.value.executionType as any,
      builtinPrefix: itemForm.value.builtinPrefix || null,
      targetScope: itemForm.value.targetScope as any,
      params: itemForm.value.params,
      messageTemplate: itemForm.value.messageTemplate || null,
      sourceQuote: itemForm.value.sourceQuote || null,
      sourceLocation: itemForm.value.sourceLocation || null,
    })
    ElMessage.success('更新成功')
    editItemDialogVisible.value = false
    await showDetail(currentSpecification.value!)
  } catch (err) {
    ElMessage.error('更新失败')
  }
}

const toggleItemEnabled = async (item: ReviewSpecificationItem) => {
  try {
    await updateSpecificationItemApi(item.id, { enabled: !item.enabled })
    ElMessage.success('更新成功')
    await showDetail(currentSpecification.value!)
  } catch (err) {
    ElMessage.error('更新失败')
  }
}

const handleDeleteItem = async (item: ReviewSpecificationItem) => {
  const confirm = await ElMessageBox.confirm('确定删除这条规则？', '提示', { type: 'warning' })
  if (confirm !== 'confirm') return
  try {
    await deleteSpecificationItemApi(item.id)
    ElMessage.success('删除成功')
    await showDetail(currentSpecification.value!)
  } catch (err) {
    ElMessage.error('删除失败')
  }
}

const handlePublish = async (row: ReviewSpecification) => {
  const confirm = await ElMessageBox.confirm('确定发布此审查规范集？发布后将可用于审查任务。', '提示', { type: 'info' })
  if (confirm !== 'confirm') return
  try {
    await updateReviewSpecificationApi(row.id, { status: 'PUBLISHED' })
    ElMessage.success('发布成功')
    fetchSpecifications()
  } catch (err) {
    ElMessage.error('发布失败，可能是因为没有可执行的规则')
  }
}

const handleUnpublish = async (row: ReviewSpecification) => {
  const confirm = await ElMessageBox.confirm('确定撤回此审查规范集？撤回后将不可用于审查任务。', '提示', { type: 'warning' })
  if (confirm !== 'confirm') return
  try {
    await updateReviewSpecificationApi(row.id, { status: 'DRAFT' })
    ElMessage.success('撤回成功')
    fetchSpecifications()
  } catch (err) {
    ElMessage.error('撤回失败')
  }
}

const handleDelete = async (row: ReviewSpecification) => {
  const confirm = await ElMessageBox.confirm('确定删除此审查规范集？', '提示', { type: 'danger' })
  if (confirm !== 'confirm') return
  try {
    await deleteReviewSpecificationApi(row.id)
    ElMessage.success('删除成功')
    fetchSpecifications()
    fetchFolders()
  } catch (err) {
    ElMessage.error('删除失败')
  }
}

const getStatusClass = (status: string) => {
  return {
    'status-draft': status === 'DRAFT',
    'status-published': status === 'PUBLISHED',
    'status-archived': status === 'ARCHIVED',
  }
}

const getStatusTagType = (status: string) => {
  return {
    DRAFT: 'info',
    PUBLISHED: 'success',
    ARCHIVED: 'warning',
  }[status] || 'info'
}

const getStatusText = (status: string) => {
  return {
    DRAFT: '草稿',
    PUBLISHED: '已发布',
    ARCHIVED: '归档',
  }[status] || status
}

const getSeverityTagType = (severity?: string) => {
  return {
    error: 'danger',
    warning: 'warning',
    info: 'info',
  }[severity || 'warning'] || 'warning'
}

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

watch([searchKeyword, statusFilter], () => {
  fetchSpecifications()
})

onMounted(() => {
  fetchSpecifications()
  fetchFolders()
})
</script>

<style scoped>
.rs-page {
  min-height: 100vh;
  background: #f5f7fa;
}

.rs-layout {
  display: flex;
  min-height: calc(100vh - 60px);
}

.rs-sidebar {
  width: 280px;
  background: #fff;
  border-right: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sidebar-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}

.folder-section {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.folder-tree {
  font-size: 13px;
}

.tree-node {
  display: flex;
  align-items: center;
  padding: 4px 0;
}

.expand-icon {
  margin-right: 4px;
  font-size: 12px;
}

.node-label {
  flex: 1;
  margin-left: 4px;
}

.tree-count {
  font-size: 12px;
  color: #909399;
  margin-right: 8px;
}

.tree-node-actions {
  visibility: hidden;
  display: flex;
  gap: 4px;
}

.folder-tree :deep(.el-tree-node):hover .tree-node-actions {
  visibility: visible;
}

.action-btn-create-spec {
  color: #10b981 !important;
  background: rgba(16, 185, 129, 0.1) !important;
}

.rs-main {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.toolbar-stats {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stat-item {
  font-size: 13px;
  color: #606266;
}

.stat-sep {
  color: #d9d9d9;
}

.active-filter-tag {
  margin-left: 8px;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.search-input {
  width: 280px;
}

.status-filter {
  width: 120px;
}

.rs-card {
  border-radius: 8px;
}

.rs-table-card {
  margin-bottom: 0;
}

.spec-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-draft {
  background: #909399;
}

.status-published {
  background: #67c23a;
}

.status-archived {
  background: #e6a23c;
}

.spec-name {
  font-weight: 500;
}

.action-buttons {
  display: flex;
  gap: 8px;
}

.action-buttons :deep(.el-button) {
  padding: 4px 12px;
}

.parse-upload-area {
  padding: 40px;
  text-align: center;
}

.upload-hint {
  margin-top: 12px;
  color: #909399;
  font-size: 13px;
}

.parse-preview-area {
  max-height: 500px;
  overflow-y: auto;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.preview-title {
  font-weight: 600;
}

.preview-count {
  color: #909399;
  font-size: 13px;
}

.preview-actions {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #e4e7ed;
}

.import-mode {
  display: flex;
  gap: 20px;
}

.detail-content {
  padding: 8px 0;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.detail-title {
  font-size: 18px;
  font-weight: 600;
}

.detail-info {
  margin-bottom: 16px;
  padding: 12px;
  background: #f5f7fa;
  border-radius: 4px;
}

.info-row {
  display: flex;
  margin-bottom: 8px;
}

.info-row:last-child {
  margin-bottom: 0;
}

.info-label {
  color: #909399;
  width: 80px;
}

.info-value {
  flex: 1;
}

.detail-actions {
  margin-bottom: 16px;
}
</style>