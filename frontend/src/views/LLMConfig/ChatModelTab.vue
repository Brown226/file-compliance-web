<template>
  <div class="engine-tab">
    <section class="config-section">
      <div class="config-card">
        <el-form :model="chatModelConfig" label-width="120px" label-position="left">
          <el-form-item label="Provider">
            <el-select v-model="selectedProviderId" placeholder="从已配置的 Provider 导入" clearable
              @change="applyProvider" style="width:100%">
              <el-option v-for="p in providers" :key="p.id" :label="p.name" :value="p.id" />
            </el-select>
          </el-form-item>

          <el-form-item label="API 密钥" required>
            <el-input
              v-model="chatModelConfig.apiKey"
              type="password"
              placeholder="sk-..."
              show-password
              clearable
            />
          </el-form-item>

          <el-form-item label="API 基础 URL" required>
            <el-input
              v-model="chatModelConfig.apiBaseUrl"
              placeholder="https://api.openai.com/v1"
              clearable
            />
            <div class="form-tip">OpenAI 兼容接口地址，例如：硅基流动、火山引擎、本地 VLLM/Ollama 等。</div>
          </el-form-item>

          <el-form-item label="模型名称" required>
            <div style="display:flex;gap:8px;width:100%">
              <el-select
                v-model="chatModelConfig.modelName"
                placeholder="输入模型名称"
                filterable
                allow-create
                default-first-option
                style="flex:1"
              >
                <el-option
                  v-for="model in availableModels"
                  :key="model"
                  :label="model"
                  :value="model"
                />
              </el-select>
              <el-button @click="fetchModelsFromProvider" :loading="fetchingModels">获取模型</el-button>
            </div>
            <div class="form-tip">支持自定义模型名称，或点击“获取模型”自动拉取。</div>
          </el-form-item>

          <div class="param-row">
            <el-form-item label="最大输出 Tokens">
              <el-input-number
                v-model="chatModelConfig.maxTokens"
                :min="1"
                :max="100000"
                controls-position="right"
              />
              <div class="form-tip">模型单次请求的回复长度上限。</div>
            </el-form-item>

            <el-form-item label="上下文窗口">
              <div class="inline-number">
                <el-input-number
                  v-model="chatModelConfig.contextLength"
                  :min="4096"
                  :max="1048576"
                  :step="4096"
                  controls-position="right"
                />
                <span class="unit-label">字符</span>
              </div>
              <div class="form-tip">模型的上下文窗口大小。128K 模型填 200000，32K 模型填 50000。查看模型文档获取准确值。</div>
            </el-form-item>

            <el-form-item label="超时时间">
              <div class="inline-number">
                <el-input-number
                  v-model="chatModelConfig.timeout"
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
                v-model="chatModelConfig.temperature"
                :min="0"
                :max="1"
                :step="0.05"
                :marks="tempMarks"
              />
              <div class="temp-labels">
                <span>精确</span>
                <span class="temp-value">{{ chatModelConfig.temperature.toFixed(2) }}</span>
                <span>发散</span>
              </div>
            </div>
          </el-form-item>
        </el-form>
      </div>

      <div class="action-bar">
        <el-button @click="handleTestConnection" :loading="testLoading" class="test-btn">
          <el-icon><Connection /></el-icon>
          测试连接
        </el-button>
        <el-button type="primary" :loading="saveLoading" @click="handleSaveChatConfig">
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
import { computed, reactive, ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Check, Connection, CircleCheckFilled, CircleCloseFilled } from '@element-plus/icons-vue'
import {
  getSystemConfigApi,
  saveSystemConfigApi,
  testLlmConnectionApi,
  getLlmProfilesApi,
  fetchProviderModelsApi,
  type LlmProfile,
} from '@/api/system'

interface ChatModelConfig {
  serviceType: string
  apiKey: string
  apiBaseUrl: string
  modelName: string
  maxTokens: number
  contextLength: number
  temperature: number
  timeout: number
  enabled: boolean
}

const saveLoading = ref(false)
const testLoading = ref(false)
const connectionTestResult = ref<{ success: boolean; message?: string; latency?: number } | null>(null)

const commonModels: string[] = []
const availableModels = ref<string[]>([])
const providers = ref<LlmProfile[]>([])
const selectedProviderId = ref('')
const fetchingModels = ref(false)

const tempMarks = {
  0: '0',
  0.5: '0.5',
  1: '1',
}

const chatModelConfig = reactive<ChatModelConfig>({
  serviceType: 'custom',
  apiKey: '',
  apiBaseUrl: 'https://api.siliconflow.cn/v1',
  modelName: 'Qwen/Qwen2.5t',
  maxTokens: 8192,
  contextLength: 131072,
  temperature: 0.3,
  timeout: 120,
  enabled: true,
})

const originalConfig = ref<string>('')

const normalizedConfig = computed(() => JSON.stringify(chatModelConfig))
const hasUnsavedChanges = computed(() => normalizedConfig.value !== originalConfig.value)
const summary = computed(() => [
  { label: '模型名称', value: chatModelConfig.modelName || '未设置' },
  { label: '接口地址', value: chatModelConfig.apiBaseUrl || '未设置' },
  { label: '最大 Tokens', value: String(chatModelConfig.maxTokens) },
  { label: '超时时间', value: `${chatModelConfig.timeout} 秒` },
])

const handleTestConnection = async () => {
  if (!chatModelConfig.apiKey) {
    ElMessage.warning('请先输入 API 密钥')
    return
  }
  testLoading.value = true
  connectionTestResult.value = null
  const startTime = Date.now()
  try {
    const { data: testResult } = await testLlmConnectionApi({
      serviceType: chatModelConfig.serviceType,
      apiKey: chatModelConfig.apiKey,
      apiBaseUrl: chatModelConfig.apiBaseUrl,
      modelName: chatModelConfig.modelName,
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
      message: e.message || '请检查配置参数',
    }
    ElMessage.error(`连接失败: ${e.message || '请检查配置参数'}`)
  } finally {
    testLoading.value = false
  }
}

const handleSaveChatConfig = async () => {
  if (!chatModelConfig.apiKey || !chatModelConfig.apiBaseUrl || !chatModelConfig.modelName) {
    ElMessage.warning('请填写完整的配置信息')
    return
  }
  saveLoading.value = true
  try {
    const { data: testResult } = await testLlmConnectionApi({
      serviceType: chatModelConfig.serviceType,
      apiKey: chatModelConfig.apiKey,
      apiBaseUrl: chatModelConfig.apiBaseUrl,
      modelName: chatModelConfig.modelName,
      modelType: 'chat',
    })

    if (!testResult.success) {
      try {
        await ElMessageBox.confirm(
          `连接测试失败: ${testResult.message}\n\n是否仍然保存配置？`,
          '警告',
          {
            confirmButtonText: '仍然保存',
            cancelButtonText: '取消',
            type: 'warning',
          }
        )
      } catch {
        return
      }
    }

    await saveSystemConfigApi('llm_chat_model', chatModelConfig)
    originalConfig.value = JSON.stringify(chatModelConfig)
    ElMessage.success('配置保存成功')
  } catch (e: any) {
    const errorMsg = e.response?.data?.error || e.message || '保存失败'
    ElMessage.error(`保存失败: ${errorMsg}`)
  } finally {
    saveLoading.value = false
  }
}

// === Provider 导入与模型拉取 ===
async function loadProviders() {
  try {
    const res = await getLlmProfilesApi()
    const list = (res as any).data || res || []
    providers.value = Array.isArray(list) ? list.filter((p: any) => p.isEnabled) : []
  } catch { /* ignore */ }
}

function applyProvider(providerId: string) {
  if (!providerId) return
  const p = providers.value.find((item: any) => item.id === providerId)
  if (!p) return
  chatModelConfig.apiBaseUrl = p.apiBase || ''
  if (p.apiKey && !p.apiKey.includes('****')) {
    chatModelConfig.apiKey = p.apiKey
  }
  if (p.model) {
    chatModelConfig.modelName = p.model
  }
  // 自动拉取该 Provider 的模型列表
  fetchModelsFromProvider()
  ElMessage.success(`已导入 Provider「${p.name}」的配置`)
}

async function fetchModelsFromProvider() {
  if (!chatModelConfig.apiBaseUrl) {
    ElMessage.warning('请先填写 API 基础 URL')
    return
  }
  fetchingModels.value = true
  try {
    const res = await fetchProviderModelsApi({ apiBase: chatModelConfig.apiBaseUrl, apiKey: chatModelConfig.apiKey })
    const data = (res as any).data || res
    if (data.success && Array.isArray(data.data)) {
      availableModels.value = data.data
      ElMessage.success(`获取到 ${data.data.length} 个模型`)
    } else {
      ElMessage.error(data.message || '获取模型失败')
    }
  } catch (e: any) {
    ElMessage.error(e.message || '获取模型失败')
  } finally {
    fetchingModels.value = false
  }
}

onMounted(async () => {
  loadProviders()
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

    if (configData && typeof configData === 'object' && Object.keys(configData).length > 0) {
      Object.keys(chatModelConfig).forEach(key => {
        if (key in configData && configData[key] !== undefined && configData[key] !== null) {
          ;(chatModelConfig as any)[key] = configData[key]
        }
      })
    }
    originalConfig.value = JSON.stringify(chatModelConfig)
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
  gap: 18px;
}

.config-section {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.config-card {
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 20px;
}

.param-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
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
  font-weight: 700;
  color: #2563eb;
}

.action-bar {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
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
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
}

.test-success {
  background: #f0fdf4;
  border: 1px solid #86efac;
  color: #166534;
}

.test-fail {
  background: #fef2f2;
  border: 1px solid #fca5a5;
  color: #991b1b;
}

.result-detail {
  font-weight: 400;
  font-size: 13px;
  opacity: 0.85;
}

.result-latency {
  margin-left: auto;
  font-size: 12px;
  padding: 2px 8px;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 999px;
}

@media (max-width: 760px) {
  .param-row {
    grid-template-columns: 1fr;
  }
}
</style>
