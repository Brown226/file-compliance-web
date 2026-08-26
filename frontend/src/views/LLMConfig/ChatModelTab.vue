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
          <div class="form-tip">凭证从 Provider 配置继承。切换 Provider 时会自动探测模型能力。</div>
        </el-form-item>

        <!-- 探测状态 -->
        <div v-if="probedCaps?.probed" class="cap-status success">
          <el-icon><CircleCheckFilled /></el-icon>
          <span>
            已探测：最大输出 {{ formatTokens(probedCaps.maxOutput) }} · 上下文窗口 {{ formatTokens(probedCaps.contextWindow) }}
            <el-tag v-if="probedCaps.reasoning" size="small" type="warning" effect="plain" class="reasoning-tag">推理模型</el-tag>
          </span>
        </div>
        <div v-else-if="probeDone && config.providerId" class="cap-status warning">
          <el-icon><CircleCloseFilled /></el-icon>
          <span>未探测到能力元数据，已启用下方手动参数</span>
        </div>

        <!-- 生成参数分组 -->
        <div class="param-group">
          <div class="param-group__title">生成参数</div>
          <div class="param-row">
          <el-form-item label="最大输出 Tokens">
            <div class="inline-number">
              <el-input-number
                v-model="config.maxTokens"
                :min="1"
                :max="1000000"
                controls-position="right"
                :disabled="probedCaps?.probed"
                @input="userTouchedMaxTokens = true"
              />
              <span class="unit-label">tokens</span>
            </div>
            <div v-if="capDefaults.maxOutputTokens > 0" class="form-tip">
              模型库默认 {{ capDefaults.maxOutputTokens }} tokens
            </div>
          </el-form-item>

          <el-form-item label="上下文窗口">
            <div class="inline-number">
              <el-input-number
                v-model="config.contextLength"
                :min="4096"
                :max="2097152"
                :step="4096"
                controls-position="right"
                :disabled="probedCaps?.probed"
                @input="userTouchedContextLength = true"
              />
              <span class="unit-label">字符</span>
            </div>
            <div v-if="capDefaults.contextWindowTokens > 0" class="form-tip">
              模型库 {{ (capDefaults.contextWindowTokens / 1000).toFixed(0) }}K tokens
            </div>
          </el-form-item>

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
import { computed, reactive, ref, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CircleCheckFilled, CircleCloseFilled } from '@element-plus/icons-vue'
import {
  getSystemConfigApi,
  saveSystemConfigApi,
  testLlmConnectionApi,
  getLlmProfilesApi,
  probeModelCapsApi,
  type LlmProfile,
  type ModelCapabilities,
  type ProbedModelCaps,
} from '@/api/system'

interface ChatModelConfig {
  providerId: string
  temperature: number
  maxTokens: number
  contextLength: number
  timeout: number
  enabled: boolean
}

const saveLoading = ref(false)
const testLoading = ref(false)
const connectionTestResult = ref<{ success: boolean; message?: string; latency?: number } | null>(null)
const providers = ref<LlmProfile[]>([])
const hasLegacyFields = ref(false)
const userTouchedMaxTokens = ref(false)
const userTouchedContextLength = ref(false)
const configLoaded = ref(false)
const probedCaps = ref<ProbedModelCaps | null>(null)
const probeDone = ref(false)

const config = reactive<ChatModelConfig>({
  providerId: '',
  temperature: 0.3,
  maxTokens: 8192,
  contextLength: 131072,
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

const capDefaults = computed(() => {
  const caps = selectedProvider.value?.capabilities
  return {
    contextWindowTokens: caps?.contextWindowTokens ?? 0,
    maxOutputTokens: caps?.maxOutputTokens ?? 0,
  }
})

watch(
  () => config.providerId,
  () => {
    if (!configLoaded.value) return
    const caps = capDefaults.value
    if (!userTouchedMaxTokens.value && caps.maxOutputTokens > 0) {
      config.maxTokens = caps.maxOutputTokens
    }
    if (!userTouchedContextLength.value && caps.contextWindowTokens > 0) {
      config.contextLength = Math.round(caps.contextWindowTokens * 1.5)
    }
  }
)

const summary = computed(() => [
  { label: 'Provider', value: selectedProvider.value?.name || '未设置' },
  { label: '模型', value: selectedProvider.value?.model || '未设置' },
  { label: '最大 Tokens', value: String(config.maxTokens) },
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
  if (n >= 1000) return `${Math.round(n / 1000)}K tokens`
  return `${n} tokens`
}

async function probeCaps() {
  probedCaps.value = null
  probeDone.value = false
  if (!config.providerId) return
  try {
    const { data } = await probeModelCapsApi(config.providerId)
    probedCaps.value = data
    if (data?.probed) {
      if (data.maxOutput > 0) config.maxTokens = data.maxOutput
      if (data.contextWindow > 0) config.contextLength = Math.round(data.contextWindow * 1.5)
    }
  } catch {
    probedCaps.value = null
  } finally {
    probeDone.value = true
  }
}

watch(
  () => config.providerId,
  () => {
    if (configLoaded.value) probeCaps()
  }
)

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
      if (configData.maxTokens !== undefined) config.maxTokens = configData.maxTokens
      if (configData.contextLength !== undefined) config.contextLength = configData.contextLength
      if (configData.timeout !== undefined) config.timeout = configData.timeout
      if (configData.enabled !== undefined) config.enabled = configData.enabled

      if (configData.maxTokens !== undefined) userTouchedMaxTokens.value = true
      if (configData.contextLength !== undefined) userTouchedContextLength.value = true
    }
    originalConfig.value = JSON.stringify(config)
    configLoaded.value = true
    await probeCaps()
    if (!probedCaps.value?.probed && config.providerId && capDefaults.value) {
      const caps = capDefaults.value
      if (!userTouchedMaxTokens.value && caps.maxOutputTokens > 0) {
        config.maxTokens = caps.maxOutputTokens
      }
      if (!userTouchedContextLength.value && caps.contextWindowTokens > 0) {
        config.contextLength = Math.round(caps.contextWindowTokens * 1.5)
      }
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

.cap-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  margin-bottom: 2px;
  font-size: 13px;
  border-radius: 6px;
  line-height: 1.5;
  width: fit-content;
}

.cap-status.success {
  color: var(--color-success-text);
  background: var(--color-success-bg);
  border: 1px solid var(--color-success-bg);
}

.cap-status.warning {
  color: var(--color-warning-text);
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-bg);
}

.reasoning-tag {
  margin-left: 6px;
}

/* 生成参数分组：浅色底容器 + 分组标题 */
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

  .temp-compact {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
