<template>
  <div class="ocr-config-tab">
    <!-- 说明提示 -->
    <div class="info-banner">
      <div class="banner-icon">📄</div>
      <div class="banner-content">
        <div class="banner-title">OCR 文字识别配置</div>
        <div class="banner-desc">用于识别扫描件 PDF、图片中的文字内容，支持视觉模型（Qwen-VL、DeepSeek-VL 等）</div>
      </div>
    </div>

    <!-- 配置卡片 -->
    <div class="config-card">
      <div class="card-header">
        <span class="card-title">连接参数</span>
      </div>
      
      <div class="card-body">
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
            <div class="form-tip">OpenAI 兼容接口地址，需使用支持视觉识别的模型</div>
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
            <div class="form-tip">推荐：Qwen-VL2、DeepSeek-VL2、PaddleOCR-VL 等视觉模型</div>
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
import { ref, reactive, onMounted } from 'vue'
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

// 常用 OCR 视觉模型
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
  'moonshot-v1-8k', // 支持图片输入
]

const ocrModelConfig = reactive<OCRModelConfig>({
  serviceType: 'custom',
  apiKey: '',
  apiBaseUrl: 'https://api.siliconflow.cn/v1',
  modelName: 'Qwen/Qwen2-VL-72B-Instruct',
  timeout: 180,
  enabled: true,
})

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
    let configData = data?.value || data
    
    // 兼容双重序列化的旧数据
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
          (ocrModelConfig as any)[key] = configData[key]
        }
      })
    }
  } catch (e) {
    console.error('加载配置失败', e)
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
