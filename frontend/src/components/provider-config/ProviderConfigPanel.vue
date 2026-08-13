<template>
  <div
    :class="mode === 'dialog' ? 'pcfg-overlay' : 'pcfg-inline-root'"
    @click.self="mode === 'dialog' && emit('close')"
  >
    <div class="pcfg-dialog" :class="{ 'is-inline': mode === 'inline' }">
      <!-- Header -->
      <div class="pcfg-header">
        <div class="pcfg-header-left">
          <span class="pcfg-header-title">模型配置</span>
          <code class="pcfg-header-path">LLM 供应商配置（llm_profiles）</code>
        </div>
        <button v-if="mode === 'dialog'" class="pcfg-header-close" title="关闭" @click="emit('close')">×</button>
      </div>

      <!-- Body：左树 + 右详情 -->
      <div class="pcfg-body">
        <!-- 左树 -->
        <div class="pcfg-tree-col">
          <div class="pcfg-tree-scroll">
            <div v-if="loading" class="pcfg-tree-hint">加载中…</div>
            <template v-else-if="providerNames.length > 0">
              <div v-for="name in providerNames" :key="name" class="pcfg-tree-group">
                <!-- 供应商行 -->
                <div
                  class="pcfg-provider-row"
                  :class="{ selected: isProviderSelected(name) }"
                  @click="selectProvider(name)"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" />
                    <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
                    <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
                    <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
                    <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
                  </svg>
                  <span class="pcfg-provider-name" :class="{ selected: isProviderSelected(name) }">{{ name }}</span>
                </div>

                <!-- 模型行 -->
                <div
                  v-for="(m, i) in config.providers[name].models"
                  :key="i"
                  class="pcfg-model-row"
                  :class="{ selected: isModelSelected(name, i) }"
                  @click="selectModel(name, i)"
                >
                  <span class="pcfg-model-id">{{ m.id || '新模型' }}</span>
                  <span v-if="m.reasoning" class="pcfg-badge-t">推理</span>
                </div>

                <!-- + 模型 -->
                <div class="pcfg-add-model" @click="addModel(name)">+ 模型</div>
              </div>
            </template>
            <div v-else class="pcfg-tree-hint dim">暂无供应商配置</div>
          </div>

          <!-- + 添加供应商 -->
          <div class="pcfg-tree-add">
            <button class="pcfg-add-provider-btn" @click="addCustomProvider()">+ 添加供应商</button>
          </div>
        </div>

        <!-- 右详情 -->
        <div class="pcfg-detail-col">
          <!-- 供应商详情 -->
          <template v-if="selection?.type === 'provider' && config.providers[selection.name]">
            <div class="pcfg-detail-top">
              <span class="pcfg-section-title">供应商</span>
              <button class="pcfg-btn-delete" @click="deleteProvider(selection.name)">删除</button>
            </div>

            <div class="pcfg-field">
              <span class="pcfg-field-label">供应商名称</span>
              <input v-model="editingName" class="pcfg-text-input mono" placeholder="如 openai" @keyup.enter="doRename" />
              <button v-if="editingName !== selection.name && editingName.trim()" class="pcfg-btn-rename" @click="doRename">重命名</button>
            </div>

            <div class="pcfg-field">
              <span class="pcfg-field-label">API 地址</span>
              <input
                v-model="currentProvider.baseUrl"
                class="pcfg-text-input mono"
                placeholder="https://api.example.com/v1"
              />
            </div>

            <div class="pcfg-field">
              <span class="pcfg-field-label">API 密钥</span>
              <div class="pcfg-secret-wrap">
                <input
                  v-model="currentProvider.apiKey"
                  :type="showSecret ? 'text' : 'password'"
                  class="pcfg-text-input mono pcfg-secret-input"
                  placeholder="环境变量名 或 直接填写密钥"
                  autocomplete="off"
                  spellcheck="false"
                />
                <button class="pcfg-eye-btn" :title="showSecret ? '隐藏' : '显示'" @click="showSecret = !showSecret">
                  <svg v-if="showSecret" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.89 1 12a18.45 18.45 0 0 1 5.06-6.94" />
                    <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
                    <path d="M1 1l22 22" />
                  </svg>
                  <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              </div>
              <span class="pcfg-field-hint">支持环境变量名或直接填写密钥</span>
            </div>

            <!-- 模型发现 -->
            <div class="pcfg-field">
              <span class="pcfg-field-label">模型发现</span>
              <button
                class="pcfg-btn-discover"
                :disabled="!currentProvider.baseUrl?.trim() || discovery.phase === 'loading'"
                @click="handleDiscover"
              >
                {{ discovery.phase === 'loading' ? '拉取中…' : discovery.phase === 'success' ? '重新拉取' : '从服务端拉取模型列表' }}
              </button>
              <span v-if="discovery.error" class="pcfg-error-text">{{ discovery.error }}</span>

              <div v-if="discovery.phase === 'success'" class="pcfg-discover-box">
                <input
                  v-model="discovery.query"
                  class="pcfg-text-input"
                  :placeholder="`筛选 ${discovery.models.length} 个模型…`"
                />
                <div class="pcfg-discover-list">
                  <label
                    v-for="dm in filteredDiscoveredModels"
                    :key="dm.id"
                    class="pcfg-discover-item"
                    :class="{ added: isDiscoveredAdded(dm.id) }"
                  >
                    <input
                      type="checkbox"
                      :checked="isDiscoveredAdded(dm.id) || discovery.selected.includes(dm.id)"
                      :disabled="isDiscoveredAdded(dm.id)"
                      @change="toggleDiscovered(dm.id)"
                    />
                    <span class="pcfg-discover-name">{{ dm.name ?? dm.id }}</span>
                    <code v-if="dm.name" class="pcfg-discover-id">{{ dm.id }}</code>
                  </label>
                  <div v-if="filteredDiscoveredModels.length === 0" class="pcfg-tree-hint dim">无匹配模型</div>
                </div>
                <button
                  class="pcfg-btn-primary sm"
                  :disabled="newSelectedCount === 0"
                  @click="addDiscoveredModels"
                >
                  添加已选 {{ newSelectedCount > 0 ? `(${newSelectedCount})` : '' }}
                </button>
              </div>
            </div>
          </template>

          <!-- 模型详情 -->
          <template v-else-if="selection?.type === 'model' && config.providers[selection.providerName]?.models[selection.index]">
            <div class="pcfg-detail-top">
              <span class="pcfg-section-title">模型</span>
              <div class="pcfg-detail-actions">
                <span v-if="modelTest.phase === 'success'" class="pcfg-test-pill ok">{{ modelTestSummary }}</span>
                <span v-else-if="modelTest.phase === 'error'" class="pcfg-test-pill err">{{ modelTestSummary }}</span>
                <button
                  class="pcfg-btn-test"
                  :class="{ success: modelTest.phase === 'success' }"
                  :disabled="!currentModel.id.trim() || modelTest.phase === 'testing'"
                  title="测试连接"
                  @click="handleTest"
                >
                  <svg v-if="modelTest.phase === 'success'" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  {{ modelTest.phase === 'testing' ? '测试中…' : modelTest.phase === 'success' ? '已连接' : '测试' }}
                </button>
                <button class="pcfg-btn-delete" @click="removeModel(selection.providerName, selection.index)">移除</button>
              </div>
            </div>

            <div class="pcfg-field-grid">
              <div class="pcfg-field">
                <span class="pcfg-field-label">模型 ID *</span>
                <input v-model="currentModel.id" class="pcfg-text-input mono" placeholder="model-id" @blur="currentModel._idDirty = true" />
              </div>
              <div class="pcfg-field">
                <span class="pcfg-field-label">显示名称</span>
                <input v-model="currentModel.name" class="pcfg-text-input" placeholder="显示名称" />
              </div>
            </div>

            <!-- 目录填充（本地预置库） -->
            <div class="pcfg-field">
              <button
                class="pcfg-btn-discover"
                :disabled="!currentModel.id.trim() || catalog.phase === 'loading'"
                @click="handleCatalog"
              >
                {{ catalog.phase === 'loading' ? '填充中…' : '从预置库填充字段' }}
              </button>
              <span v-if="catalog.message" class="pcfg-catalog-msg" :class="{ err: catalog.phase === 'error' }">{{ catalog.message }}</span>
            </div>

            <div class="pcfg-check-row">
              <label class="pcfg-check-label">
                <input v-model="currentModel.reasoning" type="checkbox" class="pcfg-check-input" />
                推理（Reasoning）
              </label>
              <label class="pcfg-check-label">
                <input v-model="currentModel.imageInput" type="checkbox" class="pcfg-check-input" />
                图片输入（Image input）
              </label>
            </div>

            <!-- 思考等级映射（推理模型时显示） -->
            <div v-if="currentModel.reasoning" class="pcfg-field">
              <div class="pcfg-tlm-head">
                <span class="pcfg-field-label">思考等级映射</span>
                <button
                  v-if="currentModel.thinkingLevelMap"
                  class="pcfg-btn-clear"
                  @click="currentModel.thinkingLevelMap = undefined"
                >清除全部</button>
              </div>
              <div class="pcfg-tlm-list">
                <div v-for="lv in THINKING_LEVELS" :key="lv" class="pcfg-tlm-row">
                  <span class="pcfg-tlm-level" :class="{ muted: tlmState(lv) === 'null' }">
                    <span class="pcfg-tlm-dot" :style="{ background: tlmColor(lv) }" :class="{ dim: tlmState(lv) === 'null' }" />
                    {{ lv }}
                  </span>
                  <div class="pcfg-tlm-btns">
                    <button :class="{ active: tlmState(lv) === 'omit' }" @click="setTlm(lv, 'omit')">默认</button>
                    <button :class="{ danger: tlmState(lv) === 'null' }" @click="setTlm(lv, null)">禁用</button>
                  </div>
                  <div class="pcfg-tlm-custom" :class="{ active: tlmState(lv) === 'string' }">
                    <button :class="{ active: tlmState(lv) === 'string' }" @click="setTlm(lv, currentModel.thinkingLevelMap?.[lv] || lv)">自定义</button>
                    <input
                      :value="tlmValue(lv)"
                      :placeholder="lv"
                      maxlength="10"
                      @focus="setTlm(lv, tlmValue(lv) || lv)"
                      @input="setTlm(lv, ($event.target as HTMLInputElement).value)"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div class="pcfg-field-grid">
              <div class="pcfg-field">
                <span class="pcfg-field-label">上下文窗口（tokens）</span>
                <input
                  type="number"
                  v-model.number="currentModel.contextWindow"
                  class="pcfg-text-input"
                  placeholder="128000"
                  @input="currentModel.contextWindow = currentModel.contextWindow || undefined"
                />
              </div>
              <div class="pcfg-field">
                <span class="pcfg-field-label">最大输出（tokens）</span>
                <input
                  type="number"
                  v-model.number="currentModel.maxTokens"
                  class="pcfg-text-input"
                  placeholder="16384"
                  @input="currentModel.maxTokens = currentModel.maxTokens || undefined"
                />
              </div>
            </div>

            <div class="pcfg-field">
              <span class="pcfg-field-label">成本（每百万 tokens）</span>
              <div class="pcfg-cost-grid">
                <div v-for="k in COST_KEYS" :key="k" class="pcfg-cost-item">
                  <span class="pcfg-cost-label">{{ costKeyLabel(k) }}</span>
                  <input
                    type="number"
                    :value="costVal(k)"
                    placeholder="0"
                    class="pcfg-text-input"
                    @input="setCost(k, ($event.target as HTMLInputElement).value)"
                  />
                </div>
              </div>
            </div>
          </template>

          <div v-else class="pcfg-detail-empty">请选择供应商或模型</div>
        </div>
      </div>

      <!-- Footer -->
      <div class="pcfg-footer">
        <span v-if="saveError" class="pcfg-save-error">{{ saveError }}</span>
        <button class="pcfg-btn" @click="emit('close')">取消</button>
        <button class="pcfg-btn primary" :class="{ saved: savedOk }" :disabled="saving" @click="handleSave">
          <svg v-if="savedOk" class="pcfg-saved-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          <span>{{ savedOk ? '已保存' : saving ? '保存中…' : '保存' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  listAgentProvidersApi,
  saveAgentProvidersApi,
  testAgentModelApi,
  discoverAgentModelsApi,
  agentCatalogApi,
  type AgentProviderProfile,
  type DiscoveredAgentModel,
} from '@/api/agent'

const props = withDefaults(defineProps<{ mode?: 'dialog' | 'inline' }>(), { mode: 'dialog' })
const emit = defineEmits<{ close: []; saved: [] }>()

// 只支持常见的 OpenAI 兼容格式（Chat Completions），其他协议暂不支持
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const COST_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const
const COST_KEY_LABELS: Record<(typeof COST_KEYS)[number], string> = {
  input: '输入',
  output: '输出',
  cacheRead: '缓存读取',
  cacheWrite: '缓存写入',
}

function costKeyLabel(k: (typeof COST_KEYS)[number]): string {
  return COST_KEY_LABELS[k]
}

// ── 内部树结构（参考项目 models.json：providers 嵌套 models）──

interface TreeModel {
  id: string
  name?: string
  reasoning?: boolean
  imageInput?: boolean
  thinkingLevelMap?: Record<string, string | null>
  contextWindow?: number
  maxTokens?: number
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
  _profileId?: string
  _idDirty?: boolean
  _original?: Record<string, any>
}
interface TreeProvider {
  baseUrl?: string
  apiKey?: string
  _originalProvider?: string
  models: TreeModel[]
}
interface TreeConfig {
  providers: Record<string, TreeProvider>
}
type Selection =
  | { type: 'provider'; name: string }
  | { type: 'model'; providerName: string; index: number }

type ModelTestState =
  | { phase: 'idle' }
  | { phase: 'testing' }
  | { phase: 'success' }
  | { phase: 'error'; message: string }

// ── 状态 ──

const config = ref<TreeConfig>({ providers: {} })
const loading = ref(false)
const saving = ref(false)
const savedOk = ref(false)
const saveError = ref<string | null>(null)
const selection = ref<Selection | null>(null)
const showSecret = ref(false)
const modelTest = ref<ModelTestState>({ phase: 'idle' })

// discover 状态
const discovery = ref<{
  phase: 'idle' | 'loading' | 'success' | 'error'
  models: DiscoveredAgentModel[]
  selected: string[]
  query: string
  error: string | null
}>({ phase: 'idle', models: [], selected: [], query: '', error: null })

// catalog 状态
const catalog = ref<{ phase: 'idle' | 'loading' | 'success' | 'error'; message: string | null }>({
  phase: 'idle',
  message: null,
})

const providerNames = computed(() => Object.keys(config.value.providers))

const currentProvider = computed(() =>
  selection.value?.type === 'provider' ? config.value.providers[selection.value.name] : null,
)
const currentModel = computed(() =>
  selection.value?.type === 'model'
    ? config.value.providers[selection.value.providerName]?.models[selection.value.index]
    : null,
)

const editingName = ref('')
watch(
  () => (selection.value?.type === 'provider' ? selection.value.name : ''),
  (name) => { editingName.value = name || '' },
  { immediate: true },
)

// 切换选中时重置测试 / 发现 / 目录状态
watch(
  () => selection.value,
  () => {
    modelTest.value = { phase: 'idle' }
    discovery.value = { phase: 'idle', models: [], selected: [], query: '', error: null }
    catalog.value = { phase: 'idle', message: null }
  },
)

const modelTestSummary = computed(() => {
  const t = modelTest.value
  if (t.phase === 'success') return '已连接'
  if (t.phase === 'error') return t.message
  return ''
})

// ── 数据转换：llm_profiles → 两级树 ──

function genId(): string {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

async function loadConfig() {
  loading.value = true
  try {
    const res = await listAgentProvidersApi()
    const profiles = res.data || []
    const providers: Record<string, TreeProvider> = {}
    for (const p of profiles) {
      const name = p.name || p.id || '未命名'
      if (!providers[name]) {
        providers[name] = {
          baseUrl: p.apiBase,
          apiKey: p.apiKey,
          _originalProvider: p.provider || 'openai-compatible',
          models: [],
        }
      }
      providers[name].models.push({
        id: p.model || '',
        name: p.model || undefined,
        reasoning: !!p.capabilities?.reasoning,
        imageInput: (p.capabilities?.inputModalities ?? []).includes('image'),
        thinkingLevelMap: (p as any).thinkingLevelMap,
        contextWindow: p.capabilities?.contextWindowTokens,
        maxTokens: p.capabilities?.maxOutputTokens,
        cost: (p as any).cost,
        _profileId: p.id,
        _original: p as unknown as Record<string, any>,
      })
    }
    config.value = { providers }
    const keys = Object.keys(providers)
    if (keys.length === 1) {
      // 只有一个供应商时，默认直接进入第一个模型（省去"选供应商"步骤）
      const models = providers[keys[0]].models
      selection.value = models.length
        ? { type: 'model', providerName: keys[0], index: 0 }
        : { type: 'provider', name: keys[0] }
    } else if (keys.length > 1) {
      selection.value = { type: 'provider', name: keys[0] }
    } else {
      selection.value = null
    }
  } catch (e: any) {
    ElMessage.error(`加载模型配置失败：${e?.message || e}`)
  } finally {
    loading.value = false
  }
  // 加载完成后自动补全已配置模型缺失的能力字段（静默，不阻塞，失败跳过）
  void autoEnrichCapabilities()
}

/**
 * 已配置模型能力自动补全：对 contextWindow/maxTokens/reasoning 缺失的模型，
 * 从供应商上游 /models 接口探测真实能力并回填（只填缺失字段，不覆盖已有值）。
 * 供应商不可达或无 /models 接口时静默跳过。
 */
async function autoEnrichCapabilities() {
  for (const [name, pv] of Object.entries(config.value.providers)) {
    if (!pv.baseUrl?.trim()) continue
    const needEnrich = pv.models.some(
      (m) => m.contextWindow === undefined || m.maxTokens === undefined || m.reasoning === undefined,
    )
    if (!needEnrich) continue
    try {
      const res = await discoverAgentModelsApi({
        providerName: name,
        provider: { baseUrl: pv.baseUrl, api: 'openai-completions', apiKey: pv.apiKey },
      })
      const models = res.data?.models || []
      if (models.length === 0) continue
      for (const m of pv.models) {
        const dm = models.find((x) => x.id === m.id)
        if (!dm) continue
        if (m.contextWindow === undefined && dm.contextWindow) m.contextWindow = dm.contextWindow
        if (m.maxTokens === undefined && dm.maxTokens) m.maxTokens = dm.maxTokens
        if (m.reasoning === undefined && dm.reasoning) m.reasoning = true
        if (m.imageInput === undefined && dm.inputModalities?.includes('image')) m.imageInput = true
      }
    } catch {
      // 供应商不可达或 /models 无权限：静默跳过，字段保持原样，用户可手动拉取
    }
  }
}

// ── 选中与增删 ──

function isProviderSelected(name: string): boolean {
  return selection.value?.type === 'provider' && selection.value.name === name
}
function isModelSelected(name: string, index: number): boolean {
  return selection.value?.type === 'model' && selection.value.providerName === name && selection.value.index === index
}
function selectProvider(name: string) { selection.value = { type: 'provider', name } }
function selectModel(name: string, index: number) { selection.value = { type: 'model', providerName: name, index } }

function addModel(name: string) {
  const pv = config.value.providers[name]
  if (!pv) return
  pv.models.push({ id: '' })
  selection.value = { type: 'model', providerName: name, index: pv.models.length - 1 }
}

/** 添加供应商：直接创建默认 provider（不弹中间选择器） */
function addCustomProvider() {
  let name = 'new-provider'
  let n = 1
  while (config.value.providers[name]) name = `new-provider-${n++}`
  config.value.providers[name] = { api: 'openai-completions', models: [] }
  selection.value = { type: 'provider', name }
}

function doRename() {
  if (!selection.value || selection.value.type !== 'provider') return
  const next = editingName.value.trim()
  if (!next || next === selection.value.name) return
  renameProvider(selection.value.name, next)
}

function renameProvider(oldName: string, newName: string) {
  const pv = config.value.providers[oldName]
  if (!pv || config.value.providers[newName]) return
  config.value.providers[newName] = pv
  delete config.value.providers[oldName]
  if (selection.value?.type === 'provider' && selection.value.name === oldName) {
    selection.value = { type: 'provider', name: newName }
  } else if (selection.value?.type === 'model' && selection.value.providerName === oldName) {
    selection.value.providerName = newName
  }
}

function deleteProvider(name: string) {
  delete config.value.providers[name]
  const rest = Object.keys(config.value.providers)
  selection.value = rest.length ? { type: 'provider', name: rest[0] } : null
}

function removeModel(providerName: string, index: number) {
  const pv = config.value.providers[providerName]
  if (!pv) return
  pv.models.splice(index, 1)
  selection.value = { type: 'provider', name: providerName }
}

// ── 模型发现 discover ──

const filteredDiscoveredModels = computed(() => {
  const q = discovery.value.query.trim().toLowerCase()
  if (!q) return discovery.value.models
  return discovery.value.models.filter(
    (m) => m.id.toLowerCase().includes(q) || (m.name ?? '').toLowerCase().includes(q),
  )
})

function isDiscoveredAdded(id: string): boolean {
  const pv = currentProvider.value
  return !!pv?.models.some((m) => m.id === id)
}

function toggleDiscovered(id: string) {
  const sel = discovery.value.selected
  discovery.value.selected = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]
}

const newSelectedCount = computed(() => {
  const pv = currentProvider.value
  if (!pv) return 0
  return discovery.value.selected.filter((id) => !pv.models.some((m) => m.id === id)).length
})

async function handleDiscover() {
  const pv = currentProvider.value
  if (!pv || !selection.value || selection.value.type !== 'provider') return
  if (!pv.baseUrl?.trim() || discovery.value.phase === 'loading') return
  discovery.value = { phase: 'loading', models: [], selected: [], query: '', error: null }
  try {
    const res = await discoverAgentModelsApi({
      providerName: selection.value.name,
      provider: { baseUrl: pv.baseUrl, api: 'openai-completions', apiKey: pv.apiKey },
    })
    discovery.value = {
      phase: 'success',
      models: res.data?.models || [],
      selected: [],
      query: '',
      error: null,
    }
  } catch (e: any) {
    discovery.value = { phase: 'error', models: [], selected: [], query: '', error: e?.message || '拉取失败' }
  }
}

function addDiscoveredModels() {
  const pv = currentProvider.value
  if (!pv) return
  const selectedModels = discovery.value.models.filter((m) => discovery.value.selected.includes(m.id))
  for (const dm of selectedModels) {
    if (pv.models.some((m) => m.id === dm.id)) continue
    // 自动回填上游 /models 返回的能力信息（上下文窗口/最大输出/推理/图片输入）
    pv.models.push({
      id: dm.id,
      name: dm.id,
      reasoning: dm.reasoning,
      imageInput: dm.inputModalities?.includes('image'),
      contextWindow: dm.contextWindow,
      maxTokens: dm.maxTokens,
    })
  }
  discovery.value.selected = []
}

// ── 目录填充 catalog（本地预置库替代 models.dev）──

async function handleCatalog() {
  const model = currentModel.value
  if (!model || !model.id.trim() || catalog.value.phase === 'loading') return
  catalog.value = { phase: 'loading', message: null }
  try {
    const res = await agentCatalogApi({ model: model.id.trim() })
    const rec = res.data?.recommendation
    if (!res.data?.matched || !rec) {
      catalog.value = { phase: 'success', message: '预置库未收录该模型，可手动填写' }
      return
    }
    let applied = 0
    if (!model.name && rec.name) { model.name = rec.name; applied++ }
    if (model.reasoning === undefined && rec.reasoning) { model.reasoning = true; applied++ }
    if (!model.imageInput && rec.input?.includes('image')) { model.imageInput = true; applied++ }
    if (model.contextWindow === undefined && rec.contextWindow) { model.contextWindow = rec.contextWindow; applied++ }
    if (model.maxTokens === undefined && rec.maxTokens) { model.maxTokens = rec.maxTokens; applied++ }
    catalog.value = {
      phase: 'success',
      message: applied > 0 ? `已填充 ${applied} 个字段` : '字段已齐全，无需填充',
    }
  } catch (e: any) {
    catalog.value = { phase: 'error', message: e?.message || '填充失败' }
  }
}

// ── 模型测试 ──

async function handleTest() {
  const pv = selection.value?.type === 'model' ? config.value.providers[selection.value.providerName] : null
  const model = currentModel.value
  if (!pv || !model || !model.id.trim() || modelTest.value.phase === 'testing') return
  modelTest.value = { phase: 'testing' }
  try {
    const res = await testAgentModelApi({
      apiBase: pv.baseUrl || '',
      apiKey: pv.apiKey || '',
      model: model.id.trim(),
    })
    if (res.data?.ok) {
      modelTest.value = { phase: 'success' }
    } else {
      modelTest.value = { phase: 'error', message: res.data?.message || '连接失败' }
    }
  } catch (e: any) {
    modelTest.value = { phase: 'error', message: e?.message || '测试异常' }
  }
}

// ── Thinking level map ──

function tlmColor(lv: string): string {
  const colors: Record<string, string> = {
    off: 'var(--pcfg-text-dim)', minimal: '#6b7280', low: '#60a5fa',
    medium: '#a78bfa', high: '#f472b6', xhigh: '#fb923c', max: '#ef4444',
  }
  return colors[lv] || 'var(--pcfg-text-dim)'
}
function tlmState(lv: string): 'omit' | 'null' | 'string' {
  const map = currentModel.value?.thinkingLevelMap
  if (!map || !(lv in map)) return 'omit'
  return map[lv] === null ? 'null' : 'string'
}
function tlmValue(lv: string): string {
  const v = currentModel.value?.thinkingLevelMap?.[lv]
  return typeof v === 'string' ? v : ''
}
function setTlm(lv: string, val: string | null | 'omit') {
  const model = currentModel.value
  if (!model) return
  const next = { ...(model.thinkingLevelMap ?? {}) }
  if (val === 'omit') delete next[lv]
  else next[lv] = val
  model.thinkingLevelMap = Object.keys(next).length ? next : undefined
}

// ── Cost ──

function costVal(k: (typeof COST_KEYS)[number]): string {
  const v = currentModel.value?.cost?.[k]
  return v !== undefined ? String(v) : ''
}
function setCost(k: (typeof COST_KEYS)[number], v: string) {
  const model = currentModel.value
  if (!model) return
  const n = parseFloat(v)
  const next = { ...(model.cost ?? {}) }
  if (isNaN(n)) delete next[k]
  else next[k] = n
  model.cost = Object.keys(next).length ? next : undefined
}

// ── 保存（树 → llm_profiles 扁平数组，保留原字段）──

async function handleSave() {
  saving.value = true
  saveError.value = null
  savedOk.value = false
  try {
    const profiles: AgentProviderProfile[] = []
    for (const [name, pv] of Object.entries(config.value.providers)) {
      for (const m of pv.models) {
        if (!m.id.trim()) continue
        const orig = (m._original || {}) as AgentProviderProfile
        const origInput = (orig.capabilities?.inputModalities as string[] | undefined) ?? []
        const inputModalities = m.imageInput
          ? Array.from(new Set([...origInput.filter((x) => x !== 'image'), 'image']))
          : origInput.filter((x) => x !== 'image')
        const capabilities: Record<string, any> = {
          ...(orig.capabilities ?? {}),
          reasoning: !!m.reasoning,
          inputModalities,
        }
        if (m.contextWindow !== undefined) capabilities.contextWindowTokens = m.contextWindow
        if (m.maxTokens !== undefined) capabilities.maxOutputTokens = m.maxTokens

        const profile: Record<string, any> = {
          id: m._profileId || genId(),
          name,
          // 只支持 OpenAI 兼容格式，保留历史 provider 值（如 openai-compatible）
          provider: pv._originalProvider || orig.provider || 'openai-compatible',
          apiBase: pv.baseUrl,
          apiKey: pv.apiKey,
          model: m.id.trim(),
          isActive: orig.isActive ?? false,
          isEnabled: orig.isEnabled ?? true,
          timeout: orig.timeout ?? 60,
          usage: orig.usage,
          capabilities,
        }
        if (m.thinkingLevelMap) profile.thinkingLevelMap = m.thinkingLevelMap
        if (m.cost) profile.cost = m.cost
        profiles.push(profile as AgentProviderProfile)
      }
    }
    await saveAgentProvidersApi(profiles)
    savedOk.value = true
    setTimeout(() => {
      savedOk.value = false
      emit('close')
      emit('saved')
    }, 700)
  } catch (e: any) {
    saveError.value = e?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

onMounted(loadConfig)
</script>

<style scoped>
/* 变量映射：优先继承 Agent 主题（--bg 等），后台页面无定义时用浅色 fallback */
.pcfg-overlay,
.pcfg-inline-root {
  --pcfg-bg: var(--bg, #ffffff);
  --pcfg-bg-panel: var(--bg-panel, #f7f7f7);
  --pcfg-border: var(--border, #e5e7eb);
  --pcfg-text: var(--text, #1f2937);
  --pcfg-text-muted: var(--text-muted, #6b7280);
  --pcfg-text-dim: var(--text-dim, #6b7280);
  --pcfg-bg-hover: var(--bg-hover, #f3f4f6);
  --pcfg-bg-selected: var(--bg-selected, #eef0f2);
  --pcfg-accent: var(--accent, #2563eb);
  --pcfg-font-mono: var(--font-mono, "JetBrains Mono", "Fira Code", Consolas, monospace);
}

/* ── 外壳 ── */
.pcfg-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
}
.pcfg-inline-root {
  width: 100%;
  height: 100%;
  min-height: 480px;
}
.pcfg-dialog {
  width: 860px;
  max-width: calc(100vw - 16px);
  height: 78vh;
  max-height: calc(100dvh - 16px);
  background: var(--pcfg-bg);
  border: 1px solid var(--pcfg-border);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}
.pcfg-dialog.is-inline {
  width: 100%;
  height: 100%;
  max-height: none;
  border-radius: 10px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

/* ── Header ── */
.pcfg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  border-bottom: 1px solid var(--pcfg-border);
  flex-shrink: 0;
}
.pcfg-header-left { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.pcfg-header-title { font-size: 15px; font-weight: 700; color: var(--pcfg-text); }
.pcfg-header-path {
  font-size: 12px; color: var(--pcfg-text-muted); font-family: var(--pcfg-font-mono);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pcfg-header-close {
  background: none; border: none; color: var(--pcfg-text-muted); cursor: pointer;
  font-size: 20px; line-height: 1; padding: 2px 6px;
}
.pcfg-header-close:hover { color: var(--pcfg-text); }

/* ── Body ── */
.pcfg-body { flex: 1; display: flex; flex-direction: row; overflow: hidden; }

/* ── 左树 ── */
.pcfg-tree-col {
  width: 210px; flex-shrink: 0; border-right: 1px solid var(--pcfg-border);
  display: flex; flex-direction: column; background: var(--pcfg-bg-panel);
}
.pcfg-tree-scroll { flex: 1; overflow-y: auto; padding: 8px 6px; }
.pcfg-tree-hint { padding: 10px 8px; font-size: 12px; color: var(--pcfg-text-muted); }
.pcfg-tree-hint.dim { color: var(--pcfg-text-dim); }
.pcfg-tree-group { margin-bottom: 2px; }
.pcfg-provider-row {
  display: flex; align-items: center; gap: 6px; padding: 7px 8px; border-radius: 5px;
  cursor: pointer; color: var(--pcfg-text-dim);
}
.pcfg-provider-row:hover { background: var(--pcfg-bg-hover); }
.pcfg-provider-row.selected { background: var(--pcfg-bg-selected); }
.pcfg-provider-name {
  font-size: 12px; font-weight: 400; color: var(--pcfg-text); font-family: var(--pcfg-font-mono);
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pcfg-provider-name.selected { font-weight: 600; }
.pcfg-model-row {
  display: flex; align-items: center; gap: 6px; padding: 5px 8px 5px 26px; border-radius: 5px; cursor: pointer;
}
.pcfg-model-row:hover { background: var(--pcfg-bg-hover); }
.pcfg-model-row.selected { background: var(--pcfg-bg-selected); }
.pcfg-model-id {
  font-size: 12px; font-family: var(--pcfg-font-mono); color: var(--pcfg-text-muted);
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pcfg-model-row.selected .pcfg-model-id { color: var(--pcfg-text); }
.pcfg-badge-t {
  font-size: 9px; padding: 1px 4px; background: rgba(99, 102, 241, 0.12);
  color: rgba(99, 102, 241, 0.8); border-radius: 3px; flex-shrink: 0;
}
.pcfg-add-model {
  display: flex; align-items: center; gap: 4px; padding: 4px 8px 4px 26px; border-radius: 5px;
  cursor: pointer; color: var(--pcfg-text-dim); font-size: 12px;
}
.pcfg-add-model:hover { color: var(--pcfg-accent); background: var(--pcfg-bg-hover); }
.pcfg-tree-add { border-top: 1px solid var(--pcfg-border); padding: 8px 6px; }
.pcfg-add-provider-btn {
  display: flex; align-items: center; justify-content: center; gap: 5px; width: 100%; padding: 6px 0;
  background: none; border: 1px dashed var(--pcfg-border); border-radius: 5px;
  color: var(--pcfg-text-muted); cursor: pointer; font-size: 12px;
}
.pcfg-add-provider-btn:hover { border-color: var(--pcfg-accent); color: var(--pcfg-accent); }

/* ── 右详情 ── */
.pcfg-detail-col {
  flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; align-items: stretch;
}
.pcfg-detail-empty {
  flex: 1; display: flex; align-items: center; justify-content: center;
  color: var(--pcfg-text-dim); font-size: 13px;
}
.pcfg-detail-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.pcfg-section-title {
  font-size: 12px; font-weight: 600; color: var(--pcfg-text-dim);
  text-transform: uppercase; letter-spacing: 0.06em;
}
.pcfg-detail-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.pcfg-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.pcfg-field-label { font-size: 12px; color: var(--pcfg-text-muted); font-weight: 500; }
.pcfg-field-hint { font-size: 12px; color: var(--pcfg-text-dim); margin-top: 2px; }
.pcfg-field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.pcfg-check-row { display: flex; gap: 20px; flex-wrap: wrap; margin-top: 2px; }
.pcfg-check-label {
  display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; color: var(--pcfg-text-muted);
}
.pcfg-check-input { width: 13px; height: 13px; accent-color: var(--pcfg-accent); cursor: pointer; }

/* ── 表单控件 ── */
.pcfg-text-input {
  padding: 6px 9px; background: var(--pcfg-bg-panel); border: 1px solid var(--pcfg-border);
  border-radius: 5px; color: var(--pcfg-text); font-size: 12px; outline: none; width: 100%; box-sizing: border-box;
}
.pcfg-text-input:focus { border-color: var(--pcfg-accent); }
.pcfg-text-input.mono { font-family: var(--pcfg-font-mono); }
.pcfg-text-input::placeholder { color: var(--pcfg-text-dim); }
.pcfg-select-input { height: auto; appearance: auto; }
.pcfg-secret-wrap { position: relative; width: 100%; }
.pcfg-secret-input { padding-right: 34px; }
.pcfg-eye-btn {
  position: absolute; right: 5px; top: 50%; transform: translateY(-50%); width: 24px; height: 24px;
  padding: 0; border: none; background: transparent; color: var(--pcfg-text-dim); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.pcfg-eye-btn:hover { color: var(--pcfg-text-muted); }

/* ── 按钮 ── */
.pcfg-btn-rename {
  margin-top: 4px; padding: 3px 10px; background: var(--pcfg-accent); border: none; border-radius: 4px;
  color: #fff; cursor: pointer; font-size: 12px; align-self: flex-start;
}
.pcfg-btn-delete {
  padding: 3px 8px; background: none; border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 4px;
  color: #ef4444; cursor: pointer; font-size: 12px;
}
.pcfg-btn-test {
  height: 24px; padding: 0 8px; background: none; border: 1px solid var(--pcfg-border); border-radius: 4px;
  color: var(--pcfg-text-muted); cursor: pointer; font-size: 12px; display: inline-flex; align-items: center; gap: 5px;
  box-sizing: border-box;
}
.pcfg-btn-test.success { background: #16a34a; border-color: #16a34a; color: #fff; }
.pcfg-btn-test:disabled { color: var(--pcfg-text-dim); cursor: not-allowed; }
.pcfg-btn-discover {
  align-self: flex-start; height: 30px; padding: 0 12px; border: 1px solid var(--pcfg-border); border-radius: 5px;
  background: var(--pcfg-bg-panel); color: var(--pcfg-text-muted); cursor: pointer; font-size: 12px;
}
.pcfg-btn-discover:disabled { color: var(--pcfg-text-dim); cursor: not-allowed; }
.pcfg-btn-primary {
  padding: 6px 16px; min-width: 92px; background: var(--pcfg-accent); border: none; border-radius: 6px;
  color: #fff; font-weight: 600; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center;
  justify-content: center; gap: 6px;
}
.pcfg-btn-primary.sm { height: 28px; padding: 0 11px; min-width: 0; font-size: 12px; border-radius: 5px; }
.pcfg-btn-primary:disabled { cursor: default; opacity: 0.6; }
.pcfg-btn-clear {
  font-size: 12px; padding: 2px 7px; background: none; border: 1px solid var(--pcfg-border);
  border-radius: 4px; color: var(--pcfg-text-dim); cursor: pointer;
}
.pcfg-test-pill {
  max-width: 260px; height: 24px; padding: 0 8px; border-radius: 4px; font-size: 12px;
  display: inline-flex; align-items: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  box-sizing: border-box;
}
.pcfg-test-pill.ok { border: 1px solid #bbf7d0; background: #dcfce7; color: #111827; }
.pcfg-test-pill.err { border: 1px solid #fecaca; background: #fee2e2; color: #111827; }
.pcfg-error-text { font-size: 12px; color: #ef4444; }
.pcfg-catalog-msg { font-size: 12px; color: var(--pcfg-text-dim); }
.pcfg-catalog-msg.err { color: #ef4444; }

/* ── Discover ── */
.pcfg-discover-box { display: flex; flex-direction: column; gap: 8px; }
.pcfg-discover-list {
  max-height: 220px; overflow-y: auto; border: 1px solid var(--pcfg-border); border-radius: 6px;
  background: var(--pcfg-bg-panel);
}
.pcfg-discover-item {
  min-height: 36px; padding: 6px 9px; display: flex; align-items: center; gap: 8px; cursor: pointer;
  border-top: 1px solid var(--pcfg-border); font-size: 12px; opacity: 1;
}
.pcfg-discover-item:first-child { border-top: none; }
.pcfg-discover-item.added { opacity: 0.6; cursor: default; }
.pcfg-discover-item input { width: 13px; height: 13px; accent-color: var(--pcfg-accent); flex-shrink: 0; }
.pcfg-discover-name { color: var(--pcfg-text); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pcfg-discover-id { color: var(--pcfg-text-dim); font-size: 12px; font-family: var(--pcfg-font-mono); }

/* ── Thinking level map ── */
.pcfg-tlm-head { display: flex; align-items: center; justify-content: space-between; }
.pcfg-tlm-list { display: flex; flex-direction: column; gap: 2px; }
.pcfg-tlm-row {
  display: flex; align-items: center; gap: 8px; padding: 5px 4px; border-radius: 6px;
  border: 1px solid transparent;
}
.pcfg-tlm-level {
  display: inline-flex; align-items: center; gap: 5px; width: 68px; flex-shrink: 0;
  font-size: 12px; font-family: var(--pcfg-font-mono); color: var(--pcfg-text-muted);
}
.pcfg-tlm-level.muted { color: var(--pcfg-text-dim); text-decoration: line-through; }
.pcfg-tlm-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.pcfg-tlm-dot.dim { opacity: 0.3; }
.pcfg-tlm-btns { display: flex; border-radius: 5px; border: 1px solid var(--pcfg-border); overflow: hidden; flex-shrink: 0; }
.pcfg-tlm-btns button {
  padding: 4px 10px; font-size: 12px; border: none; cursor: pointer; font-weight: 400;
  background: var(--pcfg-bg-panel); color: var(--pcfg-text-dim); white-space: nowrap;
}
.pcfg-tlm-btns button + button { border-left: 1px solid var(--pcfg-border); }
.pcfg-tlm-btns button.active { background: var(--pcfg-accent); color: #fff; font-weight: 600; }
.pcfg-tlm-btns button.danger { background: #ef4444; color: #fff; font-weight: 600; }
.pcfg-tlm-custom {
  display: flex; border-radius: 5px; border: 1px solid var(--pcfg-border); overflow: hidden; flex-shrink: 0;
  transition: border-color 0.1s;
}
.pcfg-tlm-custom.active { border-color: var(--pcfg-accent); }
.pcfg-tlm-custom button {
  padding: 4px 10px; font-size: 12px; border: none; cursor: pointer; font-weight: 400;
  background: var(--pcfg-bg-panel); color: var(--pcfg-text-dim); border-right: 1px solid var(--pcfg-border); white-space: nowrap;
}
.pcfg-tlm-custom button.active { background: var(--pcfg-accent); color: #fff; font-weight: 600; }
.pcfg-tlm-custom input {
  width: 12ch; background: var(--pcfg-bg-panel); border: none; outline: none; color: var(--pcfg-text-dim);
  font-family: var(--pcfg-font-mono); font-size: 12px; padding: 4px 7px; box-sizing: border-box;
}
.pcfg-tlm-custom.active input { background: var(--pcfg-bg); color: var(--pcfg-text); }

/* ── Cost ── */
.pcfg-cost-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.pcfg-cost-item { display: flex; flex-direction: column; gap: 4px; }
.pcfg-cost-label { font-size: 12px; color: var(--pcfg-text-dim); }

/* ── Footer ── */
.pcfg-footer {
  display: flex; align-items: center; justify-content: flex-end; gap: 10px;
  padding: 10px 18px; border-top: 1px solid var(--pcfg-border); flex-shrink: 0;
}
.pcfg-save-error { flex: 1; font-size: 12px; color: #f87171; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pcfg-btn {
  padding: 6px 14px; background: none; border: 1px solid var(--pcfg-border); border-radius: 6px;
  color: var(--pcfg-text-muted); cursor: pointer; font-size: 13px;
}
.pcfg-btn:hover { background: var(--pcfg-bg-hover); color: var(--pcfg-text); }
.pcfg-btn.primary {
  padding: 6px 16px; min-width: 92px; background: var(--pcfg-accent); border: none; color: #fff;
  font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.pcfg-btn.primary:disabled { cursor: default; opacity: 0.7; }
.pcfg-btn.primary.saved { background: #16a34a; }
.pcfg-saved-check { flex-shrink: 0; }

@media (max-width: 768px) {
  .pcfg-tree-col { width: 150px; }
  .pcfg-field-grid, .pcfg-cost-grid { grid-template-columns: 1fr; }
}
</style>
