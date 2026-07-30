<template>
  <div class="engine-tab">
    <section class="config-section">
      <div v-if="!config.providerId && hasLegacyFields" class="legacy-hint">
        检测到旧配置结构，后端启动时会自动迁移为 Provider 引用。若仍未迁移，请重启后端服务。
      </div>

      <div v-if="visionProviders.length === 0 && providers.length > 0" class="legacy-hint">
        没有符合视觉用途的 Provider。请先在 Provider 配置中将用途设为「视觉」或「通用」，并勾选 image 模态（如 Qwen-VL、GLM-4V、GPT-4o）。
      </div>

      <el-form :model="config" label-width="110px" label-position="left">
        <el-form-item label="Provider" required>
          <el-select
            v-model="config.providerId"
            placeholder="选择支持视觉的 Provider"
            clearable
            filterable
            style="width:100%"
          >
            <el-option
              v-for="p in visionProviders"
              :key="p.id"
              :label="`[${p.name}] ${p.model || '未设置模型'}`"
              :value="p.id"
            >
              <div class="provider-option">
                <span>[{{ p.name }}] {{ p.model || '未设置模型' }}</span>
                <span class="provider-cap">视觉</span>
              </div>
            </el-option>
          </el-select>
          <div class="form-tip">仅展示能力库标记为「图片（视觉）」的 Provider。</div>
        </el-form-item>

        <el-form-item label="超时时间">
          <div class="inline-number">
            <el-input-number v-model="config.timeout" :min="30" :max="300" controls-position="right" />
            <span class="unit-label">秒</span>
          </div>
          <div class="form-tip">视觉识别耗时较长，建议 120 秒以上。</div>
        </el-form-item>

        <el-form-item label="模型类型">
          <el-radio-group v-model="config.modelType" @change="handleModelTypeChange">
            <el-radio-button value="instruct">Instruct（指令型）</el-radio-button>
            <el-radio-button value="thinking">Thinking（推理型）</el-radio-button>
          </el-radio-group>
          <div class="form-tip">指令型适合常规识别；推理型适合复杂图纸或需要逐步推理的场景。切换时若未手动改过下方的 Tokens / Temperature，将自动填入对应默认值。</div>
        </el-form-item>

        <el-form-item label="最大输出 Tokens">
          <el-input-number
            v-model="config.maxTokens"
            :min="1"
            :step="256"
            controls-position="right"
            @change="() => (manuallyEdited.maxTokens = true)"
          />
          <div class="form-tip">模型单次回复的最大 token 数。指令型默认 4096，推理型默认 16384。</div>
        </el-form-item>

        <el-form-item label="Temperature">
          <el-input-number
            v-model="config.temperature"
            :min="0"
            :max="2"
            :step="0.1"
            :precision="1"
            controls-position="right"
            @change="() => (manuallyEdited.temperature = true)"
          />
          <div class="form-tip">取值 0-2。越低越确定，越高越发散。视觉识别建议使用低温度。</div>
        </el-form-item>

        <el-form-item label="随机种子">
          <el-input-number
            v-model="config.seed"
            :min="0"
            :value-on-clear="null"
            controls-position="right"
            placeholder="留空表示不设置"
          />
          <div class="form-tip">固定种子可复现结果。留空表示不设置（每次随机）。</div>
        </el-form-item>
      </el-form>

      <div class="action-bar">
        <el-button @click="handleTest" :loading="testLoading" class="test-btn">
          <el-icon><Connection /></el-icon>
          测试连接
        </el-button>
        <el-button type="primary" :loading="saveLoading" @click="handleSave">
          <el-icon><Check /></el-icon>
          保存配置
        </el-button>
      </div>

      <div v-if="connectionTestResult" class="test-result" :class="connectionTestResult.success ? 'test-success' : 'test-fail'">
        <el-icon><component :is="connectionTestResult.success ? CircleCheckFilled : CircleCloseFilled" /></el-icon>
        <span>{{ connectionTestResult.success ? '连接成功' : '连接失败' }}</span>
        <span v-if="connectionTestResult.message" class="result-detail">{{ connectionTestResult.message }}</span>
        <span v-if="connectionTestResult.latency !== undefined" class="result-latency">延迟: {{ connectionTestResult.latency }}ms</span>
      </div>

      <!-- Task 30.2: DWG 维度模型路由（高级配置，默认折叠） -->
      <DwgVisionRoutePanel ref="routePanelRef" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Check, Connection, CircleCheckFilled, CircleCloseFilled } from '@element-plus/icons-vue'
import { getSystemConfigApi, saveSystemConfigApi, testLlmConnectionApi, getLlmProfilesApi, type LlmProfile } from '@/api/system'

interface VisionModelConfig {
  providerId: string
  timeout: number
  modelType: 'instruct' | 'thinking'
  maxTokens: number
  temperature: number
  seed: number | null
}

type VisionModelType = 'instruct' | 'thinking'

const MODEL_DEFAULTS: Record<VisionModelType, { maxTokens: number; temperature: number }> = {
  instruct: { maxTokens: 4096, temperature: 0.1 },
  thinking: { maxTokens: 16384, temperature: 0.6 },
}

const saveLoading = ref(false)
const testLoading = ref(false)
const connectionTestResult = ref<{ success: boolean; message?: string; latency?: number } | null>(null)
const providers = ref<LlmProfile[]>([])
const hasLegacyFields = ref(false)

const config = reactive<VisionModelConfig>({
  providerId: '',
  timeout: 180,
  modelType: 'instruct',
  maxTokens: MODEL_DEFAULTS.instruct.maxTokens,
  temperature: MODEL_DEFAULTS.instruct.temperature,
  seed: null,
})

// 跟踪用户是否手动改过对应字段；未手动改过时切换 modelType 自动填默认值
const manuallyEdited = reactive({
  maxTokens: false,
  temperature: false,
})

const originalConfig = ref('')

// 视觉 Tab：只展示用途为 vision/all 且支持 image 输入的 Provider
const visionProviders = computed(() =>
  providers.value.filter(
    (p) =>
      ['vision', 'all'].includes(p.usage || 'chat') &&
      p.capabilities?.inputModalities?.includes('image')
  )
)

const normalizedConfig = computed(() => JSON.stringify(config))
const hasUnsavedChanges = computed(() => normalizedConfig.value !== originalConfig.value)
const selectedProvider = computed(() => providers.value.find((p) => p.id === config.providerId))

// 切换模型类型：仅在用户未手动改过 maxTokens / temperature 时自动填充对应默认值
function handleModelTypeChange(value: VisionModelType) {
  const defaults = MODEL_DEFAULTS[value]
  if (!manuallyEdited.maxTokens) {
    config.maxTokens = defaults.maxTokens
  }
  if (!manuallyEdited.temperature) {
    config.temperature = defaults.temperature
  }
}

const summary = computed(() => [
  { label: 'Provider', value: selectedProvider.value?.name || '未设置' },
  { label: '视觉模型', value: selectedProvider.value?.model || '未配置' },
  { label: '超时', value: `${config.timeout} 秒` },
])

const handleSave = async () => {
  if (!config.providerId) {
    ElMessage.warning('请先选择 Provider')
    return
  }
  saveLoading.value = true
  try {
    await saveSystemConfigApi('llm_vision_model', config)
    originalConfig.value = JSON.stringify(config)
    ElMessage.success('已保存')
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || e.message || '保存失败')
  } finally {
    saveLoading.value = false
  }
}

const handleTest = async () => {
  if (!config.providerId) {
    ElMessage.warning('请先选择 Provider')
    return
  }
  testLoading.value = true
  connectionTestResult.value = null
  const startTime = Date.now()
  try {
    const { data: testResult } = await testLlmConnectionApi({
      providerId: config.providerId,
      modelType: 'chat', // 视觉模型走 chat/completions 端点
    })
    const latency = Date.now() - startTime
    connectionTestResult.value = {
      success: testResult.success,
      message: testResult.message,
      latency,
    }
    if (testResult.success) {
      ElMessage.success('连接测试通过')
    } else {
      ElMessage.error(`连接失败: ${testResult.message}`)
    }
  } catch (e: any) {
    connectionTestResult.value = {
      success: false,
      message: e.message || '请检查 Provider 配置',
    }
    ElMessage.error(`连接失败: ${e.message || '请检查 Provider 配置'}`)
  } finally {
    testLoading.value = false
  }
}

async function loadProviders() {
  try {
    const res = await getLlmProfilesApi()
    const list = (res as any).data || res || []
    providers.value = Array.isArray(list) ? list.filter((p: any) => p.isEnabled) : []
  } catch { /* ignore */ }
}

onMounted(async () => {
  await loadProviders()
  try {
    const { data } = await getSystemConfigApi('llm_vision_model')
    let v = data?.value || data
    if (typeof v === 'string') v = JSON.parse(v)
    if (v && typeof v === 'object') {
      // 检测旧结构
      if (!v.providerId && (v.apiKey || v.modelName)) {
        hasLegacyFields.value = true
      }
      if (v.providerId !== undefined) config.providerId = v.providerId
      if (v.timeout !== undefined) config.timeout = v.timeout
      // 兼容旧配置：无 modelType 时默认 instruct + 默认值（已在初始化时设置）
      if (v.modelType === 'instruct' || v.modelType === 'thinking') {
        config.modelType = v.modelType
      }
      // 已存在的显式值视为用户已编辑，切换 modelType 时不再覆盖
      if (typeof v.maxTokens === 'number') {
        config.maxTokens = v.maxTokens
        manuallyEdited.maxTokens = true
      }
      if (typeof v.temperature === 'number') {
        config.temperature = v.temperature
        manuallyEdited.temperature = true
      }
      if (typeof v.seed === 'number') {
        config.seed = v.seed
      }
    }
    originalConfig.value = JSON.stringify(config)
  } catch { /* ignore */ }
})

defineExpose({
  get hasUnsavedChanges() {
    return hasUnsavedChanges.value
  },
  get summary() {
    return summary.value
  },
})
</script>

<style scoped>
.engine-tab {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.config-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.legacy-hint {
  font-size: 12px;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 6px;
  padding: 8px 12px;
  line-height: 1.5;
}

.provider-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.provider-cap {
  font-size: 12px;
  color: #94a3b8;
  flex-shrink: 0;
}

.inline-number {
  display: flex;
  align-items: center;
  gap: 8px;
}

.unit-label,
.form-tip {
  font-size: 12px;
  color: #64748b;
}

.form-tip {
  margin-top: 4px;
  line-height: 1.5;
}

.action-bar {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 4px;
}

.test-btn {
  border-color: #2563eb;
  color: #2563eb;
}

.test-btn:hover {
  background: #eff6ff;
}

.test-result {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
}

.test-success {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #15803d;
}

.test-fail {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
}

.result-detail {
  font-weight: 400;
  font-size: 12px;
  opacity: 0.9;
}

.result-latency {
  margin-left: auto;
  font-size: 12px;
  padding: 2px 8px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 999px;
}
</style>
