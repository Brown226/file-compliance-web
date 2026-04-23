<template>
  <div class="review-rules-container">
    <el-card shadow="never">
      <!-- 紧凑的顶栏：标题 + 操作按钮 -->
      <div class="panel-header">
        <div class="header-left">
          <span class="panel-title">审查规则管理</span>
          <el-tag size="small" type="info">共 {{ totalRules }} 条</el-tag>
        </div>
        <div class="header-actions">
          <el-button size="small" @click="openCreateDialog">
            <el-icon><Plus /></el-icon> 创建规则
          </el-button>
          <el-button size="small" @click="openImportDialog">
            <el-icon><Upload /></el-icon> 导入
          </el-button>
          <el-button size="small" @click="openTestDialog">
            <el-icon><MagicStick /></el-icon> 测试匹配
          </el-button>
          <el-button size="small" type="danger" plain @click="handleBatchDelete" :disabled="selectedIds.length === 0">
            <el-icon><Delete /></el-icon> 批量删除
          </el-button>
          <el-divider direction="vertical" />
          <el-button size="small" @click="handleBatchToggle(true)" :disabled="selectedIds.length === 0">
            启用 ({{ selectedIds.length }})
          </el-button>
          <el-button size="small" @click="handleBatchToggle(false)" :disabled="selectedIds.length === 0">
            禁用 ({{ selectedIds.length }})
          </el-button>
          <el-button size="small" type="warning" @click="handleResetDefaults">
            重置
          </el-button>
        </div>
      </div>

      <!-- 紧凑的筛选栏 -->
      <div class="filter-bar">
        <el-checkbox
          v-model="isSelectAll"
          :indeterminate="isIndeterminate"
          @change="handleSelectAll"
          style="margin-right: 12px;"
        >
          {{ isSelectAll ? '取消全选' : '全选' }}
        </el-checkbox>
        <el-input
          v-model="searchQuery"
          placeholder="搜索规则..."
          clearable
          :prefix-icon="Search"
          style="width: 180px;"
        />
        <el-select
          v-model="filterCategory"
          placeholder="分类"
          clearable
          style="width: 120px;"
        >
          <el-option v-for="cat in categories" :key="cat" :label="categoryLabel(cat)" :value="cat" />
        </el-select>
        <el-select
          v-model="filterStatus"
          placeholder="状态"
          clearable
          style="width: 100px;"
        >
          <el-option label="已启用" :value="true" />
          <el-option label="已禁用" :value="false" />
        </el-select>
        <el-select
          v-model="filterSeverity"
          placeholder="级别"
          clearable
          style="width: 100px;"
        >
          <el-option label="严重" value="error" />
          <el-option label="警告" value="warning" />
          <el-option label="提示" value="info" />
        </el-select>
        <span class="filter-result">已选 {{ selectedIds.length }} 条</span>
      </div>

      <!-- 紧凑的统计行 -->
      <div class="stats-row">
        <div class="stat-item">
          <span class="stat-dot enabled"></span>
          <span>已启用 {{ enabledCount }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-dot error"></span>
          <span>严重 {{ errorCount }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-dot warning"></span>
          <span>警告 {{ warningCount }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-dot info"></span>
          <span>提示 {{ infoCount }}</span>
        </div>
      </div>

      <!-- 规则列表 -->
      <div class="rules-list" v-loading="loading">
        <el-table
          :data="filteredRules"
          :row-class-name="tableRowClassName"
          @selection-change="handleSelectionChange"
          style="width: 100%"
          size="small"
        >
          <el-table-column type="selection" width="40" />
          <el-table-column prop="ruleCode" label="编码" width="100">
            <template #default="{ row }">
              <code class="rule-code">{{ row.ruleCode }}</code>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="规则名称" min-width="180">
            <template #default="{ row }">
              <span class="rule-name">{{ row.name }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="category" label="分类" width="90">
            <template #default="{ row }">
              <el-tag size="small" type="info">{{ categoryLabel(row.category) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="severity" label="级别" width="70">
            <template #default="{ row }">
              <el-tag size="small" :type="severityTagType(row.severity)">
                {{ severityShortLabel(row.severity) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
          <el-table-column prop="enabled" label="状态" width="70">
            <template #default="{ row }">
              <el-switch
                :model-value="row.enabled"
                size="small"
                @change="(val: boolean) => handleToggleRule(row, val)"
              />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{ row }">
              <el-button size="small" link type="primary" @click="openEditDialog(row)">编辑</el-button>
              <el-button size="small" link type="danger" @click="handleDeleteRule(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-empty v-if="!loading && filteredRules.length === 0" description="暂无规则" />
      </div>
    </el-card>

    <!-- 创建规则对话框 -->
    <el-dialog v-model="createDialogVisible" title="创建规则" width="500px">
      <el-form ref="createFormRef" :model="createFormData" :rules="createFormRules" label-width="90px">
        <el-form-item label="规则编码" prop="ruleCode">
          <el-input v-model="createFormData.ruleCode" placeholder="如: NAME_001" />
        </el-form-item>
        <el-form-item label="规则名称" prop="name">
          <el-input v-model="createFormData.name" placeholder="规则显示名称" />
        </el-form-item>
        <el-form-item label="分类" prop="category">
          <el-select v-model="createFormData.category" placeholder="选择分类" style="width: 100%">
            <el-option v-for="cat in availableCategories" :key="cat" :label="categoryLabel(cat)" :value="cat" />
          </el-select>
        </el-form-item>
        <el-form-item label="严重程度" prop="severity">
          <el-radio-group v-model="createFormData.severity">
            <el-radio value="error">严重</el-radio>
            <el-radio value="warning">警告</el-radio>
            <el-radio value="info">提示</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="createFormData.description" type="textarea" :rows="3" placeholder="规则描述" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="createFormData.enabled" />
        </el-form-item>
        <el-form-item label="配置">
          <el-input v-model="createFormData.configStr" type="textarea" :rows="2" placeholder='{"pattern": "正则表达式", "keywords": ["关键词"]}' />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="createSubmitLoading" @click="submitCreateForm">创建</el-button>
      </template>
    </el-dialog>

    <!-- 编辑规则对话框 -->
    <el-dialog v-model="editDialogVisible" title="编辑规则" width="500px">
      <el-form ref="editFormRef" :model="editFormData" :rules="editFormRules" label-width="90px">
        <el-form-item label="规则编码">
          <el-input :model-value="editFormData.ruleCode" disabled />
        </el-form-item>
        <el-form-item label="规则名称">
          <el-input :model-value="editFormData.name" disabled />
        </el-form-item>
        <el-form-item label="分类">
          <el-input :model-value="categoryLabel(editFormData.category || '')" disabled />
        </el-form-item>
        <el-form-item label="严重程度" prop="severity">
          <el-radio-group v-model="editFormData.severity">
            <el-radio value="error">严重</el-radio>
            <el-radio value="warning">警告</el-radio>
            <el-radio value="info">提示</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editFormData.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="editFormData.enabled" />
        </el-form-item>
        <el-form-item label="配置">
          <el-input v-model="editFormData.configStr" type="textarea" :rows="2" placeholder='{"pattern": "正则表达式", "keywords": ["关键词"]}' />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSubmitLoading" @click="submitEditForm">保存</el-button>
      </template>
    </el-dialog>

    <!-- 测试匹配对话框 -->
    <el-dialog v-model="testDialogVisible" title="测试匹配效果" width="600px">
      <el-form label-width="100px">
        <el-form-item label="选择规则">
          <el-select v-model="testFormData.ruleCode" placeholder="选择要测试的规则" style="width: 100%" filterable>
            <el-option v-for="rule in rules" :key="rule.ruleCode" :label="`${rule.ruleCode} - ${rule.name}`" :value="rule.ruleCode" />
          </el-select>
        </el-form-item>
        <el-form-item label="测试文本">
          <el-input v-model="testFormData.testText" type="textarea" :rows="6" placeholder="输入要测试的文本内容..." />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="testSubmitLoading" @click="submitTestMatch">开始测试</el-button>
        </el-form-item>
      </el-form>
      
      <!-- 测试结果 -->
      <el-divider v-if="testResult" />
      <div v-if="testResult" class="test-result" :class="{ matched: testResult.matched }">
        <div class="result-header">
          <el-tag :type="testResult.matched ? 'danger' : 'info'">
            {{ testResult.matched ? '匹配成功' : '未匹配' }}
          </el-tag>
          <span class="result-details">{{ testResult.matchDetails }}</span>
        </div>
        <div v-if="testResult.matchedContent" class="matched-content">
          <span class="label">匹配内容：</span>
          <code>{{ testResult.matchedContent }}</code>
        </div>
      </div>
    </el-dialog>

    <!-- 导入规则对话框 -->
    <el-dialog v-model="importDialogVisible" title="导入规则" width="600px">
      <el-alert title="导入格式说明" type="info" :closable="false" style="margin-bottom: 16px;">
        <template #default>
          支持 JSON 格式的规则数组，每条规则需包含 <code>ruleCode</code>、<code>name</code>、<code>category</code> 字段。
          已存在的规则将被更新，不存在的规则将被创建。
        </template>
      </el-alert>
      <el-input
        v-model="importText"
        type="textarea"
        :rows="10"
        placeholder='[
  {"ruleCode": "CUSTOM_001", "name": "自定义规则", "category": "NAMING", "severity": "warning", "description": "描述"},
  {"ruleCode": "CUSTOM_002", "name": "另一个规则", "category": "FORMAT", "severity": "error"}
]'
      />
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="importSubmitLoading" @click="submitImport">导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Upload, Delete, MagicStick } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import {
  getRulesApi,
  createRuleApi,
  updateRuleApi,
  deleteRuleApi,
  toggleRuleApi,
  batchToggleRulesApi,
  resetRulesApi,
  getRuleCategoriesApi,
  testMatchApi,
  importRulesApi,
} from '@/api/rule'
import type { ReviewRule } from '@/types/models'

const loading = ref(false)
const rules = ref<ReviewRule[]>([])
const categories = ref<string[]>([])
const searchQuery = ref('')
const filterCategory = ref('')
const filterStatus = ref<boolean | ''>('')
const filterSeverity = ref('')
const selectedRows = ref<ReviewRule[]>([])

// 分类标签映射
const categoryLabels: Record<string, string> = {
  NAMING: '文件命名',
  ENCODING: '编码一致性',
  ATTRIBUTE: '封面属性',
  HEADER: '页眉检查',
  PAGE: '连续页码',
  FORMAT: '格式规范',
  COMPLETENESS: '数据完整性',
  CONSISTENCY: '一致性检查',
  LAYOUT: '排版布局',
  TYPO: '正文编码校验',
}

const categoryLabel = (cat: string) => categoryLabels[cat] || cat

const severityShortLabel = (severity: string) => {
  const map: Record<string, string> = { error: '严重', warning: '警告', info: '提示' }
  return map[severity] || severity
}

const severityTagType = (severity: string): '' | 'success' | 'warning' | 'info' | 'danger' => {
  const map: Record<string, '' | 'success' | 'warning' | 'info' | 'danger'> = {
    error: 'danger', warning: 'warning', info: 'info'
  }
  return map[severity] || 'info'
}

// 统计
const totalRules = computed(() => rules.value.length)
const enabledCount = computed(() => rules.value.filter(r => r.enabled).length)
const warningCount = computed(() => rules.value.filter(r => r.severity === 'warning').length)
const errorCount = computed(() => rules.value.filter(r => r.severity === 'error').length)
const infoCount = computed(() => rules.value.filter(r => r.severity === 'info').length)

const selectedIds = computed(() => selectedRows.value.map(r => r.ruleCode))
const isSelectAll = computed(() => filteredRules.value.length > 0 && selectedIds.value.length === filteredRules.value.length)
const isIndeterminate = computed(() => selectedIds.value.length > 0 && selectedIds.value.length < filteredRules.value.length)

// 可用分类
const availableCategories = computed(() => {
  const allCats = ['NAMING', 'ENCODING', 'ATTRIBUTE', 'HEADER', 'PAGE', 'FORMAT', 'COMPLETENESS', 'CONSISTENCY', 'LAYOUT', 'TYPO']
  return allCats
})

// 筛选后的规则
const filteredRules = computed(() => {
  let result = rules.value
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.ruleCode.toLowerCase().includes(q) ||
      (r.description && r.description.toLowerCase().includes(q))
    )
  }
  if (filterCategory.value) {
    result = result.filter(r => r.category === filterCategory.value)
  }
  if (filterStatus.value !== '') {
    result = result.filter(r => r.enabled === filterStatus.value)
  }
  if (filterSeverity.value) {
    result = result.filter(r => r.severity === filterSeverity.value)
  }
  return result
})

const tableRowClassName = ({ row }: { row: ReviewRule }) => {
  return row.enabled ? '' : 'disabled-row'
}

// 加载数据
const loadData = async () => {
  loading.value = true
  try {
    const { data } = await getRulesApi()
    rules.value = data || []
  } catch (e) {
    console.error('获取规则数据失败', e)
    ElMessage.error('获取规则数据失败')
  } finally {
    loading.value = false
  }
}

const loadCategories = async () => {
  try {
    const { data } = await getRuleCategoriesApi()
    categories.value = data || []
  } catch (e) {
    console.error('获取规则分类失败', e)
  }
}

// 选择操作
const handleSelectionChange = (selection: ReviewRule[]) => {
  selectedRows.value = selection
}

const handleSelectAll = (val: boolean) => {
  if (val) {
    selectedRows.value = [...filteredRules.value]
  } else {
    selectedRows.value = []
  }
}

// 切换单条规则启用/禁用
const handleToggleRule = async (rule: ReviewRule, enabled: boolean) => {
  try {
    await toggleRuleApi(rule.ruleCode)
    ElMessage.success(enabled ? '已启用' : '已禁用')
    loadData()
  } catch (e) {
    console.error('切换规则状态失败', e)
    ElMessage.error('切换规则状态失败')
  }
}

// 批量启用/禁用
const handleBatchToggle = async (enabled: boolean) => {
  if (selectedIds.value.length === 0) {
    ElMessage.warning('请先选择规则')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认${enabled ? '启用' : '禁用'}选中的 ${selectedIds.value.length} 条规则？`,
      '批量操作',
      { type: 'warning' }
    )
    await batchToggleRulesApi(selectedIds.value, enabled)
    ElMessage.success(`已${enabled ? '启用' : '禁用'} ${selectedIds.value.length} 条规则`)
    selectedRows.value = []
    loadData()
  } catch (e: any) {
    if (e !== 'cancel') {
      console.error('批量操作失败', e)
      ElMessage.error('批量操作失败')
    }
  }
}

// 重置为默认
const handleResetDefaults = async () => {
  try {
    await ElMessageBox.confirm(
      '确认重置所有规则为默认配置？这将恢复所有规则的严重程度和启用状态。',
      '重置确认',
      { type: 'warning' }
    )
    const { data } = await resetRulesApi()
    ElMessage.success(data?.message || '已重置为默认配置')
    loadData()
  } catch (e: any) {
    if (e !== 'cancel') {
      console.error('重置失败', e)
      ElMessage.error('重置失败')
    }
  }
}

// 删除规则
const handleDeleteRule = async (rule: ReviewRule) => {
  try {
    await ElMessageBox.confirm(
      `确认删除规则 "${rule.name}"？此操作不可恢复。`,
      '删除确认',
      { type: 'warning' }
    )
    await deleteRuleApi(rule.ruleCode)
    ElMessage.success('规则已删除')
    loadData()
  } catch (e: any) {
    if (e !== 'cancel') {
      console.error('删除规则失败', e)
      ElMessage.error('删除规则失败')
    }
  }
}

// 批量删除
const handleBatchDelete = async () => {
  if (selectedIds.value.length === 0) {
    ElMessage.warning('请先选择规则')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认删除选中的 ${selectedIds.value.length} 条规则？此操作不可恢复。`,
      '批量删除确认',
      { type: 'warning' }
    )
    for (const code of selectedIds.value) {
      await deleteRuleApi(code)
    }
    ElMessage.success(`已删除 ${selectedIds.value.length} 条规则`)
    selectedRows.value = []
    loadData()
  } catch (e: any) {
    if (e !== 'cancel') {
      console.error('批量删除失败', e)
      ElMessage.error('批量删除失败')
    }
  }
}

// ========== 创建规则 ==========
const createDialogVisible = ref(false)
const createSubmitLoading = ref(false)
const createFormRef = ref<FormInstance>()
const createFormData = reactive({
  ruleCode: '',
  name: '',
  category: '',
  description: '',
  severity: 'warning' as string,
  enabled: true,
  configStr: '',
})
const createFormRules = reactive<FormRules>({
  ruleCode: [
    { required: true, message: '请输入规则编码', trigger: 'blur' },
    { min: 3, max: 50, message: '规则编码长度在 3 到 50 个字符', trigger: 'blur' }
  ],
  name: [{ required: true, message: '请输入规则名称', trigger: 'blur' }],
  category: [{ required: true, message: '请选择分类', trigger: 'change' }],
  severity: [{ required: true, message: '请选择严重程度', trigger: 'change' }],
})

const openCreateDialog = () => {
  Object.assign(createFormData, {
    ruleCode: '',
    name: '',
    category: '',
    description: '',
    severity: 'warning',
    enabled: true,
    configStr: '',
  })
  createDialogVisible.value = true
}

const submitCreateForm = async () => {
  if (!createFormRef.value) return
  await createFormRef.value.validate(async (valid) => {
    if (!valid) return
    createSubmitLoading.value = true
    try {
      let config = null
      if (createFormData.configStr.trim()) {
        try {
          config = JSON.parse(createFormData.configStr)
        } catch {
          ElMessage.error('配置 JSON 格式不正确')
          createSubmitLoading.value = false
          return
        }
      }
      await createRuleApi({
        ruleCode: createFormData.ruleCode,
        name: createFormData.name,
        category: createFormData.category,
        description: createFormData.description,
        severity: createFormData.severity as 'error' | 'warning' | 'info',
        enabled: createFormData.enabled,
        config,
      })
      ElMessage.success('规则创建成功')
      createDialogVisible.value = false
      loadData()
      loadCategories()
    } catch (e) {
      console.error('创建规则失败', e)
      ElMessage.error('创建规则失败')
    } finally {
      createSubmitLoading.value = false
    }
  })
}

// ========== 编辑规则 ==========
const editDialogVisible = ref(false)
const editSubmitLoading = ref(false)
const editFormRef = ref<FormInstance>()
const editFormData = reactive({
  ruleCode: '',
  name: '',
  category: '',
  description: '',
  severity: 'warning' as string,
  enabled: true,
  configStr: '',
})
const editFormRules = reactive<FormRules>({
  severity: [{ required: true, message: '请选择严重程度', trigger: 'change' }],
})

const openEditDialog = (rule: ReviewRule) => {
  let configStr = ''
  if (rule.config) {
    try {
      configStr = typeof rule.config === 'string' ? rule.config : JSON.stringify(rule.config, null, 2)
    } catch {
      configStr = String(rule.config)
    }
  }
  Object.assign(editFormData, {
    ruleCode: rule.ruleCode,
    name: rule.name,
    category: rule.category,
    description: rule.description || '',
    severity: rule.severity,
    enabled: rule.enabled,
    configStr,
  })
  editDialogVisible.value = true
}

const submitEditForm = async () => {
  if (!editFormRef.value) return
  await editFormRef.value.validate(async (valid) => {
    if (!valid) return
    editSubmitLoading.value = true
    try {
      let config
      if (editFormData.configStr.trim()) {
        try {
          config = JSON.parse(editFormData.configStr)
        } catch {
          ElMessage.error('配置 JSON 格式不正确')
          editSubmitLoading.value = false
          return
        }
      }
      await updateRuleApi(editFormData.ruleCode, {
        description: editFormData.description || undefined,
        severity: editFormData.severity,
        enabled: editFormData.enabled,
        config,
      })
      ElMessage.success('规则更新成功')
      editDialogVisible.value = false
      loadData()
    } catch (e) {
      console.error('更新规则失败', e)
      ElMessage.error('更新规则失败')
    } finally {
      editSubmitLoading.value = false
    }
  })
}

// ========== 测试匹配 ==========
const testDialogVisible = ref(false)
const testSubmitLoading = ref(false)
const testFormData = reactive({
  ruleCode: '',
  testText: '',
})
const testResult = ref<{
  ruleCode: string
  ruleName: string
  matched: boolean
  matchedContent: string
  matchDetails: string
  testTextLength: number
} | null>(null)

const openTestDialog = () => {
  testFormData.ruleCode = ''
  testFormData.testText = ''
  testResult.value = null
  testDialogVisible.value = true
}

const submitTestMatch = async () => {
  if (!testFormData.ruleCode) {
    ElMessage.warning('请选择要测试的规则')
    return
  }
  if (!testFormData.testText.trim()) {
    ElMessage.warning('请输入测试文本')
    return
  }
  testSubmitLoading.value = true
  try {
    const { data } = await testMatchApi(testFormData.ruleCode, testFormData.testText)
    testResult.value = data
  } catch (e) {
    console.error('测试匹配失败', e)
    ElMessage.error('测试匹配失败')
  } finally {
    testSubmitLoading.value = false
  }
}

// ========== 导入规则 ==========
const importDialogVisible = ref(false)
const importSubmitLoading = ref(false)
const importText = ref('')

const openImportDialog = () => {
  importText.value = ''
  importDialogVisible.value = true
}

const submitImport = async () => {
  if (!importText.value.trim()) {
    ElMessage.warning('请输入要导入的规则')
    return
  }
  let parsedRules
  try {
    parsedRules = JSON.parse(importText.value)
    if (!Array.isArray(parsedRules)) {
      ElMessage.error('导入数据必须是规则数组')
      return
    }
  } catch {
    ElMessage.error('JSON 格式不正确')
    return
  }
  importSubmitLoading.value = true
  try {
    const { data } = await importRulesApi(parsedRules)
    ElMessage.success(`导入完成：成功 ${data.importedCount} 条，跳过 ${data.skippedCount} 条`)
    if (data.errors && data.errors.length > 0) {
      ElMessage.warning(`部分导入失败: ${data.errors[0]}`)
    }
    importDialogVisible.value = false
    loadData()
    loadCategories()
  } catch (e) {
    console.error('导入规则失败', e)
    ElMessage.error('导入规则失败')
  } finally {
    importSubmitLoading.value = false
  }
}

onMounted(() => {
  loadData()
  loadCategories()
})
</script>

<style scoped>
.review-rules-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.panel-title {
  font-weight: 600;
  font-size: 15px;
  color: var(--corp-text-primary);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 4px;
}

.filter-result {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.stats-row {
  display: flex;
  gap: 20px;
  margin-bottom: 10px;
  padding: 6px 12px;
  background: linear-gradient(90deg, rgba(64, 158, 255, 0.06) 0%, rgba(103, 194, 58, 0.06) 100%);
  border-radius: 4px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--corp-text-secondary);
}

.stat-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.stat-dot.enabled { background: #67c23a; }
.stat-dot.error { background: #f56c6c; }
.stat-dot.warning { background: #e6a23c; }
.stat-dot.info { background: #909399; }

.rules-list {
  min-height: 200px;
}

.rule-code {
  font-size: 11px;
  font-weight: 600;
  color: #606266;
  font-family: 'Courier New', Consolas, monospace;
}

.rule-name {
  font-weight: 500;
}

:deep(.disabled-row) {
  opacity: 0.5;
}

:deep(.el-table .cell) {
  padding: 4px 8px;
}

/* 测试结果 */
.test-result {
  padding: 12px;
  border-radius: 4px;
  background: #f5f7fa;
}

.test-result.matched {
  background: #fef0f0;
}

.result-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.result-details {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.matched-content {
  font-size: 13px;
}

.matched-content .label {
  color: var(--el-text-color-secondary);
}

.matched-content code {
  background: #fff;
  padding: 4px 8px;
  border-radius: 4px;
  font-family: 'Courier New', Consolas, monospace;
  color: #f56c6c;
}
</style>
