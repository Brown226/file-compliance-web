<template>
  <div class="basic-settings">
    <div class="page-header">
      <div class="header-left">
        <h2>基础设置</h2>
      </div>
    </div>

    <el-card shadow="never">
      <template #header><span style="font-weight: 600;">系统基础设置</span></template>
      <el-form :model="basicSettings" label-width="150px" label-position="left" style="max-width: 640px;">
        <div class="form-group-title">通用设置</div>
        <el-form-item label="系统名称">
          <el-input v-model="basicSettings.systemName" placeholder="核审通" />
        </el-form-item>
        <el-form-item label="文件上传大小限制 (MB)">
          <el-input-number v-model="basicSettings.maxUploadSizeMB" :min="1" :max="500" />
        </el-form-item>
        <el-form-item label="自动清理天数">
          <el-input-number v-model="basicSettings.autoCleanupDays" :min="0" :max="365" />
          <div class="form-tip">0 表示不自动清理。已完成任务的文件在指定天数后自动删除。</div>
        </el-form-item>
        <div class="form-group-title">性能设置</div>
        <el-form-item label="全局并发上限">
          <el-input-number v-model="basicSettings.globalConcurrencyLimit" :min="1" :max="20" />
          <div class="form-tip">同时处理的审查任务总数上限，超出的任务进入排队。</div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSaveBasicSettings" :loading="basicSettingsSaving">保存设置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" style="margin-top: 16px;">
      <template #header>
        <div class="svc-header">
          <span style="font-weight: 600;">服务状态</span>
          <el-button size="small" @click="refreshServiceStatus" :loading="refreshingStatus">
            <el-icon><RefreshRight /></el-icon> 刷新
          </el-button>
        </div>
      </template>
      <el-table :data="serviceStatuses" v-loading="statusLoading" size="small">
        <el-table-column prop="name" label="服务名称" min-width="200">
          <template #default="{ row }">
            <span class="svc-table-name">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="row.reachable ? 'success' : 'danger'" size="small">
              {{ row.reachable ? '正常' : '不可达' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="error" label="错误信息" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.error" class="svc-table-error">{{ row.error }}</span>
            <span v-else class="svc-table-ok">—</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { RefreshRight } from '@element-plus/icons-vue'
import { getSystemConfigApi, saveSystemConfigApi } from '@/api/system'
import { useSystemConfigStore } from '@/stores/system-config'

const systemConfigStore = useSystemConfigStore()

const basicSettingsSaving = ref(false)
const basicSettings = reactive({
  systemName: '核审通',
  maxUploadSizeMB: 100,
  autoCleanupDays: 0,
  globalConcurrencyLimit: 5,
})

const serviceStatuses = ref<Array<{ name: string; reachable: boolean; error?: string }>>([])
const statusLoading = ref(false)
const refreshingStatus = ref(false)

const handleSaveBasicSettings = async () => {
  basicSettingsSaving.value = true
  try {
    await saveSystemConfigApi('basic_settings', basicSettings)
    systemConfigStore.loadSystemName()
    ElMessage.success('基础设置已保存')
  } catch (e: any) {
    ElMessage.error(`保存失败: ${e.message || '未知错误'}`)
  } finally {
    basicSettingsSaving.value = false
  }
}

const loadBasicSettings = async () => {
  try {
    const { data } = await getSystemConfigApi('basic_settings')
    const v = typeof data?.value === 'string' ? JSON.parse(data.value) : (data?.value || {})
    if (v && typeof v === 'object') {
      if (v.systemName) basicSettings.systemName = v.systemName
      if (v.maxUploadSizeMB) basicSettings.maxUploadSizeMB = v.maxUploadSizeMB
      if (v.autoCleanupDays != null) basicSettings.autoCleanupDays = v.autoCleanupDays
      if (v.globalConcurrencyLimit) basicSettings.globalConcurrencyLimit = v.globalConcurrencyLimit
    }
  } catch {}
}

const loadServiceStatuses = async () => {
  statusLoading.value = true
  try {
    const { data } = await fetch('/api/system/health').then(r => r.json())
    serviceStatuses.value = data?.services || []
  } catch {
    serviceStatuses.value = []
  } finally {
    statusLoading.value = false
  }
}

const refreshServiceStatus = async () => {
  refreshingStatus.value = true
  try {
    const { data } = await fetch('/api/system/health').then(r => r.json())
    serviceStatuses.value = data?.services || []
    ElMessage.success('服务状态已刷新')
  } catch {
    ElMessage.error('获取服务状态失败')
  } finally {
    refreshingStatus.value = false
  }
}

onMounted(() => {
  loadBasicSettings()
  loadServiceStatuses()
})
</script>

<style scoped>
.basic-settings {
  padding: 20px;
  height: calc(100vh - 80px);
  overflow-y: auto;
}
.page-header { margin-bottom: 20px; }
.page-header h2 { font-size: 20px; font-weight: 600; color: var(--corp-text-primary); margin: 0; }
.form-tip { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 4px; }
.form-group-title { font-size: 13px; font-weight: 600; color: var(--el-text-color-primary); margin: 0 0 12px 0; padding: 6px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.svc-header { display: flex; justify-content: space-between; align-items: center; }
.svc-table-name { font-weight: 500; color: var(--el-text-color-primary); }
.svc-table-error { font-size: 12px; color: var(--el-color-danger); }
.svc-table-ok { color: var(--el-text-color-placeholder); }
</style>
