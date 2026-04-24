<template>
  <div class="chat-model-tab">
    <!-- 供应商选择 -->
    <div class="provider-section">
      <div class="section-title">选择 LLM 供应商</div>
      <div class="provider-cards">
        <div
          v-for="provider in providers"
          :key="provider.value"
          class="provider-card"
          :class="{ active: chatModelConfig.serviceType === provider.value }"
          @click="selectProvider(provider)"
        >
          <div class="provider-icon">{{ provider.icon }}</div>
          <div class="provider-info">
            <div class="provider-name">{{ provider.name }}</div>
            <div class="provider-desc">{{ provider.desc }}</div>
          </div>
          <div class="check-icon" v-if="chatModelConfig.serviceType === provider.value">
            <el-icon><Check /></el-icon>
          </div>
        </div>
      </div>
    </div>

    <!-- 配置表单 -->
    <div class="config-section">
      <div class="section-title">
        <span>配置参数</span>
        <el-tag size="small" type="info" effect="plain">{{ currentProviderName }}</el-tag>
      </div>
      
      <div class="config-card">
        <el-form :model="chatModelConfig" label-width="110px" label-position="left">
          <el-form-item label="API 密钥" required>
            <el-input 
              v-model="chatModelConfig.apiKey" 
              type="password" 
              placeholder="请输入 API 密钥" 
              show-password 
              clearable
            />
          </el-form-item>

          <el-form-item label="API 基础 URL" required>
            <el-input 
              v-model="chatModelConfig.apiBaseUrl" 
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
              v-model="chatModelConfig.modelName" 
              placeholder="请选择或输入模型"
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
import { ref, reactive, computed, onMounted } from 'vue'
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

interface Provider {
  value: string
  name: string
  desc: string
  icon: string
  defaultUrl: string
  tip: string
  models: { label: string; value: string }[]
  modelTip: string
}

const saveLoading = ref(false)
const testLoading = ref(false)

// 只保留4个供应商
const providers: Provider[] = [
  {
    value: 'volcengine',
    name: '火山引擎',
    desc: '豆包 / Kimi / 智谱 / DeepSeek',
    icon: '🔥',
    defaultUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    tip: '火山引擎 Ark Coding 服务地址，支持豆包、Kimi 等模型',
    models: [
      { label: 'doubao-seed-2.0-code', value: 'doubao-seed-2.0-code' },
      { label: 'doubao-seed-2.0-pro', value: 'doubao-seed-2.0-pro' },
      { label: 'doubao-seed-2.0-lite', value: 'doubao-seed-2.0-lite' },
      { label: 'doubao-seed-code', value: 'doubao-seed-code' },
      { label: 'minimax-m2.5', value: 'minimax-m2.5' },
      { label: 'glm-4.7', value: 'glm-4.7' },
      { label: 'deepseek-v3.2', value: 'deepseek-v3.2' },
      { label: 'kimi-k2.5', value: 'kimi-k2.5' },
    ],
    modelTip: '推荐 doubao-seed-2.0-code 或 kimi-k2.5',
  },
  {
    value: 'siliconflow',
    name: '硅基流动',
    desc: '免费开源大模型',
    icon: '💧',
    defaultUrl: 'https://api.siliconflow.cn/v1',
    tip: '硅基流动 API 地址，免费开源模型',
    models: [
      { label: 'Qwen2.5-72B-Instruct', value: 'Qwen/Qwen2.5-72B-Instruct' },
      { label: 'DeepSeek-V3', value: 'deepseek-ai/DeepSeek-V3' },
      { label: 'DeepSeek-R1', value: 'deepseek-ai/DeepSeek-R1' },
      { label: 'Yi-1.5-34B', value: '01-ai/Yi-1.5-34B-Chat' },
    ],
    modelTip: '免费推荐 Qwen2.5-72B / DeepSeek-V3',
  },
  {
    value: 'ollama',
    name: '本地 Ollama',
    desc: '本地部署开源模型',
    icon: '🏠',
    defaultUrl: 'http://localhost:11434/v1',
    tip: '本地 Ollama 服务地址，默认 http://localhost:11434/v1',
    models: [
      { label: 'qwen2.5:7b', value: 'qwen2.5:7b' },
      { label: 'qwen2.5:14b', value: 'qwen2.5:14b' },
      { label: 'qwen2.5:32b', value: 'qwen2.5:32b' },
      { label: 'llama3:8b', value: 'llama3:8b' },
      { label: 'mistral:7b', value: 'mistral:7b' },
    ],
    modelTip: '确保 Ollama 服务已启动，模型需提前下载',
  },
  {
    value: 'vllm',
    name: 'VLLM Studio',
    desc: '高性能推理框架',
    icon: '⚡',
    defaultUrl: 'http://localhost:8000/v1',
    tip: 'VLLM Studio 服务地址，高性能本地推理',
    models: [
      { label: '默认模型', value: 'default' },
    ],
    modelTip: '填写 VLLM 服务部署的模型名称',
  },
]

const tempMarks = {
  0: '0',
  0.5: '0.5',
  1: '1',
}

const chatModelConfig = reactive<ChatModelConfig>({
  serviceType: 'siliconflow',
  apiKey: '',
  apiBaseUrl: 'https://api.siliconflow.cn/v1',
  modelName: 'Qwen/Qwen2.5-72B-Instruct',
  maxTokens: 8192,
  temperature: 0.3,
  timeout: 120,
  enabled: true,
})

const currentProvider = computed(() => 
  providers.find(p => p.value === chatModelConfig.serviceType) || providers[1]
)

const currentProviderName = computed(() => currentProvider.value.name)

const currentProviderTip = computed(() => currentProvider.value.tip)

const currentProviderModelTip = computed(() => currentProvider.value.modelTip)

const currentProviderModels = computed(() => currentProvider.value.models)

const selectProvider = (provider: Provider) => {
  chatModelConfig.serviceType = provider.value
  chatModelConfig.apiBaseUrl = provider.defaultUrl
  chatModelConfig.modelName = provider.models[0]?.value || ''
}

const resetToDefaultUrl = () => {
  const provider = providers.find(p => p.value === chatModelConfig.serviceType)
  if (provider) {
    chatModelConfig.apiBaseUrl = provider.defaultUrl
    ElMessage.success(`已恢复 ${provider.name} 默认地址`)
  }
}

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

/* 供应商选择区 */
.provider-section {
  background: var(--bg-surface);
  border-radius: var(--corp-radius-lg);
  border: 1px solid var(--corp-border-light);
  padding: 20px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--corp-text-primary);
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.provider-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}

.provider-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: #fff;
  border: 2px solid var(--corp-border-light);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.provider-card:hover {
  border-color: var(--corp-primary);
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.12);
  transform: translateY(-2px);
}

.provider-card.active {
  border-color: var(--corp-primary);
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.04) 0%, rgba(37, 99, 235, 0.08) 100%);
}

.provider-icon {
  font-size: 32px;
  flex-shrink: 0;
}

.provider-info {
  flex: 1;
  min-width: 0;
}

.provider-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--corp-text-primary);
  margin-bottom: 4px;
}

.provider-desc {
  font-size: 12px;
  color: var(--corp-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.check-icon {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  background: var(--corp-primary);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 12px;
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

.reset-btn {
  font-size: 12px;
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

@media (max-width: 900px) {
  .provider-cards {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .provider-cards {
    grid-template-columns: 1fr;
  }
  
  .param-row {
    flex-direction: column;
    gap: 0;
  }
}
</style>
