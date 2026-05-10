<template>
  <div class="kd-page">
    <!-- 面包屑导航 -->
    <el-breadcrumb separator="/" class="kd-breadcrumb">
      <el-breadcrumb-item :to="{ path: '/admin/knowledge-categories' }">知识库管理</el-breadcrumb-item>
      <el-breadcrumb-item>{{ categoryInfo?.name || '文档管理' }}</el-breadcrumb-item>
    </el-breadcrumb>

    <!-- 分类信息 -->
    <div class="kd-header" v-if="categoryInfo">
      <div class="kd-header__title-row">
        <h2 class="kd-header__title">{{ categoryInfo.name }}</h2>
      </div>
      <p v-if="categoryInfo.description" class="kd-header__desc">{{ categoryInfo.description }}</p>
    </div>

    <!-- 统计卡片 -->
    <div class="kd-stats">
      <StatsCard :value="pagination.total" label="文档总数" :icon="Document" variant="primary" />
      <StatsCard :value="totalParagraphs" label="向量片段" :icon="DataAnalysis" variant="success" />
      <StatsCard :value="totalChars" label="总字符数" :icon="Notebook" variant="warning" />
    </div>

    <!-- 工具栏 + 表格 -->
    <el-card class="kd-table-card" shadow="never">
      <!-- 工具栏 -->
      <div class="kd-toolbar">
        <div class="kd-toolbar__left">
          <el-button type="primary" size="small" @click="uploadDialogVisible = true">
            <el-icon><Upload /></el-icon> 上传文档
          </el-button>
          <el-button
            size="small"
            @click="batchVectorize"
            :disabled="selectedDocs.length === 0"
          >
            <el-icon><RefreshRight /></el-icon> 批量向量化
          </el-button>
          <el-dropdown v-if="selectedDocs.length > 0">
            <el-button size="small" :disabled="selectedDocs.length === 0">
              更多 <el-icon><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="batchDelete">
                  <el-icon><Delete /></el-icon> 批量删除
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <span v-if="selectedDocs.length > 0" class="kd-toolbar__selected">
            已选 {{ selectedDocs.length }} 项
            <el-button type="primary" link size="small" @click="clearSelection">清除</el-button>
          </span>
        </div>
        <div class="kd-toolbar__right">
          <el-input
            v-model="searchQuery"
            placeholder="搜索文档名称..."
            clearable
            size="small"
            style="width: 220px;"
            :prefix-icon="Search"
            @change="handleSearch"
          />
          <el-tooltip content="刷新" placement="top">
            <el-button size="small" @click="refreshData">
              <el-icon><Refresh /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
      </div>

      <!-- 文档表格 -->
      <el-table
        ref="tableRef"
        :data="documentList"
        v-loading="loading"
        empty-text="暂无文档，请点击「上传文档」添加"
        @selection-change="handleSelectionChange"
        row-key="title"
        @row-click="handleRowClick"
        style="width: 100%"
      >
        <el-table-column type="selection" width="48" />
        <el-table-column prop="title" label="文档名称" min-width="240">
          <template #default="{ row }">
            <div class="doc-name-cell">
              <el-icon class="doc-name-cell__icon" :size="16"><Document /></el-icon>
              <span
                class="doc-name-cell__text"
                :class="{ 'is-editing': editingDoc === row.title }"
                :contenteditable="editingDoc === row.title"
                @dblclick.stop="startEditDoc(row)"
                @blur="finishEditDoc(row, $event)"
                @keydown.enter.prevent="finishEditDoc(row, $event)"
                @keydown.escape.prevent="cancelEdit"
              >{{ row.title }}</span>
              <el-icon
                v-if="editingDoc !== row.title"
                class="doc-name-cell__edit-icon"
                :size="12"
                @click.stop="startEditDoc(row)"
              ><Edit /></el-icon>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120" align="center">
          <template #default="{ row }">
            <div class="status-cell">
              <el-icon
                v-if="row.is_fully_embedded"
                class="status-cell__icon status-cell__icon--success"
                :size="14"
              ><CircleCheck /></el-icon>
              <el-icon
                v-else-if="row.embedded_count > 0"
                class="status-cell__icon status-cell__icon--warning"
                :size="14"
              ><Loading /></el-icon>
              <el-icon
                v-else
                class="status-cell__icon status-cell__icon--danger"
                :size="14"
              ><CircleClose /></el-icon>
              <span class="status-cell__text">
                {{ row.is_fully_embedded ? '已完成' : row.embedded_count > 0 ? '部分向量化' : '未向量化' }}
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="char_length" label="字符数" width="100" align="right" sortable>
          <template #default="{ row }">
            {{ formatNumber(row.char_length) }}
          </template>
        </el-table-column>
        <el-table-column prop="paragraph_count" label="段落数" width="80" align="right" sortable />
        <el-table-column label="启用" width="80" align="center">
          <template #default="{ row }">
            <el-switch
              v-model="row._isActive"
              size="small"
              @change="toggleDocActive(row)"
              @click.stop
            />
          </template>
        </el-table-column>
        <el-table-column prop="create_time" label="创建时间" width="170" sortable>
          <template #default="{ row }">
            {{ formatTime(row.create_time) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right" align="center">
          <template #default="{ row }">
            <el-tooltip content="向量化" placement="top">
              <el-button type="primary" link size="small" @click.stop="vectorizeDoc(row)">
                <el-icon><RefreshRight /></el-icon>
              </el-button>
            </el-tooltip>
            <el-tooltip content="查看段落" placement="top">
              <el-button type="primary" link size="small" @click.stop="openParagraphDrawer(row)">
                <el-icon><View /></el-icon>
              </el-button>
            </el-tooltip>
            <el-dropdown trigger="click" @command="(cmd: string) => handleRowCommand(cmd, row)">
              <el-button type="primary" link size="small" @click.stop>
                <el-icon><MoreFilled /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="delete" divided>
                    <el-icon><Delete /></el-icon> 删除
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="kd-pagination" v-if="pagination.total > 0">
        <el-pagination
          v-model:current-page="pagination.current_page"
          v-model:page-size="pagination.page_size"
          :total="pagination.total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @change="fetchDocuments"
        />
      </div>
    </el-card>

    <!-- 上传对话框 -->
    <UploadDialog
      v-model="uploadDialogVisible"
      :target-id="categoryId"
      :target-name="categoryInfo?.name || ''"
      title="上传文档"
      :upload-fn="uploadKnowledgeDocumentApi"
      @uploaded="fetchDocuments"
    />

    <!-- 段落预览抽屉 -->
    <el-drawer
      v-model="paragraphDrawerVisible"
      :title="currentParagraphTitle"
      size="600px"
      destroy-on-close
      class="paragraph-drawer"
    >
      <template #header>
        <div class="drawer-header">
          <span class="drawer-header__title">{{ currentParagraphTitle }}</span>
          <span class="drawer-header__meta" v-if="paragraphs.length > 0">
            {{ paragraphs.length }} 段 · {{ paragraphTotalChars.toLocaleString() }} 字符
          </span>
        </div>
      </template>

      <!-- 段落锚点导航 + 列表 -->
      <div class="drawer-body" v-loading="paragraphLoading">
        <template v-if="paragraphs.length > 0">
          <!-- 锚点侧栏 + 段落内容 -->
          <div class="drawer-layout">
            <div class="drawer-anchor">
              <div class="drawer-anchor__title">段落导航</div>
              <div class="drawer-anchor__list">
                <a
                  v-for="(para, idx) in paragraphs"
                  :key="para.id"
                  class="drawer-anchor__item"
                  :class="{ 'is-active': activeParagraphId === para.id }"
                  :href="`#para-${para.id}`"
                  @click.prevent="scrollToParagraph(para.id)"
                >
                  <span class="drawer-anchor__index">#{{ idx + 1 }}</span>
                  <span class="drawer-anchor__label">{{ para.clauseId || `段落 ${idx + 1}` }}</span>
                </a>
              </div>
            </div>
            <div class="drawer-content" ref="drawerContentRef">
              <div
                v-for="(para, idx) in paragraphs"
                :key="para.id"
                :id="`para-${para.id}`"
                class="para-card"
                :class="{ 'is-editing': editingParagraphId === para.id }"
              >
                <div class="para-card__header">
                  <div class="para-card__meta">
                    <el-tag size="small" type="info" effect="plain">#{{ idx + 1 }}</el-tag>
                    <span v-if="para.clauseId" class="para-card__clause">{{ para.clauseId }}</span>
                  </div>
                  <div class="para-card__actions">
                    <el-tooltip content="编辑" placement="top">
                      <el-button type="primary" link size="small" @click="startEditParagraph(para)">
                        <el-icon><Edit /></el-icon>
                      </el-button>
                    </el-tooltip>
                    <el-popconfirm title="确认删除此段落？" @confirm="handleDeleteParagraph(para.id)">
                      <template #reference>
                        <el-button type="danger" link size="small">
                          <el-icon><Delete /></el-icon>
                        </el-button>
                      </template>
                    </el-popconfirm>
                  </div>
                </div>
                <div class="para-card__body" v-if="editingParagraphId !== para.id">
                  {{ para.content }}
                </div>
                <div class="para-card__edit" v-else>
                  <el-input
                    ref="paragraphEditRef"
                    v-model="editingParagraphContent"
                    type="textarea"
                    :rows="4"
                    @keydown.escape="cancelParagraphEdit"
                  />
                  <div class="para-card__edit-actions">
                    <el-button size="small" @click="cancelParagraphEdit">取消</el-button>
                    <el-button size="small" type="primary" @click="saveParagraphEdit(para.id)">保存</el-button>
                  </div>
                </div>
                <div class="para-card__footer">
                  <span class="para-card__length">{{ para.content.length }} 字符</span>
                </div>
              </div>
            </div>
          </div>
        </template>
        <el-empty v-else-if="!paragraphLoading" description="暂无段落数据" />
      </div>
    </el-drawer>

    <!-- 向量化配置对话框 -->
    <VectorizeDialog
      v-model="vectorizeDialogVisible"
      @confirm="handleVectorizeConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, computed, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  ArrowLeft, Upload, RefreshRight, Refresh, Search,
  Document, View, Edit, Delete, ArrowDown, MoreFilled,
  CircleCheck, CircleClose, Loading, DataAnalysis, Notebook,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import StatsCard from './components/StatsCard.vue'
import UploadDialog from './components/UploadDialog.vue'
import VectorizeDialog from './components/VectorizeDialog.vue'
import {
  getKnowledgeCategoriesApi,
  getGroupedDocumentsApi,
  updateDocumentApi,
  deleteDocumentApi,
  uploadKnowledgeDocumentApi,
  getDocumentParagraphsApi,
  updateParagraphApi,
  deleteParagraphApi,
  batchVectorizeApi,
  type GroupedDocument,
  type DocumentParagraph,
} from '@/api/knowledge-category'

const router = useRouter()
const route = useRoute()
const categoryId = route.params.id as string

// ===== 分类信息 =====
const categoryInfo = ref<any>(null)

// ===== 文档列表 =====
const loading = ref(false)
const documentList = ref<Array<GroupedDocument & { _isActive: boolean }>>([])
const searchQuery = ref('')
const tableRef = ref<any>(null)
const selectedDocs = ref<any[]>([])
const editingDoc = ref<string | null>(null)
let pollTimer: any = null

const pagination = reactive({
  current_page: 1,
  page_size: 10,
  total: 0,
})

const totalParagraphs = computed(() =>
  documentList.value.reduce((sum, d) => sum + d.paragraph_count, 0)
)
const totalChars = computed(() =>
  documentList.value.reduce((sum, d) => sum + d.char_length, 0)
)

// ===== 数据加载 =====
const fetchCategoryInfo = async () => {
  try {
    const { data } = await getKnowledgeCategoriesApi()
    // 递归搜索嵌套的分类树
    const findById = (nodes: any[], id: string): any => {
      for (const node of nodes) {
        if (node.id === id) return node
        if (node.children) {
          const found = findById(node.children, id)
          if (found) return found
        }
      }
      return null
    }
    categoryInfo.value = findById(data || [], categoryId)
  } catch (_) {}
}

const fetchDocuments = async () => {
  loading.value = true
  try {
    const { data } = await getGroupedDocumentsApi(categoryId, {
      page: pagination.current_page,
      pageSize: pagination.page_size,
      query: searchQuery.value || undefined,
    })
    documentList.value = (data?.items || []).map(d => ({
      ...d,
      _isActive: true,
    }))
    pagination.total = data?.total || 0

    const hasPending = documentList.value.some(d => !d.is_fully_embedded)
    if (hasPending && !pollTimer) {
      startPolling()
    } else if (!hasPending && pollTimer) {
      stopPolling()
    }
  } catch (e) {
    console.error('获取文档列表失败', e)
  } finally {
    loading.value = false
  }
}

const refreshData = () => {
  pagination.current_page = 1
  fetchDocuments()
}

const handleSearch = () => {
  pagination.current_page = 1
  fetchDocuments()
}

// ===== 轮询 =====
const startPolling = () => {
  if (pollTimer) return
  pollTimer = setInterval(() => { fetchDocuments() }, 6000)
}

const stopPolling = () => {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

// ===== 选择 =====
const handleSelectionChange = (val: any[]) => { selectedDocs.value = val }
const clearSelection = () => { tableRef.value?.clearSelection() }

// ===== 行点击 → 打开段落 =====
const handleRowClick = (row: any, column: any) => {
  if (column?.type === 'selection') return
  openParagraphDrawer(row)
}

// ===== 文档名称编辑 =====
const startEditDoc = (row: any) => {
  editingDoc.value = row.title
  nextTick(() => {
    const el = document.querySelector('.doc-name-cell__text.is-editing') as HTMLElement
    el?.focus()
  })
}

const finishEditDoc = async (row: any, event: Event) => {
  const newName = (event.target as HTMLElement).textContent?.trim()
  editingDoc.value = null
  if (!newName || newName === row.title) return
  try {
    await updateDocumentApi(categoryId, { oldTitle: row.title, newTitle: newName })
    ElMessage.success('重命名成功')
    fetchDocuments()
  } catch { ElMessage.error('重命名失败') }
}

const cancelEdit = () => { editingDoc.value = null; fetchDocuments() }

// ===== 启用/禁用 =====
const toggleDocActive = async (row: any) => {
  try {
    await updateDocumentApi(categoryId, { oldTitle: row.title, isActive: row._isActive })
    ElMessage.success(row._isActive ? '已启用' : '已禁用')
  } catch {
    row._isActive = !row._isActive
    ElMessage.error('操作失败')
  }
}

// ===== 向量化 =====
const vectorizeDoc = async (row: any) => {
  try {
    await ElMessageBox.confirm(`确认对 "${row.title}" 重新向量化？`, '向量化确认', {
      confirmButtonText: '确认', cancelButtonText: '取消', type: 'info',
    })
  } catch { return }
  try {
    await batchVectorizeApi(categoryId, [row.title])
    ElMessage.success('向量化完成')
    fetchDocuments()
  } catch { ElMessage.error('向量化失败') }
}

const batchVectorize = async () => {
  if (selectedDocs.value.length === 0) return
  try {
    await ElMessageBox.confirm(`确认对选中的 ${selectedDocs.value.length} 个文档重新向量化？`, '批量向量化确认', {
      confirmButtonText: '确认', cancelButtonText: '取消', type: 'info',
    })
  } catch { return }
  try {
    const titles = selectedDocs.value.map(d => d.title)
    await batchVectorizeApi(categoryId, titles)
    ElMessage.success('批量向量化完成')
    clearSelection()
    fetchDocuments()
  } catch { ElMessage.error('批量向量化失败') }
}

// ===== 批量删除 =====
const batchDelete = async () => {
  if (selectedDocs.value.length === 0) return
  try {
    await ElMessageBox.confirm(
      `确认删除选中的 ${selectedDocs.value.length} 个文档及其所有向量数据？此操作不可撤销。`,
      '批量删除确认',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch { return }
  try {
    for (const doc of selectedDocs.value) {
      await deleteDocumentApi(categoryId, doc.title)
    }
    ElMessage.success(`已删除 ${selectedDocs.value.length} 个文档`)
    clearSelection()
    fetchDocuments()
  } catch { ElMessage.error('批量删除失败') }
}

// ===== 行操作 =====
const handleRowCommand = async (command: string, row: any) => {
  if (command === 'delete') {
    try {
      await ElMessageBox.confirm(`确认删除 "${row.title}" 及其所有向量数据？`, '删除确认', {
        confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning',
      })
    } catch { return }
    try {
      await deleteDocumentApi(categoryId, row.title)
      ElMessage.success('删除成功')
      fetchDocuments()
    } catch { ElMessage.error('删除失败') }
  }
}

// ===== 上传 =====
const uploadDialogVisible = ref(false)

// ===== 段落抽屉 =====
const paragraphDrawerVisible = ref(false)
const paragraphLoading = ref(false)
const currentParagraphTitle = ref('')
const paragraphs = ref<DocumentParagraph[]>([])
const paragraphTotalChars = ref(0)
const editingParagraphId = ref<string | null>(null)
const editingParagraphContent = ref('')
const activeParagraphId = ref<string | null>(null)
const drawerContentRef = ref<HTMLElement | null>(null)

const openParagraphDrawer = async (row: any) => {
  currentParagraphTitle.value = row.title
  paragraphDrawerVisible.value = true
  paragraphLoading.value = true
  paragraphs.value = []
  activeParagraphId.value = null
  try {
    const { data } = await getDocumentParagraphsApi(categoryId, row.title)
    paragraphs.value = data?.paragraphs || []
    paragraphTotalChars.value = data?.totalChars || 0
    if (paragraphs.value.length > 0) activeParagraphId.value = paragraphs.value[0].id
  } catch {
    ElMessage.error('获取段落失败')
  } finally {
    paragraphLoading.value = false
  }
}

const scrollToParagraph = (id: string) => {
  activeParagraphId.value = id
  const el = document.getElementById(`para-${id}`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const startEditParagraph = (para: DocumentParagraph) => {
  editingParagraphId.value = para.id
  editingParagraphContent.value = para.content
}

const cancelParagraphEdit = () => {
  editingParagraphId.value = null
  editingParagraphContent.value = ''
}

const saveParagraphEdit = async (paraId: string) => {
  try {
    await updateParagraphApi(paraId, { content: editingParagraphContent.value })
    ElMessage.success('段落已更新')
    const para = paragraphs.value.find(p => p.id === paraId)
    if (para) para.content = editingParagraphContent.value
    cancelParagraphEdit()
  } catch { ElMessage.error('更新失败') }
}

const handleDeleteParagraph = async (paraId: string) => {
  try {
    await deleteParagraphApi(paraId)
    ElMessage.success('段落已删除')
    paragraphs.value = paragraphs.value.filter(p => p.id !== paraId)
    paragraphTotalChars.value = paragraphs.value.reduce((sum, p) => sum + p.content.length, 0)
  } catch { ElMessage.error('删除失败') }
}

// ===== 向量化配置对话框 =====
const vectorizeDialogVisible = ref(false)
const pendingVectorizeDocs = ref<string[]>([])

const handleVectorizeConfirm = async (config: any) => {
  try {
    await batchVectorizeApi(categoryId, pendingVectorizeDocs.value)
    ElMessage.success('向量化任务已提交')
    pendingVectorizeDocs.value = []
    fetchDocuments()
  } catch {
    ElMessage.error('向量化失败')
  }
}

// ===== 导航 =====
const goBack = () => { router.push('/admin/knowledge-categories') }

// ===== 工具函数 =====
const formatNumber = (n: number) => {
  if (!n) return '0'
  return n.toLocaleString()
}

const formatTime = (t: string) => {
  if (!t) return '-'
  const d = new Date(t)
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

// ===== 生命周期 =====
onMounted(async () => {
  await fetchCategoryInfo()
  await fetchDocuments()
  startPolling()
})

onBeforeUnmount(() => { stopPolling() })
</script>

<style scoped>
.kd-page {
  padding: 0;
  animation: page-enter 0.3s ease;
}
@keyframes page-enter {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 面包屑 */
.kd-breadcrumb {
  margin-bottom: var(--space-5);
}
.kd-breadcrumb :deep(.el-breadcrumb__inner) {
  font-weight: 500;
  color: var(--corp-text-tertiary);
  font-size: var(--text-sm);
}
.kd-breadcrumb :deep(.el-breadcrumb__item:last-child .el-breadcrumb__inner) {
  color: var(--corp-text-primary);
  font-weight: 700;
}

/* 头部 */
.kd-header {
  margin-bottom: var(--space-5);
}
.kd-header__title-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.kd-header__title {
  font-size: 17px;
  font-weight: 700;
  margin: 0;
  color: var(--corp-text-primary);
  letter-spacing: -0.2px;
}
.kd-header__desc {
  font-size: var(--text-base);
  color: var(--corp-text-secondary);
  margin: var(--space-1) 0 0;
  line-height: 1.5;
}

/* 统计 */
.kd-stats {
  display: flex;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}

/* 表格卡片 */
.kd-table-card {
  border-radius: var(--radius-lg);
}
.kd-table-card :deep(.el-card__body) {
  padding: var(--space-6);
}

/* 工具栏 */
.kd-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-5);
  flex-wrap: wrap;
  gap: var(--space-2);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--corp-border-light);
}
.kd-toolbar__left {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.kd-toolbar__right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.kd-toolbar__selected {
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  background: var(--color-primary-50);
  border-radius: var(--radius-full);
}

/* 文档名称单元格 */
.doc-name-cell {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.doc-name-cell__icon {
  color: var(--corp-text-tertiary);
  flex-shrink: 0;
  transition: color var(--corp-transition-fast);
}
.doc-name-cell:hover .doc-name-cell__icon {
  color: var(--corp-primary);
}
.doc-name-cell__text {
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--corp-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  outline: none;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  transition: all var(--corp-transition-fast);
}
.doc-name-cell__text[contenteditable="true"] {
  outline: 2px solid var(--corp-primary);
  outline-offset: 1px;
  background: var(--color-primary-50);
  border-radius: var(--radius-sm);
}
.doc-name-cell__edit-icon {
  color: var(--corp-text-tertiary);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--corp-transition-fast), color var(--corp-transition-fast);
  flex-shrink: 0;
}
.doc-name-cell:hover .doc-name-cell__edit-icon {
  opacity: 1;
}
.doc-name-cell__edit-icon:hover {
  color: var(--corp-primary);
}

/* 状态单元格 */
.status-cell {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-sm);
  font-weight: 500;
}
.status-cell__icon--success { color: var(--color-success); }
.status-cell__icon--warning { color: var(--color-warning); }
.status-cell__icon--danger { color: var(--color-danger); }
.status-cell__text {
  font-size: var(--text-sm);
}

/* 分页 */
.kd-pagination {
  margin-top: var(--space-5);
  display: flex;
  justify-content: flex-end;
  padding-top: var(--space-4);
  border-top: 1px solid var(--corp-border-light);
}

/* 段落抽屉 */
.drawer-header {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}
.drawer-header__title {
  font-size: 16px;
  font-weight: 700;
  color: var(--corp-text-primary);
  letter-spacing: -0.2px;
}
.drawer-header__meta {
  font-size: var(--text-sm);
  color: var(--corp-text-tertiary);
  font-weight: 500;
}

.drawer-body {
  min-height: 200px;
}

.drawer-layout {
  display: flex;
  gap: var(--space-6);
}

/* 锚点侧栏 */
.drawer-anchor {
  width: 170px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  align-self: flex-start;
  max-height: calc(100vh - 180px);
  overflow-y: auto;
  padding-right: var(--space-4);
  border-right: 1px solid var(--corp-border-light);
}
.drawer-anchor__title {
  font-size: 10px;
  font-weight: 800;
  color: var(--corp-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: var(--space-3);
}
.drawer-anchor__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.drawer-anchor__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 5px var(--space-2);
  border-radius: var(--radius-sm);
  text-decoration: none;
  color: var(--corp-text-secondary);
  font-size: var(--text-sm);
  transition: all var(--corp-transition-fast);
  cursor: pointer;
  border-left: 2px solid transparent;
  margin-left: -1px;
}
.drawer-anchor__item:hover {
  background: rgba(59, 130, 246, 0.05);
  color: var(--corp-text-primary);
}
.drawer-anchor__item.is-active {
  background: var(--color-primary-50);
  color: var(--color-primary-700);
  font-weight: 600;
  border-left-color: var(--corp-primary);
}
.drawer-anchor__index {
  font-size: 10px;
  font-weight: 700;
  color: var(--corp-text-tertiary);
  min-width: 26px;
  font-variant-numeric: tabular-nums;
}
.drawer-anchor__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 段落内容区 */
.drawer-content {
  flex: 1;
  min-width: 0;
}

.para-card {
  background: var(--bg-surface-hover);
  border-radius: var(--radius-md);
  padding: var(--space-4) var(--space-5);
  margin-bottom: var(--space-3);
  border: 1px solid transparent;
  transition: all var(--corp-transition-fast);
  position: relative;
}
.para-card:hover {
  border-color: var(--corp-border-light);
  background: var(--bg-surface);
  box-shadow: 0 1px 4px rgba(0,0,0,0.03);
}
.para-card.is-editing {
  border-color: var(--corp-primary);
  background: var(--bg-surface);
  box-shadow: 0 0 0 1px var(--corp-primary), 0 2px 8px rgba(59,130,246,0.1);
}

.para-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-2);
}
.para-card__meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.para-card__clause {
  font-size: var(--text-sm);
  color: var(--color-primary-600);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.para-card__actions {
  display: flex;
  gap: var(--space-1);
  opacity: 0;
  transition: opacity var(--corp-transition-fast);
}
.para-card:hover .para-card__actions {
  opacity: 1;
}

.para-card__body {
  font-size: var(--text-base);
  line-height: 1.75;
  color: var(--corp-text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.para-card__edit {
  margin-top: var(--space-2);
}
.para-card__edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.para-card__footer {
  margin-top: var(--space-3);
  padding-top: var(--space-2);
  border-top: 1px solid var(--corp-border-light);
}
.para-card__length {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

/* 抽屉组件覆盖 */
:deep(.paragraph-drawer .el-drawer__header) {
  padding: var(--space-4) var(--space-6);
  margin-bottom: 0;
  border-bottom: 1px solid var(--corp-border-light);
}
:deep(.paragraph-drawer .el-drawer__body) {
  padding: var(--space-6);
}
</style>
