<template>
  <div class="reranker-tab">
    <div class="config-section">
      <div class="section-title">Reranker 模型配置</div>
      <p class="section-desc">用于检索结果重排序，提升知识库检索精度。配置后三阶段混合检索自动生效。</p>

      <div class="config-card">
        <el-form :model="config" label-width="120px" label-position="left">
          <el-form-item label="API 密钥">
            <el-input v-model="config.apiKey" type="password" placeholder="sk-..." show-password clearable />
            <div class="form-tip">通常与 Embedding 模型使用相同的 API Key</div>
          </el-form-item>

          <el-form-item label="API 基础 URL">
            <el-input v-model="config.apiBaseUrl" placeholder="https://api.siliconflow.cn/v1" clearable />
          </el-form-item>

          <el-form-item label="模型名称">
            <el-select v-model="config.modelName" filterable allow-create default-first-option style="width: 100%">
              <el-option label="BAAI/bge-reranker-v2-m3" value="BAAI/bge-reranker-v2-m3" />
              <el-option label="BAAI/bge-reranker-large" value="BAAI/bge-reranker-large" />
            </el-select>
            <div class="form-tip">推荐 BAAI/bge-reranker-v2-m3</div>
          </el-form-item>
        </el-form>
      </div>
    </div>

    <div class="action-bar">
      <el-button type="primary" @click="handleSave" :loading="saveLoading">保存配置</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getSystemConfigApi, saveSystemConfigApi } from '@/api/system'

const saveLoading = ref(false)

const config = reactive({
  apiKey: '',
  apiBaseUrl: 'https://api.siliconflow.cn/v1',
  modelName: 'BAAI/bge-reranker-v2-m3',
})

const handleSave = async () => {
  saveLoading.value = true
  try {
    await saveSystemConfigApi('reranker_model', config)
    ElMessage.success('Reranker 模型配置保存成功')
  } catch (e: any) {
    ElMessage.error(`保存失败: ${e.message || '未知错误'}`)
  } finally {
    saveLoading.value = false
  }
}

onMounted(async () => {
  try {
    const { data } = await getSystemConfigApi('reranker_model')
    const configData = typeof data?.value === 'string' ? JSON.parse(data.value) : (data?.value || data)
    if (configData && typeof configData === 'object') {
      Object.keys(config).forEach(key => {
        if (key in configData && configData[key] != null) {
          (config as any)[key] = configData[key]
        }
      })
    }
  } catch (e) {
    console.error('加载 Reranker 配置失败', e)
  }
})
</script>

<style scoped>
.reranker-tab { display: flex; flex-direction: column; gap: 20px; }
.config-section { }
.section-title { font-size: 15px; font-weight: 600; color: var(--corp-text-primary); margin-bottom: 4px; }
.section-desc { font-size: 13px; color: var(--corp-text-secondary); margin: 0 0 16px; }
.config-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; }
.form-tip { font-size: 12px; color: #94a3b8; margin-top: 4px; }
.action-bar { display: flex; gap: 8px; }
</style>
