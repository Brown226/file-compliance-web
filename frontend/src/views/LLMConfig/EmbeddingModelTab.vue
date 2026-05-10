<template>
  <div class="embedding-tab">
    <div class="config-section">
      <div class="section-title">Embedding 模型配置</div>
      <p class="section-desc">用于知识库文档向量化，支持 OpenAI 兼容接口（如硅基流动、Ollama 等）</p>

      <div class="config-card">
        <el-form :model="config" label-width="120px" label-position="left">
          <el-form-item label="API 密钥">
            <el-input v-model="config.apiKey" type="password" placeholder="sk-..." show-password clearable />
          </el-form-item>

          <el-form-item label="API 基础 URL">
            <el-input v-model="config.apiBaseUrl" placeholder="https://api.siliconflow.cn/v1" clearable />
          </el-form-item>

          <el-form-item label="模型名称">
            <el-select v-model="config.modelName" filterable allow-create default-first-option style="width: 100%">
              <el-option label="BAAI/bge-m3" value="BAAI/bge-m3" />
              <el-option label="BAAI/bge-large-zh-v1.5" value="BAAI/bge-large-zh-v1.5" />
              <el-option label="text-embedding-3-small" value="text-embedding-3-small" />
              <el-option label="text-embedding-3-large" value="text-embedding-3-large" />
            </el-select>
            <div class="form-tip">推荐 BAAI/bge-m3（1024维，支持中英文）</div>
          </el-form-item>

          <el-form-item label="向量维度">
            <el-input-number v-model="config.dimensions" :min="128" :max="4096" controls-position="right" />
            <div class="form-tip">BGE-M3 默认 1024 维</div>
          </el-form-item>
        </el-form>
      </div>
    </div>

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

    <!-- 测试结果内联显示 -->
    <div v-if="connectionTestResult" class="test-result" :class="connectionTestResult.success ? 'test-success' : 'test-fail'">
      <el-icon><component :is="connectionTestResult.success ? 'CircleCheckFilled' : 'CircleCloseFilled'" /></el-icon>
      <span>{{ connectionTestResult.success ? '✓ 连接成功' : '✗ 连接失败' }}</span>
      <span v-if="connectionTestResult.message" class="result-detail">{{ connectionTestResult.message }}</span>
      <span v-if="connectionTestResult.latency !== undefined" class="result-latency">延迟: {{ connectionTestResult.latency }}ms</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Check, Connection, CircleCheckFilled, CircleCloseFilled } from '@element-plus/icons-vue'
import { getSystemConfigApi, saveSystemConfigApi, testLlmConnectionApi } from '@/api/system'

const saveLoading = ref(false)
const testLoading = ref(false)
const connectionTestResult = ref<{ success: boolean; message?: string; latency?: number } | null>(null)

const config = reactive({
  apiKey: '',
  apiBaseUrl: 'https://api.siliconflow.cn/v1',
  modelName: 'BAAI/bge-m3',
  dimensions: 1024,
})

const handleSave = async () => {
  if (!config.apiKey || !config.apiBaseUrl || !config.modelName) {
    ElMessage.warning('请填写完整的配置信息')
    return
  }
  saveLoading.value = true
  try {
    await saveSystemConfigApi('embedding_model', config)
    ElMessage.success('Embedding 模型配置保存成功')
  } catch (e: any) {
    ElMessage.error(`保存失败: ${e.message || '未知错误'}`)
  } finally {
    saveLoading.value = false
  }
}

const handleTest = async () => {
  if (!config.apiKey) {
    ElMessage.warning('请先输入 API 密钥')
    return
  }
  testLoading.value = true
  connectionTestResult.value = null
  const startTime = Date.now()
  try {
    const { data: testResult } = await testLlmConnectionApi({
      serviceType: 'custom',
      apiKey: config.apiKey,
      apiBaseUrl: config.apiBaseUrl,
      modelName: config.modelName,
      modelType: 'embedding',
    })
    const latency = Date.now() - startTime
    connectionTestResult.value = {
      success: testResult.success,
      message: testResult.message,
      latency,
    }
    if (testResult.success) {
      ElMessage.success('连接测试通过！')
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

onMounted(async () => {
  try {
    const { data } = await getSystemConfigApi('embedding_model')
    const configData = typeof data?.value === 'string' ? JSON.parse(data.value) : (data?.value || data)
    if (configData && typeof configData === 'object') {
      Object.keys(config).forEach(key => {
        if (key in configData && configData[key] != null) {
          (config as any)[key] = configData[key]
        }
      })
    }
  } catch (e) {
    console.error('加载 Embedding 配置失败', e)
  }
})
</script>

<style scoped>
.embedding-tab { display: flex; flex-direction: column; gap: 20px; }
.config-section { }
.section-title { font-size: 15px; font-weight: 600; color: var(--corp-text-primary); margin-bottom: 4px; }
.section-desc { font-size: 13px; color: var(--corp-text-secondary); margin: 0 0 16px; }
.config-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; }
.form-tip { font-size: 12px; color: #94a3b8; margin-top: 4px; }
.action-bar { display: flex; gap: 8px; align-items: center; }

.test-btn {
  border-color: var(--corp-primary);
  color: var(--corp-primary);
}

.test-btn:hover {
  background: var(--color-primary-50);
}

/* 测试结果显示 */
.test-result {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 0;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
}

.test-success {
  background: #F0FDF4;
  border: 1px solid #86EFAC;
  color: #166534;
}

.test-fail {
  background: #FEF2F2;
  border: 1px solid #FCA5A5;
  color: #991B1B;
}

.result-detail {
  font-weight: 400;
  font-size: 13px;
  opacity: 0.8;
}

.result-latency {
  margin-left: auto;
  font-size: 12px;
  padding: 2px 8px;
  background: rgba(0,0,0,0.06);
  border-radius: 4px;
}
</style>
