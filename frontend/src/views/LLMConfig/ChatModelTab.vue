<template>
  <div class="chat-model-tab">
    <!-- 配置表单 -->
    <div class="config-section">
      <div class="section-title">Chat 模型配置</div>
      
      <div class="config-card">
        <el-form :model="chatModelConfig" label-width="120px" label-position="left">
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
            <div class="form-tip">OpenAI 兼容接口地址，例如：硅基流动、火山引擎、本地 VLLM/Ollama 等</div>
          </el-form-item>

          <el-form-item label="模型名称" required>
            <el-select 
              v-model="chatModelConfig.modelName" 
              placeholder="输入模型名称"
              filterable
              allow-create
              default-first-option
              style="width: 100%"
            >
              <el-option
                v-for="model in commonModels"
                :key="model"
                :label="model"
                :value="model"
              />
            </el-select>
            <div class="form-tip">支持常见模型：Qwen、DeepSeek、Kimi、GLM、doubao 等</div>
          </el-form-item>

          <div class="param-row">
            <el-form-item label="最大 Tokens">
              <el-input-number 
                v-model="chatModelConfig.maxTokens" 
                :min="1" 
                :max="100000" 
                controls-position="right"
              />
            </el-form-item>

            <el-form-item label="超时时间">
              <el-input-number 
                v-model="chatModelConfig.timeout" 
                :min="10" 
                :max="300" 
                controls-position="right"
              />
              <span class="unit-label">秒</span>
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
            </div>
            <div class="temp-labels">
              <span>精确</span>
              <span class="temp-value">{{ chatModelConfig.temperature.toFixed(2) }}</span>
              <span>创意</span>
            </div>
          </el-form-item>
        </el-form>
      </div>

      <div class="action-bar">
        <el-button @click="handleTestConnection" :loading="testLoading" class="test-btn">
          <el-icon><Connection /></el-icon>
          测试连接
        </el-button>
        <el-button type="primary" :loading="saveLoading" @click="handleSaveChatConfig" class="save-btn">
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

interface ChatModelConfig {
  serviceType: string
  apiKey: string
  apiBaseUrl: string
  modelName: string
  maxTokens: number
  temperature: number
  timeout: number
  enabled: boolean
}

const saveLoading = ref(false)
const testLoading = ref(false)

// 常用模型列表
const commonModels = [
  'Qwen/Qwen2.5-72B-Instruct',
  'Qwen/Qwen2.5-32B-Instruct',
  'Qwen/Qwen2.5-14B-Instruct',
  'Qwen/Qwen2.5-7B-Instruct',
  'deepseek-ai/DeepSeek-V3',
  'deepseek-ai/DeepSeek-R1',
  'deepseek-ai/DeepSeek-V2.5',
  'THUDM/glm-4-9b-chat',
  'THUDM/glm-4-plus',
  'moonshot-v1-8k',
  'moonshot-v1-32k',
  'doubao-seed-2.0-code',
  'doubao-seed-2.0-pro',
]

const tempMarks = {
  0: '0',
  0.5: '0.5',
  1: '1',
}

const chatModelConfig = reactive<ChatModelConfig>({
  serviceType: 'custom',
  apiKey: '',
  apiBaseUrl: 'https://api.siliconflow.cn/v1',
  modelName: 'Qwen/Qwen2.5-72B-Instruct',
  maxTokens: 8192,
  temperature: 0.3,
  timeout: 120,
  enabled: true,
})

const handleTestConnection = async () => {
  if (!chatModelConfig.apiKey) {
    ElMessage.warning('请先输入 API 密钥')
    return
  }
  testLoading.value = true
  try {
    const { data: testResult } = await testLlmConnectionApi({
      serviceType: chatModelConfig.serviceType,
      apiKey: chatModelConfig.apiKey,
      apiBaseUrl: chatModelConfig.apiBaseUrl,
      modelName: chatModelConfig.modelName,
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

const handleSaveChatConfig = async () => {
  if (!chatModelConfig.apiKey || !chatModelConfig.apiBaseUrl || !chatModelConfig.modelName) {
    ElMessage.warning('请填写完整的配置信息')
    return
  }
  saveLoading.value = true
  try {
    // 先测试连接
    const { data: testResult } = await testLlmConnectionApi({
      serviceType: chatModelConfig.serviceType,
      apiKey: chatModelConfig.apiKey,
      apiBaseUrl: chatModelConfig.apiBaseUrl,
      modelName: chatModelConfig.modelName,
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
    await saveSystemConfigApi('llm_chat_model', chatModelConfig)
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
    const { data } = await getSystemConfigApi('llm_chat_model')
    const configData = data?.value || data
    if (configData && typeof configData === 'object') {
      // 只更新有值的字段，保留用户当前输入的其他字段
      Object.keys(chatModelConfig).forEach(key => {
        if (key in configData && configData[key] !== undefined && configData[key] !== null) {
          (chatModelConfig as any)[key] = configData[key]
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
.chat-model-tab {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 8px 0;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--corp-text-primary);
  margin-bottom: 16px;
}

/* 配置区 */
.config-section {
  background: var(--bg-surface);
  border-radius: var(--corp-radius-lg);
  border: 1px solid var(--corp-border-light);
  padding: 20px;
}

.config-card {
  background: #fff;
  border-radius: var(--corp-radius-md);
  padding: 8px 0;
}

.param-row {
  display: flex;
  gap: 24px;
}

.param-row .el-form-item {
  flex: 1;
}

.unit-label {
  margin-left: 8px;
  font-size: 13px;
  color: var(--corp-text-secondary);
}

.slider-wrapper {
  flex: 1;
  padding-right: 20px;
}

.temp-labels {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--corp-text-secondary);
  margin-top: 4px;
}

.temp-value {
  font-weight: 600;
  color: var(--corp-primary);
}

.form-tip {
  font-size: 12px;
  color: var(--corp-text-secondary);
  margin-top: 4px;
  line-height: 1.4;
}

/* 操作栏 */
.action-bar {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
  padding-top: 16px;
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
  min-width: 120px;
}

@media (max-width: 600px) {
  .param-row {
    flex-direction: column;
    gap: 0;
  }
}
</style>
