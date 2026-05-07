<template>
  <div class="announcement-management">
    <!-- 顶部工具栏 -->
    <div class="announcement-toolbar">
      <el-button type="primary" @click="handleCreate">
        <el-icon><Plus /></el-icon> 新建公告
      </el-button>
      <div class="toolbar-info">
        <el-icon><InfoFilled /></el-icon>
        公告发布后将在用户登录时自动弹窗展示
      </div>
    </div>

    <!-- 状态筛选 Tabs -->
    <el-tabs v-model="statusFilter" @tab-click="loadAnnouncements">
      <el-tab-pane label="全部" name="ALL" />
      <el-tab-pane label="草稿" name="DRAFT" />
      <el-tab-pane label="已发布" name="PUBLISHED" />
      <el-tab-pane label="已撤回" name="WITHDRAWN" />
    </el-tabs>

    <!-- 公告列表 -->
    <el-table
      v-loading="loading"
      :data="announcements"
      style="width: 100%"
      row-key="id"
    >
      <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />

      <el-table-column label="紧急程度" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="urgencyTagType(row.urgency)" effect="light" size="small">
            {{ urgencyLabel(row.urgency) }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="状态" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="statusTagType(row.status)" effect="light" size="small">
            {{ statusLabel(row.status) }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="发布时间" width="160" align="center">
        <template #default="{ row }">
          {{ row.publishAt ? formatDate(row.publishAt) : '-' }}
        </template>
      </el-table-column>

      <el-table-column label="创建人" width="120" align="center">
        <template #default="{ row }">
          {{ row.creator?.name || row.creator?.username || '-' }}
        </template>
      </el-table-column>

      <el-table-column label="操作" width="220" align="center" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="row.status === 'DRAFT'"
            size="small"
            type="primary"
            link
            @click="handleEdit(row)"
          >
            编辑
          </el-button>
          <el-button
            v-if="row.status === 'DRAFT'"
            size="small"
            type="success"
            link
            @click="handlePublish(row)"
          >
            发布
          </el-button>
          <el-button
            v-if="row.status === 'PUBLISHED'"
            size="small"
            link
            @click="handleView(row)"
          >
            查看
          </el-button>
          <el-button
            v-if="row.status === 'PUBLISHED'"
            size="small"
            type="warning"
            link
            @click="handleWithdraw(row)"
          >
            撤回
          </el-button>
          <el-button
            v-if="row.status === 'DRAFT' || row.status === 'WITHDRAWN'"
            size="small"
            type="danger"
            link
            @click="handleDelete(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

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

    <!-- 创建/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogType === 'create' ? '新建公告' : (dialogType === 'edit' ? '编辑公告' : '查看公告')"
      width="800px"
      destroy-on-close
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="80px"
        :disabled="dialogType === 'view'"
      >
        <el-form-item label="标题" prop="title">
          <el-input v-model="form.title" placeholder="请输入公告标题" maxlength="200" show-word-limit />
        </el-form-item>

        <el-form-item label="紧急程度" prop="urgency">
          <el-select v-model="form.urgency" placeholder="请选择紧急程度" style="width: 200px">
            <el-option label="普通" value="NORMAL" />
            <el-option label="重要" value="IMPORTANT" />
            <el-option label="紧急" value="URGENT" />
          </el-select>
        </el-form-item>

        <el-form-item label="内容" prop="content">
          <div class="markdown-editor-wrap">
            <!-- Markdown 工具栏 -->
            <div class="md-toolbar" v-if="dialogType !== 'view'">
              <el-button size="small" text @click="insertMd('**', '**')" title="粗体"><strong>B</strong></el-button>
              <el-button size="small" text @click="insertMd('*', '*')" title="斜体"><em>I</em></el-button>
              <el-button size="small" text @click="insertMd('## ', '')" title="标题">H2</el-button>
              <el-divider direction="vertical" />
              <el-button size="small" text @click="insertMd('- ', '')" title="列表">列表</el-button>
              <el-button size="small" text @click="insertMd('[', '](url)')" title="链接">链接</el-button>
              <el-button size="small" text @click="insertMd('`', '`')" title="代码">代码</el-button>
              <el-divider direction="vertical" />
              <el-button size="small" text @click="activeTab = 'preview'" :type="activeTab === 'preview' ? 'primary' : ''">
                预览
              </el-button>
            </div>

            <!-- 编辑/预览 Tab -->
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
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button
          v-if="dialogType !== 'view'"
          type="info"
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

/**
 * 加载公告列表
 */
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

/**
 * 新建公告
 */
function handleCreate() {
  dialogType.value = 'create'
  resetForm()
  dialogVisible.value = true
  activeTab.value = 'edit'
}

/**
 * 编辑公告
 */
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

/**
 * 查看公告
 */
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

/**
 * 发布公告
 */
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

/**
 * 撤回公告
 */
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

/**
 * 删除公告
 */
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

/**
 * 保存草稿
 */
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

/**
 * 保存并直接发布
 */
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

    // 发布
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

/**
 * 插入 Markdown 语法
 */
function insertMd(before: string, after: string) {
  const textarea = document.querySelector('.md-tabs .el-textarea__inner') as HTMLTextAreaElement
  if (!textarea) return

  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const text = form.content
  const selectedText = text.substring(start, end) || '文本'

  form.content = text.substring(0, start) + before + selectedText + after + text.substring(end)

  // 设置光标位置
  setTimeout(() => {
    textarea.focus()
    textarea.setSelectionRange(start + before.length, start + before.length + selectedText.length)
  }, 0)
}

/**
 * 重置表单
 */
function resetForm() {
  form.id = ''
  form.title = ''
  form.content = ''
  form.urgency = 'NORMAL'
  if (formRef.value) {
    formRef.value.resetFields()
  }
}

/**
 * 紧急程度对应的 Tag 类型
 */
function urgencyTagType(urgency: string): 'success' | 'warning' | 'danger' | 'info' {
  switch (urgency) {
    case 'URGENT': return 'danger'
    case 'IMPORTANT': return 'warning'
    default: return 'info'
  }
}

/**
 * 紧急程度对应的中文标签
 */
function urgencyLabel(urgency: string): string {
  switch (urgency) {
    case 'URGENT': return '紧急'
    case 'IMPORTANT': return '重要'
    default: return '普通'
  }
}

/**
 * 状态对应的 Tag 类型
 */
function statusTagType(status: string): 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'PUBLISHED': return 'success'
    case 'DRAFT': return 'info'
    case 'WITHDRAWN': return 'warning'
    default: return 'info'
  }
}

/**
 * 状态对应的中文标签
 */
function statusLabel(status: string): string {
  switch (status) {
    case 'PUBLISHED': return '已发布'
    case 'DRAFT': return '草稿'
    case 'WITHDRAWN': return '已撤回'
    default: return '未知'
  }
}

/**
 * 格式化日期
 */
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
  padding: 20px;
}

.announcement-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.toolbar-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #909399;
}

.pagination-wrap {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}

/* Markdown 编辑器 */
.markdown-editor-wrap {
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  overflow: hidden;
}

.md-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  background: #f5f7fa;
  border-bottom: 1px solid #dcdfe6;
}

.md-toolbar .el-divider--vertical {
  height: 20px;
  margin: 0 4px;
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
  padding: 16px;
  min-height: 300px;
  max-height: 500px;
  overflow-y: auto;
  background: #fff;
}

.markdown-preview :deep(h1),
.markdown-preview :deep(h2),
.markdown-preview :deep(h3) {
  margin-top: 16px;
  margin-bottom: 8px;
}

.markdown-preview :deep(p) {
  margin-bottom: 12px;
  line-height: 1.6;
}

.markdown-preview :deep(ul),
.markdown-preview :deep(ol) {
  padding-left: 24px;
  margin-bottom: 12px;
}

.markdown-preview :deep(blockquote) {
  margin: 12px 0;
  padding: 8px 16px;
  border-left: 4px solid #409eff;
  background: #f5f7fa;
  color: #606266;
}

.markdown-preview :deep(code) {
  background: #f5f7fa;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
}

.markdown-preview :deep(pre) {
  background: #f5f7fa;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
}
</style>
