<template>
  <div class="kc-page">
    <div class="kc-header">
      <div>
        <h2>知识库管理</h2>
        <p class="subtitle">管理知识子库，上传标准规范文档，系统自动向量化用于 RAG 检索</p>
      </div>
      <el-button type="primary" @click="showCreateDialog">
        <el-icon><Plus /></el-icon> 新建子库
      </el-button>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-value">{{ categories.length }}</div>
        <div class="stat-label">知识子库</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ totalDocuments }}</div>
        <div class="stat-label">向量片段</div>
      </div>
    </div>

    <!-- 子库列表 -->
    <el-card shadow="never" class="kc-card">
      <el-table :data="categories" v-loading="loading" empty-text="暂无知识子库">
        <el-table-column prop="name" label="子库名称" min-width="180">
          <template #default="{ row }">
            <span class="cat-name">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column label="向量片段" width="100" align="center">
          <template #default="{ row }">
            <el-tag type="info" size="small">{{ row._count?.vectorDocuments || 0 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'" size="small">
              {{ row.status === 'ACTIVE' ? '启用' : '归档' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="showUploadDialog(row)">上传文档</el-button>
            <el-button type="primary" link size="small" @click="showEditDialog(row)">编辑</el-button>
            <el-button type="primary" link size="small" @click="viewDocuments(row)">查看文档</el-button>
            <el-popconfirm title="确认删除此子库及所有向量数据？" @confirm="handleDelete(row.id)">
              <template #reference>
                <el-button type="danger" link size="small">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 文档列表 -->
    <el-card v-if="selectedCategory" shadow="never" class="kc-card" style="margin-top: 16px;">
      <template #header>
        <div class="doc-header">
          <span>{{ selectedCategory.name }} — 向量文档</span>
          <el-button type="primary" link @click="selectedCategory = null">关闭</el-button>
        </div>
      </template>
      <el-table :data="documents" v-loading="docLoading" empty-text="暂无文档">
        <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
        <el-table-column prop="clauseId" label="条文号" width="100" />
        <el-table-column prop="content" label="内容预览" min-width="300" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.content?.slice(0, 100) }}...
          </template>
        </el-table-column>
        <el-table-column prop="chunkIndex" label="分块" width="60" align="center" />
      </el-table>
      <el-pagination
        v-if="docTotal > 10"
        style="margin-top: 12px; justify-content: flex-end;"
        :current-page="docPage"
        :page-size="10"
        :total="docTotal"
        layout="total, prev, pager, next"
        @current-change="handleDocPageChange"
      />
    </el-card>

    <!-- 新建/编辑对话框 -->
    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑子库' : '新建子库'" width="480px">
      <el-form :model="formData" label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="formData.name" placeholder="如：核电标准、法律法规" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="formData.description" type="textarea" :rows="3" placeholder="子库用途说明" />
        </el-form-item>
        <el-form-item label="文档类型">
          <el-input v-model="formData.documentTypes" placeholder="standard,law,reference（逗号分隔）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>

    <!-- 上传对话框 -->
    <el-dialog v-model="uploadDialogVisible" :title="`上传文档到 ${uploadTarget?.name}`" width="480px">
      <el-upload
        drag
        :auto-upload="false"
        :limit="1"
        accept=".docx,.doc,.pdf,.xlsx,.xls,.txt,.md"
        :on-change="handleFileChange"
      >
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
        <div class="el-upload__text">拖拽文件到此处，或 <em>点击选择</em></div>
        <template #tip>
          <div class="el-upload__tip">支持 docx/pdf/xlsx/txt/md 格式</div>
        </template>
      </el-upload>
      <template #footer>
        <el-button @click="uploadDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleUpload" :loading="uploading">上传并向量化</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Plus, UploadFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  getKnowledgeCategoriesApi,
  createKnowledgeCategoryApi,
  updateKnowledgeCategoryApi,
  deleteKnowledgeCategoryApi,
  uploadKnowledgeDocumentApi,
  getVectorDocumentsApi,
  getVectorStatsApi,
} from '@/api/knowledge-category'

const loading = ref(false)
const categories = ref<any[]>([])
const totalDocuments = ref(0)
const selectedCategory = ref<any>(null)
const documents = ref<any[]>([])
const docLoading = ref(false)
const docPage = ref(1)
const docTotal = ref(0)

const dialogVisible = ref(false)
const isEdit = ref(false)
const editId = ref('')
const formData = ref({ name: '', description: '', documentTypes: '' })
const submitting = ref(false)

const uploadDialogVisible = ref(false)
const uploadTarget = ref<any>(null)
const uploadFile = ref<File | null>(null)
const uploading = ref(false)

const fetchCategories = async () => {
  loading.value = true
  try {
    const { data } = await getKnowledgeCategoriesApi()
    categories.value = data || []
    const stats = await getVectorStatsApi()
    totalDocuments.value = stats.data?.totalCount || 0
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

const showCreateDialog = () => {
  isEdit.value = false
  formData.value = { name: '', description: '', documentTypes: '' }
  dialogVisible.value = true
}

const showEditDialog = (row: any) => {
  isEdit.value = true
  editId.value = row.id
  formData.value = { name: row.name, description: row.description || '', documentTypes: row.documentTypes || '' }
  dialogVisible.value = true
}

const handleSubmit = async () => {
  if (!formData.value.name.trim()) { ElMessage.warning('请输入名称'); return }
  submitting.value = true
  try {
    if (isEdit.value) {
      await updateKnowledgeCategoryApi(editId.value, formData.value)
    } else {
      await createKnowledgeCategoryApi(formData.value)
    }
    ElMessage.success(isEdit.value ? '更新成功' : '创建成功')
    dialogVisible.value = false
    fetchCategories()
  } catch (e) {
    ElMessage.error('操作失败')
  } finally {
    submitting.value = false
  }
}

const handleDelete = async (id: string) => {
  try {
    await deleteKnowledgeCategoryApi(id)
    ElMessage.success('删除成功')
    fetchCategories()
  } catch (e) {
    ElMessage.error('删除失败')
  }
}

const showUploadDialog = (row: any) => {
  uploadTarget.value = row
  uploadFile.value = null
  uploadDialogVisible.value = true
}

const handleFileChange = (file: any) => {
  uploadFile.value = file.raw
}

const handleUpload = async () => {
  if (!uploadFile.value) { ElMessage.warning('请选择文件'); return }
  uploading.value = true
  try {
    const fd = new FormData()
    fd.append('file', uploadFile.value)
    const { data } = await uploadKnowledgeDocumentApi(uploadTarget.value.id, fd)
    ElMessage.success(`上传成功，已生成 ${data?.chunks || 0} 个向量片段`)
    uploadDialogVisible.value = false
    fetchCategories()
  } catch (e) {
    ElMessage.error('上传失败')
  } finally {
    uploading.value = false
  }
}

const viewDocuments = async (row: any) => {
  selectedCategory.value = row
  docPage.value = 1
  await fetchDocuments()
}

const fetchDocuments = async () => {
  if (!selectedCategory.value) return
  docLoading.value = true
  try {
    const { data } = await getVectorDocumentsApi({
      page: docPage.value,
      pageSize: 10,
      categoryId: selectedCategory.value.id,
    })
    documents.value = data?.items || []
    docTotal.value = data?.total || 0
  } catch (e) {
    console.error(e)
  } finally {
    docLoading.value = false
  }
}

const handleDocPageChange = (page: number) => {
  docPage.value = page
  fetchDocuments()
}

onMounted(() => { fetchCategories() })
</script>

<style scoped>
.kc-page { padding: 0; }
.kc-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
.kc-header h2 { font-size: 18px; font-weight: 600; margin: 0 0 4px; color: var(--corp-text-primary); }
.subtitle { font-size: 13px; color: var(--corp-text-secondary); margin: 0; }
.stats-row { display: flex; gap: 16px; margin-bottom: 20px; }
.stat-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; min-width: 120px; }
.stat-value { font-size: 24px; font-weight: 700; color: var(--corp-primary); }
.stat-label { font-size: 13px; color: #64748b; margin-top: 4px; }
.kc-card { border-radius: 8px; }
.cat-name { font-weight: 500; color: var(--corp-text-primary); }
.doc-header { display: flex; justify-content: space-between; align-items: center; }
</style>
