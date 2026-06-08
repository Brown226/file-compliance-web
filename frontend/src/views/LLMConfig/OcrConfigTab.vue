<template>
  <div class="engine-tab">
    <section class="config-section">
      <div class="config-card">
        <el-form :model="ocrModelConfig" label-width="120px" label-position="left">
          <el-form-item label="API 密钥" required>
            <el-input
              v-model="ocrModelConfig.apiKey"
              type="password"
              placeholder="sk-..."
              show-password
              clearable
            />
          </el-form-item>

          <el-form-item label="API 基础 URL" required>
            <el-input
              v-model="ocrModelConfig.apiBaseUrl"
              placeholder="https://api.openai.com/v1"
              clearable
            />
            <div class="form-tip">通过 doc-parser 的视觉模型端点进行扫描件识别。</div>
          </el-form-item>

          <el-form-item label="模型名称" required>
            <el-select
              v-model="ocrModelConfig.modelName"
              placeholder="输入模型名称"
              filterable
              allow-create
              default-first-option
              style="width: 100%"
            >
              <el-option
                v-for="model in commonOcrModels"
                :key="model"
                :label="model"
                :value="model"
              />
            </el-select>
            <div class="form-tip">扫描件 PDF 和图片的文字识别将使用此视觉模型完成。</div>
          </el-form-item>

          <el-form-item label="超时时间">
            <div class="inline-number">
              <el-input-number
                v-model="ocrModelConfig.timeout"
                :min="30"
                :max="300"
                controls-position="right"
              />
              <span class="unit-label">秒</span>
            </div>
          </el-form-item>
        </el-form>
      </div>

      <div class="action-bar">
        <el-button @click="handleTestConnection" :loading="testLoading" class="test-btn">
          <el-icon><Connection /></el-icon>
          测试连接
        </el-button>
        <el-button type="primary" :loading="saveLoading" @click="handleSaveOcrConfig">
          <el-icon><Check /></el-icon>
          保存配置
        </el-button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Check, Connection } from '@element-plus/icons-vue'
import {
  getSystemConfigApi,
  saveSystemConfigApi,
  testLlmConnectionApi,
} from '@/api/system'

interface OCRModelConfig {
  serviceType: string
  apiKey: string
  apiBaseUrl: string
  modelName: string
  timeout: number
  enabled: boolean
}

const saveLoading = ref(false)
const testLoading = ref(false)

const commonOcrModels = [
  'Qwen/Qwen2-VL-72B-Instruct',
  'Qwen/Qwen2-VL-7B-Instruct',
  'Qwen/Qwen2.5-VL-72B-Instruct',
  'Qwen/Qwen2.5-VL-7B-Instruct',
  'deepseek-ai/DeepSeek-VL2-72B',
  'deepseek-ai/DeepSeek-VL2-27B',
  'deepseek-ai/DeepSeek-VL2-7B',
  'PaddlePaddle/PaddleOCR-VL-1.5',
  'THUDM/glm-4v-9b',
  'moonshot-v1-8k',
]

const ocrModelConfig = reactive<OCRModelConfig>({
  serviceType: 'custom',
  apiKey: '',
  apiBaseUrl: 'https://api.siliconflow.cn/v1',
  modelName: 'Qwen/Qwen2-VL-72B-Instruct',
  timeout: 180,
  enabled: true,
})

const originalConfig = ref('')

const normalizedConfig = computed(() => JSON.stringify(ocrModelConfig))
const hasUnsavedChanges = computed(() => normalizedConfig.value !== originalConfig.value)
const summary = computed(() => [
  { label: '模型名称', value: ocrModelConfig.modelName || '未设置' },
  { label: '接口地址', value: ocrModelConfig.apiBaseUrl || '未设置' },
  { label: '超时时间', value: `${ocrModelConfig.timeout} 秒` },
])

const handleTestConnection = async () => {
  if (!ocrModelConfig.apiKey) {
    ElMessage.warning('请先输入 API 密钥')
    return
  }
  testLoading.value = true
  try {
    const { data: testResult } = await testLlmConnectionApi({
      serviceType: ocrModelConfig.serviceType,
      apiKey: ocrModelConfig.apiKey,
      apiBaseUrl: ocrModelConfig.apiBaseUrl,
      modelName: ocrModelConfig.modelName,
      modelType: 'chat',
    })
    if (testResult.success) {
      ElMessage.success('连接测试通过')
    } else {
      ElMessage.error(`连接失败: ${testResult.message}`)
    }
  } catch (e: any) {
    ElMessage.error(`连接失败: ${e.message || '请检查配置参数'}`)
  } finally {
    testLoading.value = false
  }
}

const handleSaveOcrConfig = async () => {
  if (!ocrModelConfig.apiKey || !ocrModelConfig.apiBaseUrl || !ocrModelConfig.modelName) {
    ElMessage.warning('请填写完整的配置信息')
    return
  }
  saveLoading.value = true
  try {
    const { data: testResult } = await testLlmConnectionApi({
      serviceType: ocrModelConfig.serviceType,
      apiKey: ocrModelConfig.apiKey,
      apiBaseUrl: ocrModelConfig.apiBaseUrl,
      modelName: ocrModelConfig.modelName,
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

    await saveSystemConfigApi('llm_ocr_model', ocrModelConfig)
    originalConfig.value = JSON.stringify(ocrModelConfig)
    ElMessage.success('配置保存成功')
  } catch (e: any) {
    const errorMsg = e.response?.data?.error || e.message || '保存失败'
    ElMessage.error(`保存失败: ${errorMsg}`)
  } finally {
    saveLoading.value = false
  }
}

onMounted(async () => {
  try {
    const { data } = await getSystemConfigApi('llm_ocr_model')
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
      Object.keys(ocrModelConfig).forEach(key => {
        if (key in configData && configData[key] !== undefined && configData[key] !== null) {
          ;(ocrModelConfig as any)[key] = configData[key]
        }
      })
    }
    originalConfig.value = JSON.stringify(ocrModelConfig)
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
}

.test-btn {
  border-color: #2563eb;
  color: #2563eb;
}

.test-btn:hover {
  background: #eff6ff;
}
</style>
