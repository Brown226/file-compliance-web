<template>
  <div class="engine-tab">
    <section class="config-section">
      <div v-if="!config.providerId && hasLegacyFields" class="legacy-hint">
        检测到旧配置结构，后端启动时会自动迁移为 Provider 引用。
      </div>

      <el-form :model="config" label-width="140px" label-position="left">
        <!-- Provider -->
        <el-form-item label="选择 Provider" required class="provider-field">
          <el-select
            v-model="config.providerId"
            placeholder="选择已配置的 Provider"
            clearable
            filterable
            style="width:100%"
          >
            <el-option
              v-for="p in filteredProviders"
              :key="p.id"
              :label="`[${p.name}] ${p.model || '未设置模型'}`"
              :value="p.id"
            >
              <div class="provider-option">
                <span>[{{ p.name }}] {{ p.model || '未设置模型' }}</span>
                <span v-if="p.capabilities" class="provider-cap">
                  {{ formatCapSummary(p.capabilities) }}
                </span>
              </div>
            </el-option>
          </el-select>
          <div class="form-tip">凭证与模型能力均从 Provider 配置继承，此处无需重复填写。</div>
        </el-form-item>

        <!-- 模型能力（唯一权威：Provider 配置） -->
        <div class="cap-card">
          <div class="cap-card__title">
            模型能力
            <el-tag size="small" type="info" effect="plain">以 Provider 配置为准</el-tag>
          </div>
          <div v-if="selectedProvider" class="cap-card__body">
            <div class="cap-item">
              <span class="cap-label">模型</span>
              <span>{{ selectedProvider.model || '未设置' }}</span>
            </div>
            <div class="cap-item">
              <span class="cap-label">上下文窗口</span>
              <span>{{ fmtCaps.contextWindow }}</span>
            </div>
            <div class="cap-item">
              <span class="cap-label">最大输出</span>
              <span>{{ fmtCaps.maxOutput }}</span>
            </div>
            <div class="cap-item">
              <span class="cap-label">模型类型</span>
              <span>{{ selectedProvider.capabilities?.reasoning ? '推理模型' : '普通模型' }}</span>
            </div>
          </div>
          <div v-else class="cap-card__empty">请先选择 Provider</div>
          <div class="form-tip">
            全局唯一来源：如需修改请前往「Provider 配置」编辑该模型的能力参数。
            运行时输出上限 = min(场景请求值, 最大输出, 上下文窗口 − 4096)，超限请求会被自动钳制。
          </div>
        </div>

        <!-- 生成参数分组 -->
        <div class="param-group">
          <div class="param-group__title">生成参数</div>
          <div class="param-row">
            <el-form-item label="超时时间">
              <div class="inline-number">
                <el-input-number v-model="config.timeout" :min="10" :max="300" controls-position="right" />
                <span class="unit-label">秒</span>
              </div>
            </el-form-item>

            <el-form-item label="温度">
              <div class="temp-compact">
                <el-slider v-model="config.temperature" :min="0" :max="1" :step="0.05" />
                <span class="temp-value">{{ config.temperature.toFixed(2) }}</span>
              </div>
              <div class="form-tip">0=精确，1=发散</div>
            </el-form-item>
          </div>
        </div><!-- /param-group -->
      </el-form>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getSystemConfigApi,
  saveSystemConfigApi,
  testLlmConnectionApi,
  getLlmProfilesApi,
  type LlmProfile,
  type ModelCapabilities,
} from '@/api/system'

interface ChatModelConfig {
  providerId: string
  temperature: number
  timeout: number
  enabled: boolean
}

const saveLoading = ref(false)
const testLoading = ref(false)
const connectionTestResult = ref<{ success: boolean; message?: string; latency?: number } | null>(null)
const providers = ref<LlmProfile[]>([])
const hasLegacyFields = ref(false)

const config = reactive<ChatModelConfig>({
  providerId: '',
  temperature: 0.3,
  timeout: 120,
  enabled: true,
})

const originalConfig = ref<string>('')
const normalizedConfig = computed(() => JSON.stringify(config))
const hasUnsavedChanges = computed(() => normalizedConfig.value !== originalConfig.value)
const selectedProvider = computed(() => providers.value.find((p) => p.id === config.providerId))

const filteredProviders = computed(() =>
  providers.value.filter((p) => p.isEnabled && ['chat', 'all'].includes(p.usage || 'chat'))
)

/** 模型能力展示（只读，唯一来源 = Provider 配置的 capabilities） */
const fmtCaps = computed(() => {
  const caps = selectedProvider.value?.capabilities
  return {
    contextWindow: caps?.contextWindowTokens ? formatTokens(caps.contextWindowTokens) : '未配置',
    maxOutput: caps?.maxOutputTokens ? formatTokens(caps.maxOutputTokens) : '未配置',
  }
})

const summary = computed(() => [
  { label: 'Provider', value: selectedProvider.value?.name || '未设置' },
  { label: '模型', value: selectedProvider.value?.model || '未设置' },
  { label: '最大输出', value: fmtCaps.value.maxOutput },
  { label: '超时时间', value: `${config.timeout} 秒` },
])

function formatCapSummary(caps: ModelCapabilities): string {
  const parts: string[] = []
  if (caps.inputModalities.includes('image')) parts.push('视觉')
  if (caps.supportsToolCalling) parts.push('工具')
  if (caps.contextWindowTokens >= 1000) parts.push(`${caps.contextWindowTokens / 1000}K`)
  return parts.join(' · ') || '基础'
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${+(n / 1000000).toFixed(1)}M tokens`
  if (n >= 1000) return `${Math.round(n / 1000)}K tokens`
  return `${n} tokens`
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

const handleSave = async () => {
  if (!config.providerId) {
    ElMessage.warning('请先选择 Provider')
    return
  }
  saveLoading.value = true
  try {
    const { data: testResult } = await testLlmConnectionApi({
      providerId: config.providerId,
      modelType: 'chat',
    })
    if (!testResult.success) {
      try {
        await ElMessageBox.confirm(
          `连接测试失败: ${testResult.message}\n\n是否仍然保存配置？`,
          '警告',
          { confirmButtonText: '仍然保存', cancelButtonText: '取消', type: 'warning' }
        )
      } catch {
        return
      }
    }

    await saveSystemConfigApi('llm_chat_model', config)
    originalConfig.value = JSON.stringify(config)
    ElMessage.success('配置保存成功')
  } catch (e: any) {
    const errorMsg = e.response?.data?.error || e.message || '保存失败'
    ElMessage.error(`保存失败: ${errorMsg}`)
  } finally {
    saveLoading.value = false
  }
}

async function loadProviders() {
  try {
    const res = await getLlmProfilesApi()
    const list = (res as any).data || res || []
    providers.value = Array.isArray(list) ? list : []
  } catch { /* ignore */ }
}

onMounted(async () => {
  await loadProviders()
  try {
    const { data } = await getSystemConfigApi('llm_chat_model')
    let configData: any = (data as any)?.value || data
    if (typeof configData === 'string') {
      try {
        configData = JSON.parse(configData)
      } catch (e) {
        console.error('JSON 解析失败:', e)
        return
      }
    }

    if (configData && typeof configData === 'object') {
      if (!configData.providerId && (configData.apiKey || configData.modelName)) {
        hasLegacyFields.value = true
      }
      if (configData.providerId !== undefined) config.providerId = configData.providerId
      if (configData.temperature !== undefined) config.temperature = configData.temperature
      if (configData.timeout !== undefined) config.timeout = configData.timeout
      if (configData.enabled !== undefined) config.enabled = configData.enabled
    }
    originalConfig.value = JSON.stringify(config)
  } catch (e) {
    console.error('加载配置失败', e)
  }
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

/* Provider 字段限宽，避免下拉独占整行造成宽度跳跃 */
.provider-field {
  max-width: 560px;
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

/* 模型能力卡：只读展示 Provider 配置（全局唯一权威） */
.cap-card {
  border: 1px solid var(--corp-border-light);
  border-radius: 12px;
  padding: 14px 20px;
  max-width: 720px;
}

.cap-card__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-gray-700);
  margin-bottom: 10px;
}

.cap-card__body {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 24px;
}

.cap-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.cap-label {
  color: var(--corp-text-secondary);
  flex-shrink: 0;
  min-width: 72px;
}

.cap-card__empty {
  font-size: 13px;
  color: var(--corp-text-secondary);
}

.cap-card .form-tip {
  margin-top: 10px;
  line-height: 1.5;
}

.param-group {
  background: var(--bg-surface-hover);
  border: 1px solid var(--corp-border-light);
  border-radius: 12px;
  padding: 16px 20px 4px;
}

.param-group__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-gray-700);
  margin-bottom: 4px;
}

.param-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 24px;
  margin-bottom: 12px;
}

/* 参数项：加轻微悬浮感 */
.param-group :deep(.el-form-item) {
  margin-bottom: 16px;
}

.param-group :deep(.el-form-item__label) {
  font-weight: 600;
  color: var(--color-gray-700);
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

.temp-compact {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.temp-compact :deep(.el-slider) {
  flex: 1;
}

.temp-value {
  flex-shrink: 0;
  min-width: 44px;
  text-align: right;
  font-weight: 600;
  color: var(--color-primary-600);
  font-size: 14px;
}

@media (max-width: 640px) {
  .param-row {
    grid-template-columns: 1fr;
  }

  .cap-card__body {
    grid-template-columns: 1fr;
  }

  .temp-compact {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
