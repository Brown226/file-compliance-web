<template>
  <div class="engine-tab">
    <section class="config-section">
      <div v-if="!config.providerId && hasLegacyFields" class="legacy-hint">
        检测到旧配置结构，后端启动时会自动迁移为 Provider 引用。若仍未迁移，请重启后端服务。
      </div>

      <el-form :model="config" label-width="84px" label-position="left">
        <el-form-item label="Provider" required>
          <el-select
            v-model="config.providerId"
            placeholder="选择 Provider"
            clearable
            filterable
            style="width:100%"
          >
            <el-option
              v-for="p in filteredProviders"
              :key="p.id"
              :label="`[${p.name}] ${p.model || '未设置模型'}`"
              :value="p.id"
            />
          </el-select>
          <div class="form-tip">凭证从 Provider 配置继承。</div>
        </el-form-item>

        <el-form-item label="向量维度">
          <el-input-number v-model="config.dimensions" :min="0" :max="8192" controls-position="right" />
          <div class="form-tip">0 表示自动检测。常用：bge-m3=1024，Qwen3=4096。</div>
        </el-form-item>
      </el-form>

      <div class="action-bar">
        <el-button @click="handleTest" :loading="testLoading" class="test-btn">
          <el-icon><Connection /></el-icon>
          测试连接
        </el-button>
        <el-button type="primary" @click="handleSave" :loading="saveLoading">
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
import { ElMessage } from 'element-plus'
import { Check, Connection, CircleCheckFilled, CircleCloseFilled } from '@element-plus/icons-vue'
import { getSystemConfigApi, saveSystemConfigApi, testLlmConnectionApi, getLlmProfilesApi, type LlmProfile } from '@/api/system'

interface EmbeddingModelConfig {
  providerId: string
  dimensions: number
}

const saveLoading = ref(false)
const testLoading = ref(false)
const connectionTestResult = ref<{ success: boolean; message?: string; latency?: number } | null>(null)
const providers = ref<LlmProfile[]>([])
const hasLegacyFields = ref(false)

const config = reactive<EmbeddingModelConfig>({
  providerId: '',
  dimensions: 1024,
})

const originalConfig = ref('')

const normalizedConfig = computed(() => JSON.stringify(config))
const hasUnsavedChanges = computed(() => normalizedConfig.value !== originalConfig.value)
const selectedProvider = computed(() => providers.value.find((p) => p.id === config.providerId))

const filteredProviders = computed(() =>
  providers.value.filter((p) => p.isEnabled && ['embedding', 'all'].includes(p.usage || 'chat'))
)

const summary = computed(() => [
  { label: 'Provider', value: selectedProvider.value?.name || '未设置' },
  { label: '模型', value: selectedProvider.value?.model || '未设置' },
  { label: '向量维度', value: String(config.dimensions) },
])

const handleSave = async () => {
  if (!config.providerId) {
    ElMessage.warning('请先选择 Provider')
    return
  }
  saveLoading.value = true
  try {
    await saveSystemConfigApi('embedding_model', config)
    originalConfig.value = JSON.stringify(config)
    ElMessage.success('Embedding 模型配置保存成功')
  } catch (e: any) {
    ElMessage.error(`保存失败: ${e.message || '未知错误'}`)
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
      modelType: 'embedding',
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
    const { data } = await getSystemConfigApi('embedding_model')
    const configData = typeof data?.value === 'string' ? JSON.parse(data.value) : (data?.value || data)
    if (configData && typeof configData === 'object') {
      // 检测旧结构
      if (!configData.providerId && (configData.apiKey || configData.modelName)) {
        hasLegacyFields.value = true
      }
      if (configData.providerId !== undefined) config.providerId = configData.providerId
      if (configData.dimensions !== undefined) config.dimensions = configData.dimensions
    }
    originalConfig.value = JSON.stringify(config)
  } catch (e) {
    console.error('加载 Embedding 配置失败', e)
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
  color: var(--color-warning-text);
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-bg); /* 原 #fde68a 浅黄边框，对齐 --color-warning-bg */
  border-radius: 6px;
  padding: 8px 12px;
  line-height: 1.5;
}

.form-tip {
  margin-top: 4px;
  font-size: 12px;
  color: var(--corp-text-secondary);
  line-height: 1.5;
}

.action-bar {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 4px;
}

.test-btn {
  border-color: var(--color-primary-600);
  color: var(--color-primary-600);
}

.test-btn:hover {
  background: var(--color-primary-50);
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
  background: var(--color-success-bg);
  border: 1px solid var(--color-success-bg); /* 原 #bbf7d0 浅绿边框，对齐 --color-success-bg */
  color: var(--color-success-text);
}

.test-fail {
  background: var(--color-danger-bg);
  border: 1px solid var(--color-danger-bg); /* 原 #fecaca 浅红边框，对齐 --color-danger-bg */
  color: var(--color-danger-text);
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
