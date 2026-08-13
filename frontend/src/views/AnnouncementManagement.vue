<template>
  <div class="announcement-management">
    <!-- 页面标题栏 -->
    <div class="page-header">
      <div class="header-title">
        <h1>系统公告</h1>
        <span class="header-sub">发布后将自动在用户登录时弹窗展示</span>
      </div>
      <el-button type="primary" size="default" @click="handleCreate">
        <el-icon><Plus /></el-icon> 新建公告
      </el-button>
    </div>

    <!-- 状态筛选 -->
    <div class="filter-bar">
      <el-radio-group v-model="statusFilter" size="small" @change="handleStatusChange">
        <el-radio-button v-for="tab in statusTabs" :key="tab.name" :value="tab.name">
          {{ tab.label }}
        </el-radio-button>
      </el-radio-group>
      <div class="list-meta">共 {{ total }} 条公告</div>
    </div>

    <!-- 公告列表 -->
    <div class="table-card" v-loading="loading">
      <el-table
        :data="announcements"
        style="width: 100%"
        row-key="id"
      >
        <el-table-column prop="title" label="标题" min-width="220" show-overflow-tooltip />

        <el-table-column label="紧急程度" width="110" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="urgencyTagType(row.urgency)">
              {{ urgencyLabel(row.urgency) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="statusTagType(row.status)">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="发布时间" width="170" align="center">
          <template #default="{ row }">
            {{ row.publishAt ? formatDate(row.publishAt) : '-' }}
          </template>
        </el-table-column>

        <el-table-column label="创建人" width="130" align="center">
          <template #default="{ row }">
            {{ row.creator?.name || row.creator?.username || '-' }}
          </template>
        </el-table-column>

        <el-table-column label="操作" width="200" align="center" fixed="right">
          <template #default="{ row }">
            <div class="action-group">
              <el-button
                v-if="row.status === 'DRAFT'"
                link type="primary" size="small"
                @click="handleEdit(row)"
              >编辑</el-button>
              <el-button
                v-if="row.status === 'DRAFT'"
                link type="success" size="small"
                @click="handlePublish(row)"
              >发布</el-button>
              <el-button
                v-if="row.status === 'PUBLISHED'"
                link type="primary" size="small"
                @click="handleView(row)"
              >查看</el-button>
              <el-button
                v-if="row.status === 'PUBLISHED'"
                link type="warning" size="small"
                @click="handleWithdraw(row)"
              >撤回</el-button>
              <el-button
                v-if="row.status === 'DRAFT' || row.status === 'WITHDRAWN'"
                link type="danger" size="small"
                @click="handleDelete(row)"
              >删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="announcements.length === 0 && !loading" class="empty-state">
        <div class="empty-icon">
          <el-icon :size="40"><InfoFilled /></el-icon>
        </div>
        <p>暂无公告</p>
        <span>点击右上角「新建公告」发布第一条公告</span>
      </div>
    </div>

    <!-- 分页 -->
    <div class="pagination-wrap">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="limit"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="loadAnnouncements"
        @current-change="loadAnnouncements"
      />
    </div>

    <!-- 创建/编辑/查看对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="820px"
      destroy-on-close
      class="announcement-dialog"
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="76px"
        label-position="left"
        :disabled="dialogType === 'view'"
      >
        <div class="dialog-section">
          <div class="section-title">基础信息</div>
          <div class="form-grid">
            <el-form-item label="标题" prop="title" class="full-width">
              <el-input v-model="form.title" placeholder="请输入公告标题" maxlength="200" show-word-limit />
            </el-form-item>
            <el-form-item label="紧急程度" prop="urgency">
              <el-select v-model="form.urgency" placeholder="请选择紧急程度" style="width: 100%">
                <el-option label="普通" value="NORMAL" />
                <el-option label="重要" value="IMPORTANT" />
                <el-option label="紧急" value="URGENT" />
              </el-select>
            </el-form-item>
          </div>
        </div>

        <div class="dialog-section">
          <div class="section-title">
            <span>公告内容</span>
            <span v-if="dialogType !== 'view'" class="section-tip">支持 Markdown 格式</span>
          </div>

          <div class="markdown-editor-wrap">
            <div class="md-toolbar" v-if="dialogType !== 'view'">
              <div class="toolbar-group">
                <button class="md-tool" @click="insertMd('**', '**')" title="粗体"><strong>B</strong></button>
                <button class="md-tool" @click="insertMd('*', '*')" title="斜体"><em>I</em></button>
                <button class="md-tool" @click="insertMd('## ', '')" title="标题">H2</button>
              </div>
              <div class="toolbar-divider"></div>
              <div class="toolbar-group">
                <button class="md-tool" @click="insertMd('- ', '')" title="列表">列表</button>
                <button class="md-tool" @click="insertMd('[', '](url)')" title="链接">链接</button>
                <button class="md-tool" @click="insertMd('`', '`')" title="代码">代码</button>
              </div>
              <div class="toolbar-divider"></div>
              <button
                class="md-tool preview-toggle"
                :class="{ active: activeTab === 'preview' }"
                @click="activeTab = 'preview'"
              >
                预览
              </button>
            </div>

            <el-tabs v-model="activeTab" type="card" class="md-tabs">
              <el-tab-pane label="编辑" name="edit">
                <el-input
                  v-model="form.content"
                  type="textarea"
                  :rows="15"
                  placeholder="支持 Markdown 格式"
                  :disabled="dialogType === 'view'"
                />
              </el-tab-pane>
              <el-tab-pane label="预览" name="preview">
                <div class="markdown-preview" v-html="renderedContent"></div>
              </el-tab-pane>
            </el-tabs>
          </div>
        </div>
      </el-form>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button
            v-if="dialogType !== 'view'"
            @click="handleSaveDraft"
            :loading="submitting"
          >
            保存草稿
          </el-button>
          <el-button
            v-if="dialogType !== 'view'"
            type="primary"
            @click="handlePublishDirect"
            :loading="submitting"
          >
            保存并发布
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, InfoFilled } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import type { SystemAnnouncement } from '@/types/models'
import { useMarkdown } from '@/composables/useMarkdown'
import {
  getAnnouncementsApi,
  createAnnouncementApi,
  updateAnnouncementApi,
  publishAnnouncementApi,
  withdrawAnnouncementApi,
  deleteAnnouncementApi,
} from '@/api/announcement'

const { renderMarkdown } = useMarkdown()

// 列表状态
const loading = ref(false)
const announcements = ref<SystemAnnouncement[]>([])
const statusFilter = ref('ALL')
const page = ref(1)
const limit = ref(10)
const total = ref(0)

const statusTabs = [
  { name: 'ALL', label: '全部' },
  { name: 'DRAFT', label: '草稿' },
  { name: 'PUBLISHED', label: '已发布' },
  { name: 'WITHDRAWN', label: '已撤回' },
]

// 对话框状态
const dialogVisible = ref(false)
const dialogType = ref<'create' | 'edit' | 'view'>('create')
const formRef = ref<FormInstance>()
const submitting = ref(false)
const activeTab = ref('edit')

// 表单数据
const form = reactive({
  id: '',
  title: '',
  content: '',
  urgency: 'NORMAL',
})

const dialogTitle = computed(() => {
  if (dialogType.value === 'create') return '新建公告'
  if (dialogType.value === 'edit') return '编辑公告'
  return '查看公告'
})

// 表单验证规则
const rules: FormRules = {
  title: [
    { required: true, message: '请输入公告标题', trigger: 'blur' },
    { min: 1, max: 200, message: '标题长度不能超过 200 个字符', trigger: 'blur' },
  ],
  content: [
    { required: true, message: '请输入公告内容', trigger: 'blur' },
  ],
  urgency: [
    { required: true, message: '请选择紧急程度', trigger: 'change' },
  ],
}

// 渲染后的 Markdown 内容
const renderedContent = computed(() => {
  return renderMarkdown(form.content)
})

async function loadAnnouncements() {
  loading.value = true
  try {
    const params: any = {
      page: page.value,
      limit: limit.value,
    }
    if (statusFilter.value !== 'ALL') {
      params.status = statusFilter.value
    }

    const res = await getAnnouncementsApi(params)
    announcements.value = res.data.items || []
    total.value = res.data.total || 0
  } catch (error) {
    console.error('加载公告列表失败:', error)
    ElMessage.error('加载公告列表失败')
  } finally {
    loading.value = false
  }
}

function handleStatusChange(status: string) {
  if (statusFilter.value === status) return
  statusFilter.value = status
  page.value = 1
  loadAnnouncements()
}

function handleCreate() {
  dialogType.value = 'create'
  resetForm()
  dialogVisible.value = true
  activeTab.value = 'edit'
}

function handleEdit(row: SystemAnnouncement) {
  dialogType.value = 'edit'
  resetForm()
  form.id = row.id
  form.title = row.title
  form.content = row.content
  form.urgency = row.urgency
  dialogVisible.value = true
  activeTab.value = 'edit'
}

function handleView(row: SystemAnnouncement) {
  dialogType.value = 'view'
  resetForm()
  form.id = row.id
  form.title = row.title
  form.content = row.content
  form.urgency = row.urgency
  dialogVisible.value = true
  activeTab.value = 'preview'
}

async function handlePublish(row: SystemAnnouncement) {
  try {
    await ElMessageBox.confirm('确定要发布此公告吗？发布后用户将看到弹窗。', '确认发布', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })

    await publishAnnouncementApi(row.id)
    ElMessage.success('公告发布成功')
    loadAnnouncements()
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('发布公告失败:', error)
      ElMessage.error('发布公告失败')
    }
  }
}

async function handleWithdraw(row: SystemAnnouncement) {
  try {
    await ElMessageBox.confirm('确定要撤回此公告吗？撤回后用户将不再看到此公告。', '确认撤回', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })

    await withdrawAnnouncementApi(row.id)
    ElMessage.success('公告已撤回')
    loadAnnouncements()
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('撤回公告失败:', error)
      ElMessage.error('撤回公告失败')
    }
  }
}

async function handleDelete(row: SystemAnnouncement) {
  try {
    await ElMessageBox.confirm('确定要删除此公告吗？此操作不可恢复。', '确认删除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })

    await deleteAnnouncementApi(row.id)
    ElMessage.success('公告已删除')
    loadAnnouncements()
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('删除公告失败:', error)
      ElMessage.error('删除公告失败')
    }
  }
}

async function handleSaveDraft() {
  if (!formRef.value) return

  try {
    await formRef.value.validate()
    submitting.value = true

    if (dialogType.value === 'create') {
      await createAnnouncementApi({
        title: form.title,
        content: form.content,
        urgency: form.urgency,
      })
      ElMessage.success('草稿保存成功')
    } else {
      await updateAnnouncementApi(form.id, {
        title: form.title,
        content: form.content,
        urgency: form.urgency,
      })
      ElMessage.success('草稿更新成功')
    }

    dialogVisible.value = false
    loadAnnouncements()
  } catch (error: any) {
    if (error?.message) {
      ElMessage.error(error.message)
    }
  } finally {
    submitting.value = false
  }
}

async function handlePublishDirect() {
  if (!formRef.value) return

  try {
    await formRef.value.validate()
    submitting.value = true

    let announcementId = form.id

    if (dialogType.value === 'create') {
      const res = await createAnnouncementApi({
        title: form.title,
        content: form.content,
        urgency: form.urgency,
      })
      announcementId = res.data.id
      ElMessage.success('公告创建成功')
    } else {
      await updateAnnouncementApi(form.id, {
        title: form.title,
        content: form.content,
        urgency: form.urgency,
      })
      ElMessage.success('公告更新成功')
    }

    await publishAnnouncementApi(announcementId)
    ElMessage.success('公告已发布')

    dialogVisible.value = false
    loadAnnouncements()
  } catch (error: any) {
    if (error?.message) {
      ElMessage.error(error.message)
    }
  } finally {
    submitting.value = false
  }
}

function insertMd(before: string, after: string) {
  const textarea = document.querySelector('.md-tabs .el-textarea__inner') as HTMLTextAreaElement
  if (!textarea) return

  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const text = form.content
  const selectedText = text.substring(start, end) || '文本'

  form.content = text.substring(0, start) + before + selectedText + after + text.substring(end)

  setTimeout(() => {
    textarea.focus()
    textarea.setSelectionRange(start + before.length, start + before.length + selectedText.length)
  }, 0)
}

function resetForm() {
  form.id = ''
  form.title = ''
  form.content = ''
  form.urgency = 'NORMAL'
  if (formRef.value) {
    formRef.value.resetFields()
  }
}

function urgencyTagType(urgency: string): 'success' | 'warning' | 'danger' | 'info' {
  switch (urgency) {
    case 'URGENT': return 'danger'
    case 'IMPORTANT': return 'warning'
    default: return 'info'
  }
}

function urgencyLabel(urgency: string): string {
  switch (urgency) {
    case 'URGENT': return '紧急'
    case 'IMPORTANT': return '重要'
    default: return '普通'
  }
}

function statusTagType(status: string): 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'PUBLISHED': return 'success'
    case 'DRAFT': return 'info'
    case 'WITHDRAWN': return 'warning'
    default: return 'info'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'PUBLISHED': return '已发布'
    case 'DRAFT': return '草稿'
    case 'WITHDRAWN': return '已撤回'
    default: return '未知'
  }
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

onMounted(() => {
  loadAnnouncements()
})
</script>

<style scoped>
.announcement-management {
  padding: var(--space-6) var(--space-8) var(--space-10);
  background: var(--bg-body);
  min-height: 100%;
}

/* 页面标题栏 */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-6);
}

.header-title h1 {
  margin: 0;
  font-size: var(--text-2xl);
  font-weight: 600;
  color: var(--corp-text-primary);
  letter-spacing: -0.3px;
}

.header-sub {
  font-size: var(--text-base);
  color: var(--corp-text-secondary);
  margin-top: var(--space-1);
  display: block;
}

/* 筛选栏 */
.filter-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-5);
}

.list-meta {
  font-size: var(--text-base);
  color: var(--corp-text-tertiary);
}

/* 表格卡片（表头/行边框样式由全局 element-overrides 统一） */
.table-card {
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

/* 操作按钮组 */
.action-group {
  display: flex;
  justify-content: center;
  gap: 10px;
}

/* 空状态 */
.empty-state {
  padding: 60px 0;
  text-align: center;
  color: var(--corp-text-tertiary);
}

.empty-icon {
  margin-bottom: var(--space-4);
  color: var(--corp-border);
}

.empty-state p {
  margin: 0 0 var(--space-1);
  font-size: var(--text-lg);
  color: var(--corp-text-secondary);
}

.empty-state span {
  font-size: var(--text-sm);
}

/* 分页 */
.pagination-wrap {
  margin-top: var(--space-6);
  display: flex;
  justify-content: center;
}

/* 对话框 */
.announcement-dialog :deep(.el-dialog__body) {
  padding: 0 var(--space-8);
}

.announcement-dialog :deep(.el-dialog__footer) {
  padding: var(--space-6) var(--space-8) var(--space-8);
  border-top: 1px solid var(--corp-border-light);
}

.dialog-section {
  margin-bottom: var(--space-6);
}

.dialog-section:last-child {
  margin-bottom: 0;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--corp-text-primary);
  margin-bottom: var(--space-5);
}

.section-tip {
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--corp-text-tertiary);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 240px;
  gap: var(--space-6);
}

.form-grid .full-width {
  grid-column: 1 / -1;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

/* Markdown 编辑器 */
.markdown-editor-wrap {
  border: 1px solid var(--corp-border-light);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.md-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: var(--space-2) var(--space-4);
  background: var(--bg-surface-hover);
  border-bottom: 1px solid var(--corp-border-light);
}

.toolbar-group {
  display: flex;
  gap: var(--space-1);
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  background: var(--corp-border-light);
}

.md-tool {
  min-width: 28px;
  height: 28px;
  padding: 0 var(--space-2);
  font-size: var(--text-base);
  color: var(--color-gray-700);
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: color var(--corp-transition-fast), border-color var(--corp-transition-fast), background var(--corp-transition-fast);
}

.md-tool:hover {
  color: var(--color-primary-600);
  border-color: var(--color-primary-200);
  background: var(--color-primary-50);
}

.md-tool.preview-toggle.active {
  color: var(--color-primary-600);
  background: var(--color-primary-50);
  border-color: var(--color-primary-200);
}

.md-tabs {
  margin: 0;
}

.md-tabs :deep(.el-tabs__header) {
  margin: 0;
}

.md-tabs :deep(.el-tabs__content) {
  padding: 0;
}

.markdown-preview {
  padding: var(--space-6);
  min-height: 300px;
  max-height: 500px;
  overflow-y: auto;
  background: var(--bg-surface);
}

.markdown-preview :deep(h1),
.markdown-preview :deep(h2),
.markdown-preview :deep(h3) {
  margin-top: var(--space-6);
  margin-bottom: var(--space-2);
  color: var(--corp-text-primary);
}

.markdown-preview :deep(p) {
  margin-bottom: var(--space-4);
  line-height: 1.6;
  color: var(--color-gray-700);
}

.markdown-preview :deep(ul),
.markdown-preview :deep(ol) {
  padding-left: var(--space-8);
  margin-bottom: var(--space-4);
  color: var(--color-gray-700);
}

.markdown-preview :deep(blockquote) {
  margin: var(--space-4) 0;
  padding: var(--space-2) var(--space-6);
  border-left: 4px solid var(--color-primary-600);
  background: var(--bg-surface-hover);
  color: var(--color-gray-700);
}

.markdown-preview :deep(code) {
  background: var(--bg-surface-active);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: 0.9em;
  color: var(--corp-text-primary);
}

.markdown-preview :deep(pre) {
  background: var(--bg-surface-active);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  overflow-x: auto;
}

/* 响应式 */
@media (max-width: 768px) {
  .form-grid { grid-template-columns: 1fr; }
  .filter-bar { flex-direction: column; align-items: flex-start; gap: 10px; }
}
</style>
