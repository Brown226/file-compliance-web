<template>
  <div class="engine-tab">
    <section class="config-section">
      <el-form :model="config" label-width="140px" label-position="left">
        <div class="param-group">
          <div class="param-group__title">Rerank 配置</div>
          <el-form-item label="Provider" required class="provider-field">
            <el-select
              v-model="config.providerId"
              placeholder="选择支持重排序的 Provider"
              clearable
              filterable
              style="width:100%"
            >
              <el-option
                v-for="p in rerankProviders"
                :key="p.id"
                :label="`[${p.name}] ${p.model || '未设置模型'}`"
                :value="p.id"
              />
            </el-select>
            <div class="form-tip">仅展示能力库标记为「重排序（Rerank）」的 Provider。凭证从 Provider 配置继承。</div>
          </el-form-item>

          <el-form-item label="返回条数 TopK">
            <el-input-number v-model="config.topK" :min="1" :max="50" controls-position="right" />
            <div class="form-tip">重排序后保留的相关文档条数，默认 8</div>
          </el-form-item>
        </div>
      </el-form>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getSystemConfigApi, saveSystemConfigApi, testLlmConnectionApi, getLlmProfilesApi, type LlmProfile } from '@/api/system'

interface RerankModelConfig {
  providerId: string
  topK: number
}

const saveLoading = ref(false)
const testLoading = ref(false)
const connectionTestResult = ref<{ success: boolean; message?: string; latency?: number } | null>(null)
const providers = ref<LlmProfile[]>([])
const hasLegacyFields = ref(false)

const config = reactive<RerankModelConfig>({
  providerId: '',
  topK: 8,
})

const originalConfig = ref('')
const normalizedConfig = computed(() => JSON.stringify(config))
const hasUnsavedChanges = computed(() => normalizedConfig.value !== originalConfig.value)
const selectedProvider = computed(() => providers.value.find((p) => p.id === config.providerId))

/** 重排序 Provider：明确标记 rerank 用途，或能力声明支持 rerank */
const rerankProviders = computed(() =>
  providers.value.filter(
    (p) =>
      p.isEnabled &&
      (p.usage === 'rerank' || p.capabilities?.supportsRerank === true),
  )
)

const summary = computed(() => [
  { label: 'Provider', value: selectedProvider.value?.name || '未设置' },
  { label: '模型', value: selectedProvider.value?.model || '未配置' },
  { label: 'TopK', value: String(config.topK) },
])

const handleSave = async () => {
  if (!config.providerId) {
    ElMessage.warning('请先选择 Provider')
    return
  }
  saveLoading.value = true
  try {
    const sel = selectedProvider.value
    // 写入 providerId + 展开凭证（兼容后端 getRerankConfig 独立读取 apiBaseUrl/apiKey/modelName）
    await saveSystemConfigApi('reranker_model', {
      serviceType: 'openai',
      providerId: config.providerId,
      apiBaseUrl: sel?.apiBase || '',
      apiKey: sel?.apiKey || '',
      modelName: sel?.model || '',
      topK: config.topK,
      timeout: 30,
    })
    originalConfig.value = JSON.stringify(config)
    ElMessage.success('Rerank 模型配置保存成功')
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
      modelType: 'rerank',
      topK: config.topK,
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
    const { data } = await getSystemConfigApi('reranker_model')
    const configData = typeof data?.value === 'string' ? JSON.parse(data.value) : (data?.value || data)
    if (configData && typeof configData === 'object') {
      if (configData.providerId !== undefined) config.providerId = configData.providerId
      if (typeof configData.topK === 'number') config.topK = configData.topK
    }
    originalConfig.value = JSON.stringify(config)
  } catch (e) {
    console.error('加载 Rerank 配置失败', e)
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

/* Provider 字段限宽（与对话/Embedding 统一） */
.provider-field {
  max-width: 560px;
}

/* 参数分组：与其他模型 tab 统一 */
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

.form-tip {
  margin-top: 4px;
  font-size: 12px;
  color: var(--corp-text-secondary);
  line-height: 1.5;
}
</style>
