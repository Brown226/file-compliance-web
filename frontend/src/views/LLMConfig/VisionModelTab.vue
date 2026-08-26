<template>
  <div class="engine-tab">
    <section class="config-section">
      <div v-if="!config.providerId && hasLegacyFields" class="legacy-hint">
        检测到旧配置结构，后端启动时会自动迁移为 Provider 引用。
      </div>

      <div v-if="visionProviders.length === 0 && providers.length > 0" class="legacy-hint">
        没有检测到支持视觉的 Provider。请在 Provider 配置中为模型勾选「image」输入模态（或将用途设为「视觉」/「通用」）。
      </div>

      <el-form :model="config" label-width="140px" label-position="left">
        <el-form-item label="选择 Provider" required class="provider-field">
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

        <div class="param-group">
          <div class="param-group__title">视觉识别参数</div>
          <div class="param-row">
            <el-form-item label="超时时间">
              <div class="inline-number">
                <el-input-number v-model="config.timeout" :min="30" :max="300" controls-position="right" />
                <span class="unit-label">秒</span>
              </div>
              <div class="form-tip">建议 120 秒以上</div>
            </el-form-item>

            <el-form-item label="模型类型">
              <el-radio-group v-model="config.modelType" @change="handleModelTypeChange">
                <el-radio-button value="instruct">指令型</el-radio-button>
                <el-radio-button value="thinking">推理型</el-radio-button>
              </el-radio-group>
            </el-form-item>

            <el-form-item label="最大输出 Tokens">
              <el-input-number
                v-model="config.maxTokens"
                :min="1"
                :step="256"
                controls-position="right"
                @change="() => (manuallyEdited.maxTokens = true)"
              />
              <div class="form-tip">指令型默认 4096，推理型默认 16384</div>
            </el-form-item>
          </div>
        </div>
      </el-form>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
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

const manuallyEdited = reactive({
  maxTokens: false,
  temperature: false,
})

const originalConfig = ref('')

const visionProviders = computed(() =>
  providers.value.filter((p) =>
    // 明确标记为视觉用途（vision/all），或能力声明支持 image 输入（即使 usage 默认 chat 也可作视觉模型）
    ['vision', 'all'].includes(p.usage || '') ||
    p.capabilities?.inputModalities?.includes('image')
  )
)

const normalizedConfig = computed(() => JSON.stringify(config))
const hasUnsavedChanges = computed(() => normalizedConfig.value !== originalConfig.value)
const selectedProvider = computed(() => providers.value.find((p) => p.id === config.providerId))

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
      modelType: 'chat',
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
  return connectionTestResult.value
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
    let v: any = (data as any)?.value || data
    if (typeof v === 'string') v = JSON.parse(v)
    if (v && typeof v === 'object') {
      if (!v.providerId && (v.apiKey || v.modelName)) {
        hasLegacyFields.value = true
      }
      if (v.providerId !== undefined) config.providerId = v.providerId
      if (v.timeout !== undefined) config.timeout = v.timeout
      if (v.modelType === 'instruct' || v.modelType === 'thinking') {
        config.modelType = v.modelType
      }
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
  handleSave,
  handleTest,
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
  color: var(--color-warning-text);
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-bg);
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
  color: var(--corp-text-tertiary);
  flex-shrink: 0;
}

/* Provider 字段限宽（与对话模型统一） */
.provider-field {
  max-width: 560px;
}

/* 参数分组：与对话模型统一 */
.param-group {
  background: var(--bg-surface-hover);
  border: 1px solid var(--corp-border-light);
  border-radius: 12px;
  padding: 16px 20px 0;
}

.param-group__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-gray-700);
  margin-bottom: 4px;
}

.param-group :deep(.el-form-item__label) {
  font-weight: 600;
  color: var(--color-gray-700);
}

.param-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 24px;
  margin-bottom: 12px;
}

.inline-number {
  display: flex;
  align-items: center;
  gap: 8px;
}

.unit-label,
.form-tip {
  font-size: 12px;
  color: var(--corp-text-secondary);
}

.form-tip {
  margin-top: 4px;
  line-height: 1.5;
}

@media (max-width: 640px) {
  .param-row {
    grid-template-columns: 1fr;
  }
}
</style>
