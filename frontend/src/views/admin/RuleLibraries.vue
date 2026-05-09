<template>
  <div class="rl-page">
    <div class="rl-header">
      <div>
        <h2>规则库管理</h2>
        <p class="subtitle">上传规范文档，AI 自动解析为结构化审查规则</p>
      </div>
      <el-button type="primary" @click="showCreateDialog">
        <el-icon><Plus /></el-icon> 新建规则库
      </el-button>
    </div>

    <el-card shadow="never" class="rl-card">
      <el-table :data="libraries" v-loading="loading" empty-text="暂无规则库">
        <el-table-column prop="name" label="规则库名称" min-width="180">
          <template #default="{ row }">
            <span class="lib-name">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column prop="sourceFileName" label="源文件" width="150" show-overflow-tooltip />
        <el-table-column label="规则数" width="80" align="center">
          <template #default="{ row }">
            <el-tag type="info" size="small">{{ row._count?.items || 0 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 'PUBLISHED' ? 'success' : row.status === 'ARCHIVED' ? 'info' : 'warning'" size="small">
              {{ { DRAFT: '草稿', PUBLISHED: '已发布', ARCHIVED: '归档' }[row.status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="showDetail(row)">查看规则</el-button>
            <el-button type="primary" link size="small" @click="showUploadRules(row)">AI 解析</el-button>
            <el-button type="primary" link size="small" @click="showEditDialog(row)">编辑</el-button>
            <el-popconfirm title="确认删除此规则库？" @confirm="handleDelete(row.id)">
              <template #reference>
                <el-button type="danger" link size="small">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 规则详情 -->
    <el-card v-if="selectedLibrary" shadow="never" class="rl-card" style="margin-top: 16px;">
      <template #header>
        <div class="detail-header">
          <span>{{ selectedLibrary.name }} — 规则列表（{{ selectedLibrary.items?.length || 0 }}）</span>
          <div>
            <el-button type="primary" size="small" @click="showAddItemDialog">手动添加</el-button>
            <el-button type="primary" link @click="selectedLibrary = null">关闭</el-button>
          </div>
        </div>
      </template>
      <el-table :data="selectedLibrary.items || []" empty-text="暂无规则，点击「AI 解析」上传文件自动生成">
        <el-table-column prop="ruleCode" label="规则代码" width="120" />
        <el-table-column prop="ruleName" label="规则名称" min-width="180" />
        <el-table-column prop="category" label="分类" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.category" size="small">{{ row.category }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="severity" label="严重度" width="80">
          <template #default="{ row }">
            <el-tag :type="row.severity === 'error' ? 'danger' : row.severity === 'warning' ? 'warning' : 'info'" size="small">
              {{ row.severity }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="250" show-overflow-tooltip />
        <el-table-column prop="enabled" label="启用" width="60" align="center">
          <template #default="{ row }">
            <el-switch v-model="row.enabled" size="small" @change="toggleItem(row)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80">
          <template #default="{ row }">
            <el-popconfirm title="确认删除？" @confirm="handleDeleteItem(row.id)">
              <template #reference>
                <el-button type="danger" link size="small">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新建/编辑对话框 -->
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

    <!-- AI 解析上传对话框 -->
    <el-dialog v-model="parseDialogVisible" :title="`AI 解析规则 — ${parseTarget?.name}`" width="480px">
      <p style="font-size: 13px; color: #64748b; margin-bottom: 12px;">
        上传规范文档，AI 将自动提取结构化审查规则
      </p>
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
      <template #footer>
        <el-button @click="parseDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleParse" :loading="parsing">
          开始 AI 解析
        </el-button>
      </template>
    </el-dialog>

    <!-- 手动添加规则对话框 -->
    <el-dialog v-model="addItemDialogVisible" title="手动添加规则" width="520px">
      <el-form :model="itemForm" label-width="80px">
        <el-form-item label="规则代码">
          <el-input v-model="itemForm.ruleCode" placeholder="如 NAMING_001" />
        </el-form-item>
        <el-form-item label="规则名称" required>
          <el-input v-model="itemForm.ruleName" />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="itemForm.category" placeholder="NAMING/FORMAT/ATTRIBUTE 等" />
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
        <el-button @click="addItemDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleAddItem" :loading="submitting">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Plus, UploadFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  getRuleLibrariesApi,
  getRuleLibraryApi,
  createRuleLibraryApi,
  updateRuleLibraryApi,
  deleteRuleLibraryApi,
  parseRulesFromFileApi,
  addRuleItemApi,
  updateRuleItemApi,
  deleteRuleItemApi,
} from '@/api/rule-library'

const loading = ref(false)
const libraries = ref<any[]>([])
const selectedLibrary = ref<any>(null)

const dialogVisible = ref(false)
const isEdit = ref(false)
const editId = ref('')
const formData = ref({ name: '', description: '' })
const submitting = ref(false)

const parseDialogVisible = ref(false)
const parseTarget = ref<any>(null)
const parseFile = ref<File | null>(null)
const parsing = ref(false)

const addItemDialogVisible = ref(false)
const itemForm = ref({ ruleCode: '', ruleName: '', category: '', description: '', checkMethod: '', severity: 'warning' })

const fetchLibraries = async () => {
  loading.value = true
  try {
    const { data } = await getRuleLibrariesApi()
    libraries.value = data || []
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

const showCreateDialog = () => {
  isEdit.value = false
  formData.value = { name: '', description: '' }
  dialogVisible.value = true
}

const showEditDialog = (row: any) => {
  isEdit.value = true
  editId.value = row.id
  formData.value = { name: row.name, description: row.description || '' }
  dialogVisible.value = true
}

const handleSubmit = async () => {
  if (!formData.value.name.trim()) { ElMessage.warning('请输入名称'); return }
  submitting.value = true
  try {
    if (isEdit.value) {
      await updateRuleLibraryApi(editId.value, formData.value)
    } else {
      await createRuleLibraryApi(formData.value)
    }
    ElMessage.success(isEdit.value ? '更新成功' : '创建成功')
    dialogVisible.value = false
    fetchLibraries()
  } catch (e) {
    ElMessage.error('操作失败')
  } finally {
    submitting.value = false
  }
}

const handleDelete = async (id: string) => {
  try {
    await deleteRuleLibraryApi(id)
    ElMessage.success('删除成功')
    if (selectedLibrary.value?.id === id) selectedLibrary.value = null
    fetchLibraries()
  } catch (e) {
    ElMessage.error('删除失败')
  }
}

const showDetail = async (row: any) => {
  try {
    const { data } = await getRuleLibraryApi(row.id)
    selectedLibrary.value = data
  } catch (e) {
    ElMessage.error('获取详情失败')
  }
}

const showUploadRules = (row: any) => {
  parseTarget.value = row
  parseFile.value = null
  parseDialogVisible.value = true
}

const handleParseFileChange = (file: any) => {
  parseFile.value = file.raw
}

const handleParse = async () => {
  if (!parseFile.value) { ElMessage.warning('请选择文件'); return }
  parsing.value = true
  try {
    const fd = new FormData()
    fd.append('file', parseFile.value)
    const { data } = await parseRulesFromFileApi(parseTarget.value.id, fd)
    ElMessage.success(`AI 解析完成，共提取 ${data?.count || 0} 条规则`)
    parseDialogVisible.value = false
    fetchLibraries()
    if (selectedLibrary.value?.id === parseTarget.value.id) {
      showDetail(parseTarget.value)
    }
  } catch (e) {
    ElMessage.error('AI 解析失败')
  } finally {
    parsing.value = false
  }
}

const showAddItemDialog = () => {
  itemForm.value = { ruleCode: '', ruleName: '', category: '', description: '', checkMethod: '', severity: 'warning' }
  addItemDialogVisible.value = true
}

const handleAddItem = async () => {
  if (!itemForm.value.ruleName.trim()) { ElMessage.warning('请输入规则名称'); return }
  submitting.value = true
  try {
    await addRuleItemApi(selectedLibrary.value.id, itemForm.value)
    ElMessage.success('添加成功')
    addItemDialogVisible.value = false
    showDetail(selectedLibrary.value)
  } catch (e) {
    ElMessage.error('添加失败')
  } finally {
    submitting.value = false
  }
}

const toggleItem = async (row: any) => {
  try {
    await updateRuleItemApi(selectedLibrary.value.id, row.id, { enabled: row.enabled })
  } catch (e) {
    row.enabled = !row.enabled
    ElMessage.error('更新失败')
  }
}

const handleDeleteItem = async (itemId: string) => {
  try {
    await deleteRuleItemApi(selectedLibrary.value.id, itemId)
    ElMessage.success('删除成功')
    showDetail(selectedLibrary.value)
  } catch (e) {
    ElMessage.error('删除失败')
  }
}

onMounted(() => { fetchLibraries() })
</script>

<style scoped>
.rl-page { padding: 0; }
.rl-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
.rl-header h2 { font-size: 18px; font-weight: 600; margin: 0 0 4px; color: var(--corp-text-primary); }
.subtitle { font-size: 13px; color: var(--corp-text-secondary); margin: 0; }
.rl-card { border-radius: 8px; }
.lib-name { font-weight: 500; color: var(--corp-text-primary); }
.detail-header { display: flex; justify-content: space-between; align-items: center; }
</style>
