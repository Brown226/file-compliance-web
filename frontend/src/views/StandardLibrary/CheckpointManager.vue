<template>
  <div class="checkpoint-manager">
    <!-- 顶部：标准信息 + 返回 -->
    <div class="page-header">
      <div class="header-left">
        <el-button text @click="goBack">
          <el-icon><ArrowLeft /></el-icon>&nbsp;返回标准库
        </el-button>
        <div class="title-bar">
          <span class="title-bar-tag">DEC 审点管理</span>
          <span class="standard-title">{{ standard?.standardName || standard?.title || '标准加载中…' }}</span>
          <el-tag v-if="standard?.standardNo" size="small" type="info" effect="plain">
            {{ standard.standardNo }}
          </el-tag>
        </div>
        <div class="title-desc">将规范条文切分为机器可执行的标准化审点（mandatory/guidance × compliance/fact/text），用于 DEC 双分支审查。</div>
      </div>
      <div class="header-right">
        <el-button
          v-if="canManage"
          type="primary"
          :loading="generating"
          @click="handleGenerate"
        >
          <el-icon><MagicStick /></el-icon>&nbsp;{{ hasCheckpoints ? '重新加工（增量幂等）' : '生成审点' }}
        </el-button>
        <el-button :loading="loading" @click="loadData">
          <el-icon><Refresh /></el-icon>&nbsp;刷新
        </el-button>
      </div>
    </div>

    <!-- 统计看板 -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">{{ stats.total }}</div>
        <div class="stat-label">审点总数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ stats.mandatory }}</div>
        <div class="stat-label">强制条目</div>
        <div class="stat-sub">{{ stats.guidance }} 条引导性</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ stats.compliance }}</div>
        <div class="stat-label">合规维度</div>
        <div class="stat-sub">事实 {{ stats.fact }} · 文本 {{ stats.text }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ stats.total === 0 ? '—' : '已就绪' }}</div>
        <div class="stat-label">加工状态</div>
        <div class="stat-sub">{{ hasCheckpoints ? '可用于 DEC_REVIEW' : '尚未加工' }}</div>
      </div>
    </div>

    <!-- 审点列表 -->
    <el-card shadow="never" class="list-card">
      <template #header>
        <div class="card-header">
          <span class="header-title">
            <el-icon><Tickets /></el-icon>&nbsp;审点清单
            <span class="total-badge">共 {{ checkpoints.length }} 条</span>
          </span>
          <div class="header-actions">
            <el-input
              v-model="searchKeyword"
              placeholder="搜索条文编号或内容"
              clearable
              size="small"
              style="width: 220px;"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
            <el-select v-model="filterMandatory" placeholder="强制性" clearable size="small" style="width: 120px;">
              <el-option label="全部" value="" />
              <el-option label="强制" value="mandatory" />
              <el-option label="引导" value="guidance" />
            </el-select>
            <el-select v-model="filterDimension" placeholder="审查维度" clearable size="small" style="width: 120px;">
              <el-option label="全部" value="" />
              <el-option label="合规" value="compliance" />
              <el-option label="事实" value="fact" />
              <el-option label="文本" value="text" />
            </el-select>
          </div>
        </div>
      </template>

      <el-table
        v-loading="loading"
        :data="filteredCheckpoints"
        border
        size="small"
        max-height="calc(100vh - 380px)"
        style="width: 100%;"
        row-key="id"
        empty-text="暂无审点数据，请先点击右上角「生成审点」"
      >
        <el-table-column prop="clauseCode" label="条文编号" width="110">
          <template #default="{ row }">
            <span class="clause-code">{{ row.clauseCode || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="mandatory" label="强制性" width="90">
          <template #default="{ row }">
            <el-tag
              size="small"
              :type="row.mandatory === 'mandatory' ? 'danger' : 'info'"
              effect="plain"
            >
              {{ row.mandatory === 'mandatory' ? '强制' : '引导' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="auditDimension" label="维度" width="80">
          <template #default="{ row }">
            <span class="dimension-badge" :class="`dim-${row.auditDimension}`">
              {{ dimensionLabel(row.auditDimension) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="clauseText" label="条文文本" min-width="280" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="clause-text">{{ row.clauseText }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="checkPrompt" label="判定 Prompt" min-width="240" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.checkPrompt" class="prompt-text">{{ row.checkPrompt }}</span>
            <span v-else class="empty-prompt">未生成</span>
          </template>
        </el-table-column>
        <el-table-column prop="source" label="来源" width="90">
          <template #default="{ row }">
            <el-tag size="small" type="info" effect="plain">
              {{ row.source === 'manual' ? '人工' : '切分' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="canManage" label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="handleEdit(row)">
              <el-icon><Edit /></el-icon>&nbsp;编辑
            </el-button>
            <el-button type="danger" link size="small" @click="handleDelete(row)">
              <el-icon><Delete /></el-icon>&nbsp;删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 编辑对话框 -->
    <el-dialog v-model="editDialogVisible" title="编辑审点" width="640px" @close="resetEditForm">
      <el-form ref="editFormRef" :model="editForm" label-width="100px">
        <el-form-item label="条文编号">
          <el-input v-model="editForm.clauseCode" placeholder="如 5.2.3（可留空）" />
        </el-form-item>
        <el-form-item label="强制性">
          <el-radio-group v-model="editForm.mandatory">
            <el-radio value="mandatory">强制（mandatory）</el-radio>
            <el-radio value="guidance">引导（guidance）</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="审查维度">
          <el-radio-group v-model="editForm.auditDimension">
            <el-radio value="compliance">合规（compliance）</el-radio>
            <el-radio value="fact">事实（fact）</el-radio>
            <el-radio value="text">文本（text）</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="条文文本">
          <el-input
            v-model="editForm.clauseText"
            type="textarea"
            :rows="3"
            readonly
            placeholder="条文文本（只读，由切分产生）"
          />
        </el-form-item>
        <el-form-item label="判定 Prompt">
          <el-input
            v-model="editForm.checkPrompt"
            type="textarea"
            :rows="6"
            placeholder="LLM 加工出的判定 prompt，可人工修正"
            :maxlength="8000"
            show-word-limit
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="editLoading" @click="handleSubmitEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft, MagicStick, Refresh, Tickets, Search, Edit, Delete,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, type FormInstance } from 'element-plus'
import {
  getStandardByIdApi,
  getCheckpointsApi,
  generateCheckpointsApi,
  updateCheckpointApi,
  deleteCheckpointApi,
} from '@/api/standard'
import { useUserStore } from '@/stores/user'
import type { Standard, StandardCheckpoint, CheckpointStats } from '@/types/models'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const canManage = computed(() => userStore.isAdminOrManager())

const standardId = computed(() => route.params.id as string)

// ==================== 数据状态 ====================
const standard = ref<Standard | null>(null)
const checkpoints = ref<StandardCheckpoint[]>([])
const loading = ref(false)
const generating = ref(false)

const emptyStats: CheckpointStats = { total: 0, mandatory: 0, guidance: 0, compliance: 0, fact: 0, text: 0 }
const stats = ref<CheckpointStats>({ ...emptyStats })

const hasCheckpoints = computed(() => checkpoints.value.length > 0)

// ==================== 筛选 ====================
const searchKeyword = ref('')
const filterMandatory = ref('')
const filterDimension = ref('')

const filteredCheckpoints = computed(() => {
  let list = checkpoints.value
  if (filterMandatory.value) {
    list = list.filter(c => c.mandatory === filterMandatory.value)
  }
  if (filterDimension.value) {
    list = list.filter(c => c.auditDimension === filterDimension.value)
  }
  const kw = searchKeyword.value.trim().toLowerCase()
  if (kw) {
    list = list.filter(c =>
      (c.clauseCode || '').toLowerCase().includes(kw) ||
      c.clauseText.toLowerCase().includes(kw)
    )
  }
  return list
})

function dimensionLabel(d: string): string {
  if (d === 'compliance') return '合规'
  if (d === 'fact') return '事实'
  if (d === 'text') return '文本'
  return d
}

// ==================== 数据加载 ====================
async function loadData() {
  if (!standardId.value) return
  loading.value = true
  try {
    const [stdRes, cpRes] = await Promise.all([
      getStandardByIdApi(standardId.value),
      getCheckpointsApi(standardId.value),
    ])
    standard.value = stdRes.data
    checkpoints.value = cpRes.data.checkpoints || []
    stats.value = { ...emptyStats, ...(cpRes.data.stats || {}) }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '加载审点数据失败')
  } finally {
    loading.value = false
  }
}

// ==================== 生成审点 ====================
async function handleGenerate() {
  if (!standard.value) return
  if (!standard.value.content) {
    ElMessage.warning('该标准尚未填充全文内容，无法切分条文。请先在标准库中编辑全文。')
    return
  }
  try {
    await ElMessageBox.confirm(
      '将对标准全文执行条文切分 + LLM 加工，已存在的条文（clauseHash 命中）会自动跳过。是否继续？',
      '生成审点确认',
      { type: 'info', confirmButtonText: '开始加工', cancelButtonText: '取消' }
    )
  } catch {
    return
  }

  generating.value = true
  try {
    const { data } = await generateCheckpointsApi(standardId.value, { concurrency: 3 })
    ElMessage.success(`加工完成：共 ${data.total} 条，新增 ${data.extracted} 条，跳过 ${data.skipped} 条，失败 ${data.failed} 条`)
    await loadData()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '生成审点失败')
  } finally {
    generating.value = false
  }
}

// ==================== 编辑 ====================
const editDialogVisible = ref(false)
const editLoading = ref(false)
const editFormRef = ref<FormInstance>()
const editForm = reactive({
  id: '',
  clauseCode: '',
  mandatory: 'mandatory' as 'mandatory' | 'guidance',
  auditDimension: 'compliance' as 'compliance' | 'fact' | 'text',
  clauseText: '',
  checkPrompt: '',
})

function handleEdit(row: StandardCheckpoint) {
  editForm.id = row.id
  editForm.clauseCode = row.clauseCode || ''
  editForm.mandatory = row.mandatory
  editForm.auditDimension = row.auditDimension
  editForm.clauseText = row.clauseText
  editForm.checkPrompt = row.checkPrompt || ''
  editDialogVisible.value = true
}

function resetEditForm() {
  editForm.id = ''
  editForm.clauseCode = ''
  editForm.mandatory = 'mandatory'
  editForm.auditDimension = 'compliance'
  editForm.clauseText = ''
  editForm.checkPrompt = ''
}

async function handleSubmitEdit() {
  if (!editForm.id) return
  editLoading.value = true
  try {
    await updateCheckpointApi(editForm.id, {
      clauseCode: editForm.clauseCode,
      mandatory: editForm.mandatory,
      auditDimension: editForm.auditDimension,
      checkPrompt: editForm.checkPrompt,
    })
    ElMessage.success('审点已更新')
    editDialogVisible.value = false
    await loadData()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '更新失败')
  } finally {
    editLoading.value = false
  }
}

// ==================== 删除 ====================
async function handleDelete(row: StandardCheckpoint) {
  try {
    await ElMessageBox.confirm(
      `确定删除条文「${row.clauseCode || row.clauseText.slice(0, 30) + '…'}」吗？此操作不可恢复。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await deleteCheckpointApi(row.id)
    ElMessage.success('审点已删除')
    await loadData()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '删除失败')
  }
}

// ==================== 导航 ====================
function goBack() {
  router.push('/admin/standards')
}

onMounted(() => {
  loadData()
})
</script>

<style scoped>
.checkpoint-manager {
  padding: 16px 20px;
  height: 100%;
  overflow-y: auto;
  background: #f8fafc;
}

/* 顶部头部 */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
  padding: 16px 20px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}
.header-left { flex: 1; min-width: 0; }
.header-right { display: flex; gap: 8px; flex-shrink: 0; }

.title-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.title-bar-tag {
  display: inline-block;
  padding: 2px 10px;
  background: #2563eb;
  color: #fff;
  font-size: 12px;
  border-radius: 3px;
  letter-spacing: 0.5px;
}
.standard-title {
  font-size: 18px;
  font-weight: 600;
  color: #111827;
}
.title-desc {
  margin-top: 6px;
  font-size: 12px;
  color: #6b7280;
  line-height: 1.5;
}

/* 统计看板 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}
.stat-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stat-value {
  font-size: 22px;
  font-weight: 600;
  color: #111827;
  line-height: 1.2;
}
.stat-label {
  font-size: 12px;
  color: #6b7280;
}
.stat-sub {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 2px;
}

/* 列表卡片 */
.list-card {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}
.list-card :deep(.el-card__header) {
  padding: 12px 16px;
  background: #fafbfc;
  border-bottom: 1px solid #e5e7eb;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.header-title {
  display: flex;
  align-items: center;
  font-size: 14px;
  font-weight: 600;
  color: #374151;
}
.total-badge {
  margin-left: 8px;
  padding: 1px 8px;
  background: #e5e7eb;
  color: #6b7280;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 400;
}
.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* 表格内容 */
.clause-code {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  color: #2563eb;
  font-weight: 500;
}
.clause-text {
  font-size: 12px;
  color: #374151;
  line-height: 1.5;
}
.prompt-text {
  font-size: 12px;
  color: #6b7280;
  line-height: 1.5;
}
.empty-prompt {
  font-size: 12px;
  color: #d1d5db;
  font-style: italic;
}

/* 维度徽章 */
.dimension-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
}
.dim-compliance { background: #dbeafe; color: #1e40af; }
.dim-fact { background: #fef3c7; color: #92400e; }
.dim-text { background: #e0e7ff; color: #3730a3; }
</style>
