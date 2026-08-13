<template>
  <div class="ragflow-config-tab">
    <!-- 模块标题栏 -->
    <div class="module-header">
      <div class="module-title">
        <el-icon :size="18"><Connection /></el-icon>
        <div>
          <h4>RAGFlow 知识库集成</h4>
          <span class="module-desc">第二检索源，与 MaxKB 并列以提升召回覆盖率</span>
        </div>
      </div>
      <span
        class="module-status"
        :class="ragflowStatus.reachable ? 'ready' : touched ? 'pending' : 'offline'"
      >
        {{ ragflowStatus.reachable ? '已连接' : touched ? '未连接' : '未配置' }}
      </span>
    </div>

    <!-- 连接配置 -->
    <div class="module-body">
      <el-form :model="form" label-width="110px" label-position="left">
        <el-form-item label="RAGFlow 地址">
          <el-input v-model="form.baseUrl" placeholder="http://10.102.2.40:9380" clearable>
            <template #append>
              <el-button @click="testConnection" :loading="testLoading">检测</el-button>
            </template>
          </el-input>
          <div class="form-tip">内网 RAGFlow 服务地址，默认端口 9380</div>
        </el-form-item>

        <el-form-item label="API Key">
          <el-input v-model="form.apiKey" type="password" placeholder="ragflow-xxxxxxxx" show-password />
          <div class="form-tip">RAGFlow 控制台 → API 页面获取的 API Key</div>
        </el-form-item>

        <el-form-item label="相似度阈值">
          <el-input-number v-model="form.similarityThreshold" :min="0" :max="1" :step="0.05" :precision="2" />
          <div class="form-tip">低于该分数的段落将被过滤，默认 0.2</div>
        </el-form-item>
      </el-form>

      <div v-if="touched && !ragflowStatus.reachable" class="offline-hint">
        RAGFlow 服务不可达，请确认地址/端口正确、服务已启动、API Key 有效。
      </div>

      <div class="form-actions">
        <el-button @click="handleSave" :loading="saveLoading" type="primary">
          <el-icon><Check /></el-icon>
          保存配置
        </el-button>
        <el-button @click="loadConfig" :loading="loadLoading">
          <el-icon><Refresh /></el-icon>
          重新加载
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Check, Refresh, Connection } from '@element-plus/icons-vue'
import { getSystemConfigApi, saveSystemConfigApi } from '@/api/system'

const CONFIG_KEY = 'ragflow_config'

const form = reactive({
  baseUrl: '',
  apiKey: '',
  similarityThreshold: 0.2,
})

const fullConfig = ref<Record<string, any>>({})
const touched = ref(false)
const testLoading = ref(false)
const saveLoading = ref(false)
const loadLoading = ref(false)
const ragflowStatus = reactive({ reachable: false })

const loadConfig = async () => {
  loadLoading.value = true
  try {
    const { data } = await getSystemConfigApi(CONFIG_KEY)
    fullConfig.value = data || {}
    if (data) {
      form.baseUrl = data.baseUrl || ''
      form.apiKey = data.apiKey || ''
      form.similarityThreshold = typeof data.similarityThreshold === 'number' ? data.similarityThreshold : 0.2
      touched.value = !!(form.baseUrl && form.apiKey)
    }
  } catch {
    /* 静默：未配置过 */
  } finally {
    loadLoading.value = false
  }
}

const testConnection = async () => {
  if (!form.baseUrl || !form.apiKey) {
    ElMessage.warning('请先填写地址和 API Key')
    return
  }
  testLoading.value = true
  try {
    const url = `${form.baseUrl.replace(/\/+$/, '')}/api/v1/datasets`
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${form.apiKey}` },
    })
    const data = await resp.json().catch(() => null)
    if (resp.ok && (data?.data || data?.code === 0)) {
      ragflowStatus.reachable = true
      touched.value = true
      ElMessage.success('RAGFlow 连接成功')
    } else {
      ragflowStatus.reachable = false
      touched.value = true
      ElMessage.error(`连接失败：${data?.message || resp.status}`)
    }
  } catch (e: any) {
    ragflowStatus.reachable = false
    touched.value = true
    ElMessage.error(`连接异常：${e.message}`)
  } finally {
    testLoading.value = false
  }
}

const handleSave = async () => {
  if (!form.baseUrl || !form.apiKey) {
    ElMessage.warning('地址和 API Key 不能为空')
    return
  }
  saveLoading.value = true
  try {
    await saveSystemConfigApi(CONFIG_KEY, {
      ...fullConfig.value,
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      similarityThreshold: form.similarityThreshold,
    })
    touched.value = true
    ElMessage.success('RAGFlow 配置已保存')
    await testConnection()
  } catch (e: any) {
    ElMessage.error(`保存失败：${e.message}`)
  } finally {
    saveLoading.value = false
  }
}

onMounted(loadConfig)
</script>

<style scoped>
.ragflow-config-tab {
  display: flex;
  flex-direction: column;
}

/* 模块标题栏 */
.module-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-gray-100);
  background: var(--corp-bg-sunken);
}

.module-title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.module-title :deep(.el-icon) {
  color: var(--corp-text-secondary);
  flex-shrink: 0;
}

.module-title h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.module-desc {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--corp-text-tertiary);
}

.module-status {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  flex-shrink: 0;
}

.module-status.ready {
  background: var(--color-success-bg);
  color: var(--color-success-text);
}

.module-status.pending {
  background: var(--color-warning-bg);
  color: var(--color-warning-text);
}

.module-status.offline {
  background: var(--color-gray-100);
  color: var(--corp-text-secondary);
}

/* 模块主体 */
.module-body {
  padding: 16px 20px 18px;
}

.form-tip {
  font-size: 12px;
  color: var(--corp-text-secondary);
  margin-top: 4px;
  line-height: 1.5;
}

.offline-hint {
  margin: 8px 0 12px;
  padding: 8px 12px;
  background: var(--color-danger-bg);
  border: 1px solid var(--color-danger-bg); /* 原 #fecaca 浅红边框，对齐 --color-danger-bg */
  border-radius: 6px;
  font-size: 12px;
  color: var(--color-danger-text);
}

.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid var(--color-gray-100);
  margin-top: 4px;
}

@media (max-width: 640px) {
  .module-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
}
</style>
