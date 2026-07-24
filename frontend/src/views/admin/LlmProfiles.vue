<template>
  <div class="llm-profiles">
    <div class="page-intro">
      <div class="intro-text">
        <h3>Provider 凭证管理</h3>
        <p>Provider 是凭证的唯一数据源。对话/Embedding/视觉模型 Tab 通过 providerId 引用，凭证改一处全局生效。</p>
      </div>
      <div class="intro-actions">
        <el-button type="primary" @click="addProfile">
          <el-icon><Plus /></el-icon>
          新增 Provider
        </el-button>
        <el-button @click="openBatchScanDialog">
          <el-icon><FolderAdd /></el-icon>
          批量扫描入库
        </el-button>
      </div>
    </div>

    <!-- Provider 列表 -->
    <section class="table-card">
      <el-table :data="profiles" v-loading="loading" stripe class="provider-table">
        <el-table-column prop="name" label="名称" min-width="160" show-overflow-tooltip />
        <el-table-column prop="provider" label="供应商" width="110" />
        <el-table-column prop="apiBase" label="API 地址" min-width="220" show-overflow-tooltip />
        <el-table-column prop="model" label="模型" width="160" show-overflow-tooltip />
        <el-table-column label="用途" width="100">
          <template #default="{ row }">
            <span class="usage-badge" :class="row.usage || 'chat'">{{ getUsageLabel(row.usage) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="能力" width="160">
          <template #default="{ row }">
            <div v-if="row.capabilities" class="cap-tags">
              <span v-if="supportsVision(row)" class="cap-tag">视觉</span>
              <span v-if="row.capabilities.supportsToolCalling" class="cap-tag">工具</span>
              <span class="cap-tag plain">{{ formatContext(row.capabilities.contextWindowTokens) }}</span>
            </div>
            <span v-else class="text-muted">未配置</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <span class="status-dot" :class="row.isActive ? 'active' : row.isEnabled ? 'enabled' : 'disabled'"></span>
            <span class="status-text" :class="row.isActive ? 'active' : row.isEnabled ? 'enabled' : 'disabled'">
              {{ row.isActive ? '默认' : row.isEnabled ? '启用' : '禁用' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row, $index }">
            <el-button size="small" link @click="testConnection(row)">
              <el-icon><Connection /></el-icon>
            </el-button>
            <el-button size="small" link @click="editProfile(row, $index)">编辑</el-button>
            <el-button size="small" link type="danger" @click="deleteProfile($index)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="profiles.length === 0 && !loading" class="empty-state">
        <el-icon :size="40" class="empty-icon"><FirstAidKit /></el-icon>
        <p>暂无 Provider 配置</p>
        <span>点击右上角“新增 Provider”或“批量扫描入库”开始配置</span>
      </div>
    </section>

    <!-- ===== 单条编辑对话框 ===== -->
    <el-dialog v-model="dialogVisible" :title="isEditing ? '编辑 Provider' : '新增 Provider'" width="720px" destroy-on-close>
      <el-form :model="form" label-width="100px" label-position="left">
        <div class="dialog-section">
          <div class="section-title">基础信息</div>
          <div class="form-grid two-col">
            <el-form-item label="名称" required>
              <el-input v-model="form.name" placeholder="如：生产环境 DeepSeek" />
            </el-form-item>
            <el-form-item label="供应商">
              <el-select v-model="form.provider" placeholder="选择供应商" style="width:100%">
                <el-option label="OpenAI 兼容" value="openai-compat" />
                <el-option label="通义千问" value="tongyi" />
                <el-option label="DeepSeek" value="deepseek" />
                <el-option label="Ollama" value="ollama" />
              </el-select>
            </el-form-item>
            <el-form-item label="用途">
              <el-select v-model="form.usage" placeholder="选择用途" style="width:100%">
                <el-option label="对话" value="chat" />
                <el-option label="Embedding" value="embedding" />
                <el-option label="视觉" value="vision" />
                <el-option label="通用" value="all" />
              </el-select>
            </el-form-item>
          </div>
        </div>

        <div class="dialog-section">
          <div class="section-title">连接凭证</div>
          <div class="form-grid two-col">
            <el-form-item label="API 地址" required>
              <el-input v-model="form.apiBase" placeholder="http://localhost:11434/v1" />
            </el-form-item>
            <el-form-item label="API Key">
              <el-input v-model="form.apiKey" type="password" show-password placeholder="本地服务可留空" />
            </el-form-item>
          </div>
          <el-form-item label="模型名" required>
            <el-input v-model="form.model" placeholder="如 deepseek-chat" />
          </el-form-item>
        </div>

        <div class="dialog-section">
          <div class="section-title">
            <span>模型能力</span>
            <el-button size="small" link @click="autoFillCapabilities">
              <el-icon><Search /></el-icon>
              从模型库识别
            </el-button>
          </div>
          <div class="form-grid two-col">
            <el-form-item label="输入模态">
              <el-checkbox-group v-model="form.capabilities.inputModalities">
                <el-checkbox label="text">文本</el-checkbox>
                <el-checkbox label="image">图片（视觉）</el-checkbox>
              </el-checkbox-group>
            </el-form-item>
            <el-form-item label="工具调用">
              <el-switch v-model="form.capabilities.supportsToolCalling" />
              <span class="form-hint">支持 function calling</span>
            </el-form-item>
          </div>
          <div class="form-grid two-col">
            <el-form-item label="上下文窗口">
              <div class="inline-number">
                <el-input-number v-model="form.capabilities.contextWindowTokens" :min="0" :step="1000" />
                <span class="unit-label">tokens</span>
              </div>
            </el-form-item>
            <el-form-item label="最大输出">
              <div class="inline-number">
                <el-input-number v-model="form.capabilities.maxOutputTokens" :min="0" :step="512" />
                <span class="unit-label">tokens</span>
              </div>
            </el-form-item>
          </div>
        </div>

        <div class="dialog-section">
          <div class="section-title">高级选项</div>
          <div class="form-grid three-col">
            <el-form-item label="超时">
              <div class="inline-number">
                <el-input-number v-model="form.timeout" :min="10" :max="300" />
                <span class="unit-label">秒</span>
              </div>
            </el-form-item>
            <el-form-item label="设为默认">
              <el-switch v-model="form.isActive" />
            </el-form-item>
            <el-form-item label="启用">
              <el-switch v-model="form.isEnabled" />
            </el-form-item>
          </div>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveProfile">保存</el-button>
      </template>
    </el-dialog>

    <!-- ===== 批量扫描入库对话框 ===== -->
    <el-dialog v-model="batchDialogVisible" title="批量扫描模型入库" width="920px" :close-on-click-modal="false">
      <div class="batch-hint">
        填入 Provider 凭证 → 点“获取模型” → 勾选要入库的模型 → 可调整每个模型的能力 → 点“批量入库”生成多个 Provider。
      </div>

      <div class="batch-credential">
        <el-form :model="batchForm" label-width="90px" inline>
          <el-form-item label="名称前缀" required>
            <el-input v-model="batchForm.namePrefix" placeholder="如：硅基流动" style="width: 160px" />
          </el-form-item>
          <el-form-item label="供应商">
            <el-select v-model="batchForm.provider" style="width: 130px">
              <el-option label="OpenAI 兼容" value="openai-compat" />
              <el-option label="通义千问" value="tongyi" />
              <el-option label="DeepSeek" value="deepseek" />
              <el-option label="Ollama" value="ollama" />
            </el-select>
          </el-form-item>
          <el-form-item label="用途">
            <el-select v-model="batchForm.usage" style="width: 120px">
              <el-option label="对话" value="chat" />
              <el-option label="Embedding" value="embedding" />
              <el-option label="视觉" value="vision" />
              <el-option label="通用" value="all" />
            </el-select>
          </el-form-item>
          <el-form-item label="API 地址" required>
            <el-input v-model="batchForm.apiBase" placeholder="http://localhost:20128/v1" style="width: 220px" />
          </el-form-item>
          <el-form-item label="API Key">
            <el-input v-model="batchForm.apiKey" type="password" show-password placeholder="sk-..." style="width: 180px" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="batchFetchModels" :loading="fetchingModels">获取模型</el-button>
          </el-form-item>
        </el-form>
      </div>

      <!-- 批量能力默认值 -->
      <div v-if="batchModels.length > 0" class="batch-defaults">
        <el-form :model="batchDefaults" label-width="100px" inline>
          <el-form-item label="批量默认能力">
            <el-checkbox-group v-model="batchDefaults.inputModalities" size="small">
              <el-checkbox label="text">文本</el-checkbox>
              <el-checkbox label="image">图片（视觉）</el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <el-form-item>
            <el-button size="small" @click="applyDefaultsToAll">应用到所有未识别模型</el-button>
          </el-form-item>
        </el-form>
      </div>

      <!-- 扫描结果表格 -->
      <el-table
        :data="batchModels"
        border
        max-height="400"
        v-if="batchModels.length > 0"
        v-loading="fetchingModels"
        @selection-change="onBatchSelectionChange"
        ref="batchTableRef"
        class="batch-table"
      >
        <el-table-column type="selection" width="50" />
        <el-table-column prop="id" label="模型名" min-width="200" show-overflow-tooltip />
        <el-table-column label="能力识别" width="100">
          <template #default="{ row }">
            <span v-if="row.capabilities && hasPresetCapabilities(row)" class="preset-tag preset">已识别</span>
            <span v-else class="preset-tag unknown">未识别</span>
          </template>
        </el-table-column>
        <el-table-column label="输入模态" width="180">
          <template #default="{ row }">
            <el-checkbox-group v-model="row.capabilities.inputModalities" size="small">
              <el-checkbox label="text">文本</el-checkbox>
              <el-checkbox label="image">图片</el-checkbox>
            </el-checkbox-group>
          </template>
        </el-table-column>
        <el-table-column label="工具调用" width="90">
          <template #default="{ row }">
            <el-switch v-model="row.capabilities.supportsToolCalling" />
          </template>
        </el-table-column>
        <el-table-column label="上下文窗口" width="150">
          <template #default="{ row }">
            <el-input-number v-model="row.capabilities.contextWindowTokens" :min="0" :step="1000" size="small" controls-position="right" style="width: 130px" />
          </template>
        </el-table-column>
        <el-table-column label="最大输出" width="150">
          <template #default="{ row }">
            <el-input-number v-model="row.capabilities.maxOutputTokens" :min="0" :step="512" size="small" controls-position="right" style="width: 130px" />
          </template>
        </el-table-column>
      </el-table>

      <template #footer>
        <el-button @click="batchDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="batchImport" :loading="importing" :disabled="batchModels.length === 0">
          批量入库（{{ batchModels.filter(m => m._selected).length }} / {{ batchModels.length }}）
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, nextTick } from 'vue'
import type { ElTable } from 'element-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, FolderAdd, Connection, Search, FirstAidKit } from '@element-plus/icons-vue'
import { getLlmProfilesApi, saveLlmProfilesApi, testLlmConnectionApi, fetchProviderModelsApi, type LlmProfile, type ProviderUsage } from '@/api/system'

interface ModelCapabilities {
  inputModalities: ('text' | 'image')[]
  supportsToolCalling: boolean
  contextWindowTokens: number
  maxOutputTokens: number
}

interface FetchedModel {
  id: string
  capabilities: ModelCapabilities | null
}

/** 批量扫描表格项（带选中标记和可编辑能力） */
interface BatchModelItem extends FetchedModel {
  _selected: boolean
  capabilities: ModelCapabilities  // 批量表格里必填，未识别时给默认值
}

const profiles = ref<LlmProfile[]>([])
const loading = ref(false)

// ===== 单条编辑 =====
const dialogVisible = ref(false)
const isEditing = ref(false)
const editingIndex = ref(-1)
const form = ref<any>({})

// ===== 批量扫描 =====
const batchDialogVisible = ref(false)
const fetchingModels = ref(false)
const importing = ref(false)
const batchModels = ref<BatchModelItem[]>([])
const batchTableRef = ref<InstanceType<typeof ElTable>>()
const batchForm = reactive({
  namePrefix: '',
  provider: 'openai-compat',
  usage: 'chat' as ProviderUsage,
  apiBase: '',
  apiKey: '',
})
const batchDefaults = reactive({
  inputModalities: ['text'] as ('text' | 'image')[],
})

onMounted(async () => {
  loading.value = true
  try {
    const res = await getLlmProfilesApi()
    profiles.value = (res as any).data || []
  } catch {
    ElMessage.error('加载 LLM 配置失败')
  } finally {
    loading.value = false
  }
})

function defaultCapabilities(): ModelCapabilities {
  return {
    inputModalities: ['text'],
    supportsToolCalling: false,
    contextWindowTokens: 0,
    maxOutputTokens: 0,
  }
}

// ==================== 单条编辑 ====================

function addProfile() {
  isEditing.value = false
  editingIndex.value = -1
  form.value = {
    id: Date.now().toString(),
    name: '',
    provider: 'openai-compat',
    usage: 'chat',
    apiBase: '',
    model: '',
    apiKey: '',
    isActive: false,
    isEnabled: true,
    timeout: 60,
    maxRetries: 3,
    capabilities: defaultCapabilities(),
  }
  dialogVisible.value = true
}

function editProfile(row: LlmProfile, index: number) {
  isEditing.value = true
  editingIndex.value = index
  form.value = {
    ...row,
    usage: row.usage || 'chat',
    capabilities: row.capabilities
      ? { ...row.capabilities, inputModalities: [...row.capabilities.inputModalities] }
      : defaultCapabilities(),
  }
  // 脱敏的 key 清空，让用户重新输入
  if (form.value.apiKey && form.value.apiKey.includes('****')) {
    form.value.apiKey = ''
  }
  dialogVisible.value = true
}

function autoFillCapabilities() {
  if (!form.value.model) {
    ElMessage.warning('请先填写模型名')
    return
  }
  // 前端直接复用后端的 lookupCapabilities 逻辑：因为 registry 在 backend，这里简单提示后端接口暂无
  // 实际可通过新增 API 实现；目前用 fetchProviderModelsApi 的返回格式 hack：
  fetchProviderModelsApi({ apiBase: form.value.apiBase, apiKey: form.value.apiKey })
    .then((res: any) => {
      const models = res.data || res || []
      const matched = models.find((m: any) => m.id === form.value.model)
      if (matched?.capabilities) {
        form.value.capabilities = {
          inputModalities: [...matched.capabilities.inputModalities],
          supportsToolCalling: matched.capabilities.supportsToolCalling,
          contextWindowTokens: matched.capabilities.contextWindowTokens,
          maxOutputTokens: matched.capabilities.maxOutputTokens,
        }
        ElMessage.success('已从模型库识别能力')
      } else {
        ElMessage.warning('模型库未命中，请手动填写')
      }
    })
    .catch((e: any) => {
      console.error('识别失败:', e)
      ElMessage.error('识别失败，请检查 API 地址')
    })
}

async function saveProfile() {
  if (!form.value.name || !form.value.apiBase || !form.value.model) {
    ElMessage.warning('请填写必填项')
    return
  }
  form.value.apiBase = normalizeApiBase(form.value.apiBase)

  if (isEditing.value && editingIndex.value >= 0) {
    profiles.value[editingIndex.value] = { ...form.value }
  } else {
    profiles.value.push({ ...form.value })
  }

  // 如果设为默认，取消其他默认
  if (form.value.isActive) {
    profiles.value.forEach((p, i) => {
      if (i !== (isEditing.value ? editingIndex.value : profiles.value.length - 1)) {
        p.isActive = false
      }
    })
  }

  try {
    await saveLlmProfilesApi(profiles.value)
    ElMessage.success('保存成功')
    dialogVisible.value = false
    const res = await getLlmProfilesApi()
    profiles.value = (res as any).data || []
  } catch {
    ElMessage.error('保存失败')
  }
}

function deleteProfile(index: number) {
  ElMessageBox.confirm('确定删除该配置？').then(async () => {
    profiles.value.splice(index, 1)
    await saveLlmProfilesApi(profiles.value)
    ElMessage.success('已删除')
  }).catch(() => {})
}

async function testConnection(row: LlmProfile) {
  ElMessage.info('正在测试连接...')
  try {
    const res = await testLlmConnectionApi({
      providerId: row.id,
      modelType: 'chat',
    })
    const data = (res as any).data || res
    if (data.success) {
      ElMessage.success(`连接成功`)
    } else {
      ElMessage.error(data.message || '连接失败')
    }
  } catch (e: any) {
    ElMessage.error(e.message || '连接测试失败')
  }
}

// ==================== 批量扫描入库 ====================

function openBatchScanDialog() {
  batchForm.namePrefix = ''
  batchForm.provider = 'openai-compat'
  batchForm.usage = 'chat'
  batchForm.apiBase = ''
  batchForm.apiKey = ''
  batchModels.value = []
  batchDefaults.inputModalities = ['text']
  batchDialogVisible.value = true
}

/** 补全 apiBase 的协议前缀 */
function normalizeApiBase(raw: string): string {
  const trimmed = (raw || '').trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `http://${trimmed}`
}

async function batchFetchModels() {
  if (!batchForm.apiBase) {
    ElMessage.warning('请先填写 API 地址')
    return
  }
  if (!batchForm.namePrefix) {
    ElMessage.warning('请填写名称前缀（用于生成 Provider 名称）')
    return
  }
  fetchingModels.value = true
  try {
    const apiBase = normalizeApiBase(batchForm.apiBase)
    const res = await fetchProviderModelsApi({ apiBase, apiKey: batchForm.apiKey })
    const models = (res as any).data || res
    if (Array.isArray(models)) {
      // 每个 FetchedModel 转为可编辑的 BatchModelItem
      batchModels.value = models.map((m: FetchedModel) => ({
        id: m.id,
        capabilities: m.capabilities
          ? { ...m.capabilities, inputModalities: [...m.capabilities.inputModalities] }
          : defaultCapabilities(),
        _selected: true,  // 默认全选
      }))
      const presetHit = models.filter((m: FetchedModel) => m.capabilities).length
      ElMessage.success(`获取到 ${models.length} 个模型（预置库命中 ${presetHit} 个）`)
      // 默认全选：等表格渲染完调用 toggleAllSelection
      await nextTick()
      batchTableRef.value?.toggleAllSelection()
    } else {
      ElMessage.error('响应格式异常')
    }
  } catch (e: any) {
    console.error('fetch-models 失败:', e)
  } finally {
    fetchingModels.value = false
  }
}

/** el-table selection-change 事件同步到 _selected 字段 */
function onBatchSelectionChange(selection: BatchModelItem[]) {
  const selectedIds = new Set(selection.map((s) => s.id))
  batchModels.value.forEach((m) => {
    m._selected = selectedIds.has(m.id)
  })
}

/** 判断模型能力是否来自预置库（简单规则：上下文窗口>0 或 最大输出>0） */
function hasPresetCapabilities(row: BatchModelItem): boolean {
  return row.capabilities.contextWindowTokens > 0 || row.capabilities.maxOutputTokens > 0
}

/** 把批量默认能力应用到所有未识别的模型 */
function applyDefaultsToAll() {
  batchModels.value.forEach((m) => {
    // 仅对预置库未命中的（_capabilitiesFromPreset=false）应用
    // 简化：直接应用，让用户决定
    m.capabilities.inputModalities = [...batchDefaults.inputModalities]
  })
  ElMessage.success('已应用到所有模型')
}

async function batchImport() {
  const selected = batchModels.value.filter((m) => m._selected)
  if (selected.length === 0) {
    ElMessage.warning('请至少勾选一个模型')
    return
  }

  importing.value = true
  try {
    // 检查重复（apiBase + model 完全相同视为重复）
    const existingKeys = new Set(
      profiles.value.map((p) => `${(p.apiBase || '').trim()}|${p.model}`),
    )

    const newProfiles: LlmProfile[] = []
    let skipped = 0
    selected.forEach((m, idx) => {
      const apiBase = normalizeApiBase(batchForm.apiBase)
      const key = `${apiBase}|${m.id}`
      if (existingKeys.has(key)) {
        skipped++
        return
      }
      newProfiles.push({
        id: `prof_${Date.now().toString(36)}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
        name: `${batchForm.namePrefix} - ${m.id}`,
        provider: batchForm.provider,
        apiBase,
        apiKey: batchForm.apiKey,
        model: m.id,
        isActive: false,
        isEnabled: true,
        timeout: 60,
        maxRetries: 3,
        usage: batchForm.usage,
        capabilities: {
          inputModalities: [...m.capabilities.inputModalities],
          supportsToolCalling: m.capabilities.supportsToolCalling,
          contextWindowTokens: m.capabilities.contextWindowTokens,
          maxOutputTokens: m.capabilities.maxOutputTokens,
        },
      })
    })

    profiles.value.push(...newProfiles)
    await saveLlmProfilesApi(profiles.value)

    ElMessage.success(`入库成功：新增 ${newProfiles.length} 个${skipped > 0 ? `，跳过 ${skipped} 个已存在` : ''}`)
    batchDialogVisible.value = false

    // 重新加载脱敏数据
    const res = await getLlmProfilesApi()
    profiles.value = (res as any).data || []
  } catch (e: any) {
    ElMessage.error(`批量入库失败: ${e.message || '未知错误'}`)
  } finally {
    importing.value = false
  }
}

// ===== 能力展示辅助 =====
function supportsVision(row: any): boolean {
  return row.capabilities?.inputModalities?.includes('image') ?? false
}

function formatContext(tokens: number): string {
  if (!tokens) return '上下文未知'
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`
  return `${tokens}`
}

function getUsageLabel(usage?: ProviderUsage): string {
  const map: Record<string, string> = {
    chat: '对话',
    embedding: 'Embedding',
    vision: '视觉',
    all: '通用',
  }
  return map[usage || 'chat'] || '对话'
}
</script>

<style scoped>
.llm-profiles {
  padding: 20px 24px 32px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-intro {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  padding: 4px 0 4px 12px;
  border-left: 3px solid #2563eb;
}

.intro-text h3 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: #0f172a;
}

.intro-text p {
  margin: 0;
  font-size: 12.5px;
  color: #64748b;
  max-width: 600px;
  line-height: 1.5;
}

.intro-actions {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

/* 表格卡片 */
.table-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  overflow: hidden;
}

.provider-table {
  --el-table-header-bg-color: #fafbfc;
}

.cap-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}

.cap-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 18px;
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #e2e8f0;
}

.cap-tag.plain {
  background: transparent;
  border-color: #e2e8f0;
  color: #64748b;
}

.usage-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 48px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid transparent;
}

.usage-badge.chat {
  background: #eff6ff;
  color: #2563eb;
  border-color: #bfdbfe;
}

.usage-badge.embedding {
  background: #f5f3ff;
  color: #7c3aed;
  border-color: #ddd6fe;
}

.usage-badge.vision {
  background: #f0fdfa;
  color: #0d9488;
  border-color: #99f6e4;
}

.usage-badge.all {
  background: #f1f5f9;
  color: #64748b;
  border-color: #e2e8f0;
}

.status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
}

.status-dot.active { background: #2563eb; }
.status-dot.enabled { background: #10b981; }
.status-dot.disabled { background: #94a3b8; }

.status-text {
  font-size: 12px;
}

.status-text.active { color: #2563eb; font-weight: 500; }
.status-text.enabled { color: #15803d; }
.status-text.disabled { color: #64748b; }

.text-muted {
  color: #94a3b8;
  font-size: 12px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 20px;
  color: #94a3b8;
  text-align: center;
}

.empty-icon {
  margin-bottom: 12px;
  color: #cbd5e1;
}

.empty-state p {
  margin: 0 0 4px;
  font-size: 14px;
  color: #64748b;
}

.empty-state span {
  font-size: 12px;
}

/* 对话框 */
.dialog-section {
  margin-bottom: 18px;
}

.dialog-section:last-child {
  margin-bottom: 0;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f1f5f9;
}

.form-grid {
  display: grid;
  gap: 0 16px;
}

.form-grid.two-col {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.form-grid.three-col {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.inline-number {
  display: flex;
  align-items: center;
  gap: 8px;
}

.unit-label {
  font-size: 12px;
  color: #64748b;
}

.form-hint {
  margin-left: 8px;
  color: #94a3b8;
  font-size: 12px;
}

/* 批量扫描 */
.batch-hint {
  font-size: 12px;
  color: #64748b;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 16px;
  line-height: 1.5;
}

.batch-credential {
  padding: 16px;
  background: #fafbfc;
  border: 1px solid #f1f5f9;
  border-radius: 6px;
  margin-bottom: 16px;
}

.batch-defaults {
  padding: 10px 12px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 6px;
  margin-bottom: 12px;
}

.preset-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.preset-tag.preset {
  background: #f0fdf4;
  color: #15803d;
}

.preset-tag.unknown {
  background: #f1f5f9;
  color: #64748b;
}

.batch-table :deep(.el-checkbox-group) {
  display: flex;
  gap: 8px;
}

@media (max-width: 760px) {
  .form-grid.two-col,
  .form-grid.three-col {
    grid-template-columns: 1fr;
  }

  .page-intro {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
