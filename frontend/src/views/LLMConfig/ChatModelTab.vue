<template>
  <div class="engine-tab">
    <section class="config-section">
      <div v-if="!config.providerId && hasLegacyFields" class="legacy-hint">
        检测到旧配置结构，后端启动时会自动迁移为 Provider 引用。若仍未迁移，请重启后端服务。
      </div>

      <el-form :model="config" label-width="110px" label-position="left">
        <el-form-item label="选择 Provider" required>
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
          <div class="form-tip">
            选择 Provider 后，凭证（API Key / Base URL / 模型名）自动从 Provider 配置继承。
          </div>
        </el-form-item>

        <div class="param-row">
          <el-form-item label="最大输出 Tokens">
            <el-input-number
              v-model="config.maxTokens"
              :min="1"
              :max="100000"
              controls-position="right"
              @input="userTouchedMaxTokens = true"
            />
            <div class="form-tip">
              单次回复长度上限
              <span v-if="capDefaults.maxOutputTokens > 0" class="cap-hint">
                · 模型库默认 {{ capDefaults.maxOutputTokens }}
              </span>
            </div>
          </el-form-item>

          <el-form-item label="上下文窗口">
            <div class="inline-number">
              <el-input-number
                v-model="config.contextLength"
                :min="4096"
                :max="1048576"
                :step="4096"
                controls-position="right"
                @input="userTouchedContextLength = true"
              />
              <span class="unit-label">字符</span>
            </div>
            <div class="form-tip">
              <span v-if="capDefaults.contextWindowTokens > 0">
                模型库 {{ (capDefaults.contextWindowTokens / 1000).toFixed(0) }}K tokens（已按 1.5 倍换算为字符）
              </span>
              <span v-else>128K 模型填 200000</span>
            </div>
          </el-form-item>

          <el-form-item label="超时时间">
            <div class="inline-number">
              <el-input-number
                v-model="config.timeout"
                :min="10"
                :max="300"
                controls-position="right"
              />
              <span class="unit-label">秒</span>
            </div>
          </el-form-item>
        </div>

        <el-form-item label="温度值">
          <div class="slider-wrapper">
            <el-slider
              v-model="config.temperature"
              :min="0"
              :max="1"
              :step="0.05"
              :marks="tempMarks"
            />
            <div class="temp-labels">
              <span>精确</span>
              <span class="temp-value">{{ config.temperature.toFixed(2) }}</span>
              <span>发散</span>
            </div>
          </div>
        </el-form-item>
      </el-form>

      <div class="action-bar">
        <el-button @click="handleTestConnection" :loading="testLoading" class="test-btn">
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
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Check, Connection, CircleCheckFilled, CircleCloseFilled } from '@element-plus/icons-vue'
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
// 用户是否手动调整过这两个字段（防止自动填充覆盖用户输入）
const userTouchedMaxTokens = ref(false)
const userTouchedContextLength = ref(false)
// 加载已完成（避免初始回填被误判为用户修改）
const configLoaded = ref(false)

const tempMarks = { 0: '0', 0.5: '0.5', 1: '1' }

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

// 模型能力库提供的默认值（用于 UI 提示与自动填充）
const capDefaults = computed(() => {
  const caps = selectedProvider.value?.capabilities
  return {
    contextWindowTokens: caps?.contextWindowTokens ?? 0,
    maxOutputTokens: caps?.maxOutputTokens ?? 0,
  }
})

// 选择 Provider 或切换 Provider 时，自动填充能力库默认值
// 仅在用户未手动调整过该字段时填充，避免覆盖用户输入
watch(
  () => config.providerId,
  () => {
    if (!configLoaded.value) return
    const caps = capDefaults.value
    // 最大输出 Tokens
    if (!userTouchedMaxTokens.value && caps.maxOutputTokens > 0) {
      config.maxTokens = caps.maxOutputTokens
    }
    // 上下文窗口（模型库单位为 tokens，配置字段单位为字符，按 1.5 倍换算）
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

const handleTestConnection = async () => {
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
}

const handleSave = async () => {
  if (!config.providerId) {
    ElMessage.warning('请先选择 Provider')
    return
  }
  saveLoading.value = true
  try {
    // 先测试，失败时给用户确认机会
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
    let configData = data?.value || data
    if (typeof configData === 'string') {
      try {
        configData = JSON.parse(configData)
      } catch (e) {
        console.error('JSON 解析失败:', e)
        return
      }
    }

    if (configData && typeof configData === 'object') {
      // 检测旧结构（无 providerId 但有 apiKey/modelName）
      if (!configData.providerId && (configData.apiKey || configData.modelName)) {
        hasLegacyFields.value = true
      }
      // 仅加载新结构字段，忽略旧凭证字段
      if (configData.providerId !== undefined) config.providerId = configData.providerId
      if (configData.temperature !== undefined) config.temperature = configData.temperature
      if (configData.maxTokens !== undefined) config.maxTokens = configData.maxTokens
      if (configData.contextLength !== undefined) config.contextLength = configData.contextLength
      if (configData.timeout !== undefined) config.timeout = configData.timeout
      if (configData.enabled !== undefined) config.enabled = configData.enabled

      // 已加载配置视为用户已调整：不触发自动覆盖
      if (configData.maxTokens !== undefined) userTouchedMaxTokens.value = true
      if (configData.contextLength !== undefined) userTouchedContextLength.value = true
    }
    originalConfig.value = JSON.stringify(config)
    configLoaded.value = true
    // 首次加载若该 Provider 无已保存值，主动触发一次填充
    if (config.providerId && capDefaults.value) {
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

.param-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
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

.cap-hint {
  color: #2563eb;
  font-weight: 500;
  margin-left: 2px;
}

.slider-wrapper {
  width: 100%;
  padding-right: 16px;
}

.temp-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 12px;
  color: #64748b;
}

.temp-value {
  font-weight: 600;
  color: #2563eb;
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

@media (max-width: 900px) {
  .param-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .param-row {
    grid-template-columns: 1fr;
  }
}
</style>
