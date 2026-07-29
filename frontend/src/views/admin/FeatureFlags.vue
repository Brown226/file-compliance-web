<template>
  <div class="feature-flags-page">
    <div class="page-header">
      <h3>功能管理</h3>
      <p>控制前端功能入口的可见性，支持内测后再开放给用户</p>
    </div>

    <el-table
      v-loading="loading"
      :data="flags"
      border
      stripe
      style="width: 100%"
    >
      <el-table-column label="功能" min-width="200">
        <template #default="{ row }">
          <div class="flag-name">
            <span class="flag-label">{{ row.label }}</span>
            <code class="flag-key">{{ row.key }}</code>
          </div>
        </template>
      </el-table-column>

      <el-table-column prop="description" label="说明" min-width="280" show-overflow-tooltip />

      <el-table-column label="状态" width="120" align="center">
        <template #default="{ row }">
          <el-switch
            :model-value="row.enabled"
            :loading="updatingKey === row.key"
            @change="(val: boolean) => handleToggle(row, val)"
          />
        </template>
      </el-table-column>

      <el-table-column label="最近修改" width="200">
        <template #default="{ row }">
          <div class="flag-meta">
            <span v-if="row.updatedBy">{{ row.updatedBy }}</span>
            <span v-else class="flag-meta-empty">系统默认</span>
            <span class="flag-meta-time">{{ formatTime(row.updatedAt) }}</span>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <el-alert
      v-if="!loading && flags.length === 0"
      title="暂无功能开关数据"
      description="后端 seed 未执行或数据库连接异常"
      type="warning"
      :closable="false"
      show-icon
      style="margin-top: 16px"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getFeatureFlagsApi, updateFeatureFlagApi, type FeatureFlag } from '@/api/system'

const flags = ref<FeatureFlag[]>([])
const loading = ref(false)
const updatingKey = ref<string | null>(null)

const formatTime = (iso: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const loadFlags = async () => {
  loading.value = true
  try {
    const res = await getFeatureFlagsApi()
    flags.value = res.data || []
  } catch (e: any) {
    ElMessage.error('加载功能开关失败: ' + (e.message || e))
  } finally {
    loading.value = false
  }
}

const handleToggle = async (row: FeatureFlag, enabled: boolean) => {
  updatingKey.value = row.key
  try {
    await updateFeatureFlagApi(row.key, enabled)
    row.enabled = enabled
    ElMessage.success(`${row.label} 已${enabled ? '启用' : '禁用'}`)
  } catch (e: any) {
    ElMessage.error('更新失败: ' + (e.message || e))
    // 失败时不更新 row.enabled，switch 会自动回弹
  } finally {
    updatingKey.value = null
  }
}

onMounted(loadFlags)
</script>

<style scoped>
.feature-flags-page {
  padding: 4px 0;
}

.page-header {
  margin-bottom: 20px;
}

.page-header h3 {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.page-header p {
  margin: 0;
  font-size: 13px;
  color: #6b7280;
}

.flag-name {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.flag-label {
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
}

.flag-key {
  font-size: 12px;
  color: #6b7280;
  background: #f3f4f6;
  padding: 1px 6px;
  border-radius: 4px;
  width: fit-content;
}

.flag-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: #6b7280;
}

.flag-meta-empty {
  color: #d1d5db;
}

.flag-meta-time {
  font-size: 11px;
  color: #9ca3af;
}
</style>
