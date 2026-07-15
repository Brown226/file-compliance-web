<template>
  <div class="llm-profiles">
    <div class="page-header">
      <h2>LLM Provider 配置</h2>
      <el-button type="primary" @click="addProfile">+ 新增配置</el-button>
    </div>

    <el-table :data="profiles" stripe v-loading="loading">
      <el-table-column prop="name" label="名称" width="150" />
      <el-table-column prop="provider" label="供应商" width="120" />
      <el-table-column prop="apiBase" label="API 地址" width="250" show-overflow-tooltip />
      <el-table-column prop="model" label="模型" width="180" />
      <el-table-column label="API Key" width="150">
        <template #default="{ row }">
          <span v-if="row.apiKey" style="font-family: monospace">{{ row.apiKey }}</span>
          <el-tag v-else size="small">无</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag v-if="row.isActive" type="success">默认</el-tag>
          <el-tag v-else-if="row.isEnabled" type="info">启用</el-tag>
          <el-tag v-else type="danger">禁用</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row, $index }">
          <el-button size="small" @click="testConnection(row)">测试</el-button>
          <el-button size="small" @click="editProfile(row, $index)">编辑</el-button>
          <el-button size="small" type="danger" @click="deleteProfile($index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="isEditing ? '编辑配置' : '新增配置'" width="600px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="如：生产环境 DeepSeek" />
        </el-form-item>
        <el-form-item label="供应商">
          <el-select v-model="form.provider" placeholder="选择供应商">
            <el-option label="OpenAI 兼容" value="openai-compat" />
            <el-option label="通义千问" value="tongyi" />
            <el-option label="DeepSeek" value="deepseek" />
            <el-option label="Ollama" value="ollama" />
          </el-select>
        </el-form-item>
        <el-form-item label="API 地址" required>
          <el-input v-model="form.apiBase" placeholder="http://localhost:11434/v1" />
        </el-form-item>
        <el-form-item label="模型名" required>
          <el-input v-model="form.model" placeholder="qwen2.5:7b" />
        </el-form-item>
        <el-form-item label="API Key">
          <el-input v-model="form.apiKey" type="password" show-password placeholder="可选" />
        </el-form-item>
        <el-form-item label="超时(秒)">
          <el-input-number v-model="form.timeout" :min="10" :max="300" />
        </el-form-item>
        <el-form-item label="设为默认">
          <el-switch v-model="form.isActive" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.isEnabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveProfile">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getLlmProfilesApi, saveLlmProfilesApi, testLlmConnectionApi, type LlmProfile } from '@/api/system'

const profiles = ref<LlmProfile[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const isEditing = ref(false)
const editingIndex = ref(-1)
const form = ref<any>({})

onMounted(async () => {
  loading.value = true
  try {
    const res = await getLlmProfilesApi()
    profiles.value = (res as any).data || []
  } catch {
    ElMessage.error('加载 LLM 配置失败')
  } finally {
    loading.value = false
  }
})

function addProfile() {
  isEditing.value = false
  editingIndex.value = -1
  form.value = {
    id: Date.now().toString(),
    name: '',
    provider: 'openai-compat',
    apiBase: '',
    model: '',
    apiKey: '',
    isActive: false,
    isEnabled: true,
    timeout: 60,
    maxRetries: 3,
  }
  dialogVisible.value = true
}

function editProfile(row: LlmProfile, index: number) {
  isEditing.value = true
  editingIndex.value = index
  form.value = { ...row }
  // 脱敏的 key 清空，让用户重新输入
  if (form.value.apiKey && form.value.apiKey.includes('****')) {
    form.value.apiKey = ''
  }
  dialogVisible.value = true
}

async function saveProfile() {
  if (!form.value.name || !form.value.apiBase || !form.value.model) {
    ElMessage.warning('请填写必填项')
    return
  }

  if (isEditing.value && editingIndex.value >= 0) {
    profiles.value[editingIndex.value] = { ...form.value }
  } else {
    profiles.value.push({ ...form.value })
  }

  // 如果设为默认，取消其他默认
  if (form.value.isActive) {
    profiles.value.forEach((p, i) => {
      if (i !== (isEditing.value ? editingIndex.value : profiles.value.length - 1)) {
        p.isActive = false
      }
    })
  }

  try {
    await saveLlmProfilesApi(profiles.value)
    ElMessage.success('保存成功')
    dialogVisible.value = false
    // 重新加载脱敏数据
    const res = await getLlmProfilesApi()
    profiles.value = (res as any).data || []
  } catch {
    ElMessage.error('保存失败')
  }
}

function deleteProfile(index: number) {
  ElMessageBox.confirm('确定删除该配置？').then(async () => {
    profiles.value.splice(index, 1)
    await saveLlmProfilesApi(profiles.value)
    ElMessage.success('已删除')
  }).catch(() => {})
}

async function testConnection(row: LlmProfile) {
  ElMessage.info('正在测试连接...')
  try {
    const res = await testLlmConnectionApi({
      serviceType: row.provider,
      apiKey: row.apiKey || '',
      apiBaseUrl: row.apiBase,
      modelName: row.model,
      modelType: 'chat',
    })
    const data = (res as any).data || res
    if (data.success) {
      ElMessage.success(`连接成功`)
    } else {
      ElMessage.error(data.message || '连接失败')
    }
  } catch {
    ElMessage.error('连接测试失败')
  }
}
</script>

<style scoped>
.llm-profiles {
  padding: 20px;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.page-header h2 {
  margin: 0;
  font-size: 18px;
}
</style>
