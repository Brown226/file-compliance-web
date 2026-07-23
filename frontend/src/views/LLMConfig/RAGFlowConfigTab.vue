<template>
  <div class="ragflow-config-tab">
    <!-- 说明横幅 -->
    <div class="info-banner">
      <div class="banner-icon">🔍</div>
      <div class="banner-content">
        <div class="banner-title">RAGFlow 知识库集成</div>
        <div class="banner-desc">
          作为第二个知识库检索提供方，与 MaxKB 并列。审查时可同时/单独使用两个检索源，提升召回覆盖率。
        </div>
      </div>
      <el-tag v-if="ragflowStatus.reachable" type="success" size="large" effect="dark">
        <el-icon><Check /></el-icon> 已连接
      </el-tag>
      <el-tag v-else-if="touched" type="warning" size="large" effect="plain">
        <el-icon><Clock /></el-icon> 未连接
      </el-tag>
      <el-tag v-else type="info" size="large" effect="plain">未配置</el-tag>
    </div>

    <!-- 配置区域 -->
    <div class="config-section">
      <div class="section-title">
        <el-icon><Setting /></el-icon>
        <span>连接配置</span>
      </div>

      <div class="config-card">
        <el-form :model="form" label-width="130px" label-position="left">
          <el-form-item label="RAGFlow 地址">
            <el-input v-model="form.baseUrl" placeholder="http://10.102.2.40:9380" clearable>
              <template #append>
                <el-button @click="testConnection" :loading="testLoading" class="test-btn-small">检测</el-button>
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
            <div class="form-tip">低于该分数的段落将被过滤，默认 0.2（RAGFlow 推荐值）</div>
          </el-form-item>
        </el-form>
      </div>
    </div>

    <!-- OPT-040: 双源协同策略 -->
    <div class="config-section">
      <div class="section-title">
        <el-icon><Connection /></el-icon>
        <span>双源协同策略</span>
      </div>

      <div class="config-card">
        <el-form :model="form" label-width="130px" label-position="left">
          <el-form-item label="优先级策略">
            <el-radio-group v-model="form.priority">
              <el-radio value="parallel">双源并重</el-radio>
              <el-radio value="maxkb_first">MaxKB 优先</el-radio>
              <el-radio value="ragflow_first">RAGFlow 优先</el-radio>
            </el-radio-group>
            <div class="form-tip">
              双源并重：合并后按相似度统一排序；MaxKB/RAGFlow 优先：该源结果全保留，另一源仅填充
            </div>
          </el-form-item>

          <el-form-item label="RAGFlow 权重">
            <el-input-number v-model="form.ragflowWeight" :min="0.1" :max="2" :step="0.1" :precision="2" />
            <div class="form-tip">RAGFlow 相似度分数乘以该权重后与 MaxKB 比较（MaxKB 始终 1.0），用于校正两源分数尺度差异</div>
          </el-form-item>

          <el-form-item label="结果去重">
            <el-switch v-model="form.dedupEnabled" />
            <div class="form-tip">按"文档名 + 内容前 100 字"指纹去重，保留相似度更高的那条</div>
          </el-form-item>
        </el-form>

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

    <el-alert
      v-if="touched && !ragflowStatus.reachable"
      title="RAGFlow 服务不可达"
      description="请确认地址/端口正确、服务已启动、API Key 有效。"
      type="error"
      show-icon
      :closable="false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Check, Clock, Setting, Refresh, Connection } from '@element-plus/icons-vue'
import { getSystemConfigApi, saveSystemConfigApi } from '@/api/system'

const CONFIG_KEY = 'ragflow_config'

const form = reactive({
  baseUrl: '',
  apiKey: '',
  similarityThreshold: 0.2,
  // OPT-040: 双源协同策略
  priority: 'parallel' as 'parallel' | 'maxkb_first' | 'ragflow_first',
  ragflowWeight: 1.0,
  dedupEnabled: true,
})

const touched = ref(false)
const testLoading = ref(false)
const saveLoading = ref(false)
const loadLoading = ref(false)
const ragflowStatus = reactive({ reachable: false })

const loadConfig = async () => {
  loadLoading.value = true
  try {
    const { data } = await getSystemConfigApi(CONFIG_KEY)
    if (data) {
      form.baseUrl = data.baseUrl || ''
      form.apiKey = data.apiKey || ''
      form.similarityThreshold = typeof data.similarityThreshold === 'number' ? data.similarityThreshold : 0.2
      // OPT-040: 双源协同策略
      form.priority = data.priority === 'maxkb_first' || data.priority === 'ragflow_first' ? data.priority : 'parallel'
      form.ragflowWeight = typeof data.ragflowWeight === 'number' && data.ragflowWeight > 0 ? data.ragflowWeight : 1.0
      form.dedupEnabled = typeof data.dedupEnabled === 'boolean' ? data.dedupEnabled : true
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
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      similarityThreshold: form.similarityThreshold,
      priority: form.priority,
      ragflowWeight: form.ragflowWeight,
      dedupEnabled: form.dedupEnabled,
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
.info-banner {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 22px;
  border-radius: 14px;
  background: linear-gradient(135deg, #0f766e 0%, #134e4a 100%);
  color: #f0fdfa;
}
.banner-icon { font-size: 30px; }
.banner-content { flex: 1; }
.banner-title { font-size: 17px; font-weight: 700; margin-bottom: 4px; }
.banner-desc { font-size: 13px; opacity: 0.85; line-height: 1.6; }
.config-section { margin-top: 22px; }
.section-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 15px; font-weight: 600; color: #1f2937; margin-bottom: 14px;
}
.config-card {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
  padding: 22px 26px; max-width: 720px;
}
.form-tip { font-size: 12px; color: #9ca3af; margin-top: 4px; line-height: 1.5; }
.form-actions { margin-top: 18px; display: flex; gap: 12px; }
:deep(.test-btn-small) { font-size: 12px; padding: 0 12px; }
</style>
