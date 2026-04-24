<template>
  <div class="ocr-config-tab">
    <!-- 说明提示 -->
    <div class="info-banner">
      <div class="banner-icon">📄</div>
      <div class="banner-content">
        <div class="banner-title">OCR 文字识别配置</div>
        <div class="banner-desc">用于识别扫描件 PDF、图片中的文字内容，支持 PaddleOCR、GPT-4o 等模型</div>
      </div>
    </div>

    <!-- 配置卡片 -->
    <div class="config-card">
      <div class="card-header">
        <span class="card-title">连接参数</span>
      </div>
      
      <div class="card-body">
        <el-form :model="ocrModelConfig" label-width="110px" label-position="left">
          <el-form-item label="服务类型">
            <el-select v-model="ocrModelConfig.serviceType" style="width: 100%" @change="handleOcrServiceChange">
              <el-option label="硅基流动 (PaddleOCR)" value="siliconflow" />
              <el-option label="火山引擎 (Volcengine)" value="volcengine" />
              <el-option label="本地 Ollama" value="ollama" />
            </el-select>
          </el-form-item>

          <el-form-item label="API 密钥" required>
            <el-input 
              v-model="ocrModelConfig.apiKey" 
              type="password" 
              placeholder="请输入 API 密钥" 
              show-password 
              clearable
            />
          </el-form-item>

          <el-form-item label="API 基础 URL" required>
            <el-input 
              v-model="ocrModelConfig.apiBaseUrl" 
              placeholder="API 接口地址"
              clearable
            >
              <template #append>
                <el-button @click="resetToDefaultUrl" class="reset-btn">恢复默认</el-button>
              </template>
            </el-input>
            <div class="form-tip">{{ currentProviderTip }}</div>
          </el-form-item>

          <el-form-item label="模型名称" required>
            <el-select 
              v-model="ocrModelConfig.modelName" 
              placeholder="请选择模型"
              filterable
              allow-create
              default-first-option
              style="width: 100%"
            >
              <el-option
                v-for="model in currentProviderModels"
                :key="model.value"
                :label="model.label"
                :value="model.value"
              />
            </el-select>
            <div class="form-tip">{{ currentProviderModelTip }}</div>
          </el-form-item>

          <el-form-item label="超时时间">
            <div class="input-with-unit">
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

      <div class="card-footer">
        <el-button @click="handleTestConnection" :loading="testLoading" class="test-btn">
          <el-icon><Connection /></el-icon>
          测试连接
        </el-button>
        <el-button type="primary" :loading="saveLoading" @click="handleSaveOcrConfig" class="save-btn">
          <el-icon><Check /></el-icon>
          保存配置
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
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

interface OCRProvider {
  value: string
  name: string
  defaultUrl: string
  tip: string
  models: { label: string; value: string }[]
  modelTip: string
}

const saveLoading = ref(false)
const testLoading = ref(false)

const ocrProviders: OCRProvider[] = [
  {
    value: 'siliconflow',
    name: '硅基流动',
    defaultUrl: 'https://api.siliconflow.cn/v1',
    tip: '硅基流动 API 地址，免费 PaddleOCR 模型',
    models: [
      { label: 'PaddleOCR-VL-1.5 (免费)', value: 'PaddlePaddle/PaddleOCR-VL-1.5' },
      { label: 'DeepSeek-OCR (免费)', value: 'deepseek-ai/DeepSeek-OCR' },
      { label: 'Qwen-VL2 (免费)', value: 'Qwen/Qwen2-VL-72B-Instruct' },
    ],
    modelTip: '推荐使用 PaddleOCR-VL-1.5，免费且识别效果好',
  },
  {
    value: 'volcengine',
    name: '火山引擎',
    defaultUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    tip: '火山引擎 Ark 服务地址',
    models: [
      { label: 'doubao-vision-pro', value: 'doubao-vision-pro' },
      { label: 'kimi-vision', value: 'kimi-vision' },
    ],
    modelTip: '使用视觉模型进行 OCR 识别',
  },
  {
    value: 'ollama',
    name: '本地 Ollama',
    defaultUrl: 'http://localhost:11434/v1',
    tip: '本地 Ollama 服务地址，需部署视觉模型',
    models: [
      { label: 'llava', value: 'llava' },
      { label: 'llava:13b', value: 'llava:13b' },
      { label: 'moondream', value: 'moondream' },
    ],
    modelTip: '确保 Ollama 已安装视觉模型',
  },
]

const ocrModelConfig = reactive<OCRModelConfig>({
  serviceType: 'siliconflow',
  apiKey: '',
  apiBaseUrl: 'https://api.siliconflow.cn/v1',
  modelName: 'PaddlePaddle/PaddleOCR-VL-1.5',
  timeout: 180,
  enabled: true,
})

const currentProvider = computed(() => 
  ocrProviders.find(p => p.value === ocrModelConfig.serviceType) || ocrProviders[0]
)

const currentProviderTip = computed(() => currentProvider.value.tip)
const currentProviderModelTip = computed(() => currentProvider.value.modelTip)
const currentProviderModels = computed(() => currentProvider.value.models)

const handleOcrServiceChange = (val: string) => {
  const provider = ocrProviders.find(p => p.value === val)
  if (provider) {
    ocrModelConfig.apiBaseUrl = provider.defaultUrl
    ocrModelConfig.modelName = provider.models[0]?.value || ''
  }
}

const resetToDefaultUrl = () => {
  const provider = ocrProviders.find(p => p.value === ocrModelConfig.serviceType)
  if (provider) {
    ocrModelConfig.apiBaseUrl = provider.defaultUrl
    ElMessage.success(`已恢复 ${provider.name} 默认地址`)
  }
}

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
      ElMessage.success('连接测试通过！')
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
    // 先测试连接
    const { data: testResult } = await testLlmConnectionApi({
      serviceType: ocrModelConfig.serviceType,
      apiKey: ocrModelConfig.apiKey,
      apiBaseUrl: ocrModelConfig.apiBaseUrl,
      modelName: ocrModelConfig.modelName,
      modelType: 'chat',
    })
    
    // 测试失败时给用户选择权
    if (!testResult.success) {
      try {
        await ElMessageBox.confirm(
          `连接测试失败: ${testResult.message}\n\n是否仍然保存配置？您可以稍后修正后再测试。`,
          '警告',
          {
            confirmButtonText: '仍然保存',
            cancelButtonText: '取消',
            type: 'warning',
          }
        )
      } catch {
        // 用户取消
        return
      }
    }
    
    // 保存配置到数据库
    await saveSystemConfigApi('llm_ocr_model', ocrModelConfig)
    ElMessage.success('配置保存成功！')
  } catch (e: any) {
    console.error('保存配置失败:', e)
    // 保存失败时不重置表单，保留用户输入
    const errorMsg = e.response?.data?.error || e.message || '保存失败'
    ElMessage.error(`保存失败: ${errorMsg}`)
  } finally {
    saveLoading.value = false
  }
}

onMounted(async () => {
  try {
    const { data } = await getSystemConfigApi('llm_ocr_model')
    const configData = data?.value || data
    if (configData && typeof configData === 'object') {
      // 只更新有值的字段，保留用户当前输入的其他字段
      Object.keys(ocrModelConfig).forEach(key => {
        if (key in configData && configData[key] !== undefined && configData[key] !== null) {
          (ocrModelConfig as any)[key] = configData[key]
        }
      })
    }
  } catch (e) {
    console.error('加载配置失败', e)
    // 加载失败时保留当前表单状态，不重置为默认值
  }
})
</script>

<style scoped>
.ocr-config-tab {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 8px 0;
}

/* 信息提示横幅 */
.info-banner {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: var(--corp-radius-lg);
  color: #fff;
}

.banner-icon {
  font-size: 32px;
  flex-shrink: 0;
}

.banner-content {
  flex: 1;
}

.banner-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 4px;
}

.banner-desc {
  font-size: 13px;
  opacity: 0.9;
}

/* 配置卡片 */
.config-card {
  background: var(--bg-surface);
  border-radius: var(--corp-radius-lg);
  border: 1px solid var(--corp-border-light);
  overflow: hidden;
}

.card-header {
  padding: 14px 20px;
  background: #fafafa;
  border-bottom: 1px solid var(--corp-border-light);
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.card-body {
  padding: 20px;
  background: #fff;
}

.input-with-unit {
  display: flex;
  align-items: center;
  gap: 8px;
}

.unit-label {
  font-size: 13px;
  color: var(--corp-text-secondary);
}

.reset-btn {
  font-size: 12px;
}

.card-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  background: #fafafa;
  border-top: 1px solid var(--corp-border-light);
}

.test-btn {
  border-color: var(--corp-primary);
  color: var(--corp-primary);
}

.test-btn:hover {
  background: var(--color-primary-50);
}

.save-btn {
  min-width: 110px;
}

.form-tip {
  font-size: 12px;
  color: var(--corp-text-secondary);
  margin-top: 4px;
  line-height: 1.4;
}
</style>
