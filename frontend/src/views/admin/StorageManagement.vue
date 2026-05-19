<template>
  <div class="storage-management">
    <div class="page-header">
      <div class="header-left">
        <h2>存储管理</h2>
      </div>
    </div>

    <div class="storage-panel">
      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <span><el-icon><Files /></el-icon> 存储空间统计</span>
            <el-button type="primary" @click="fetchStorageStats" :loading="storageLoading">
              <el-icon><RefreshRight /></el-icon> 刷新
            </el-button>
          </div>
        </template>

        <div class="storage-overview" v-loading="storageLoading">
          <div class="storage-total">
            <div class="total-main">
              <span class="total-icon"><el-icon><Folder /></el-icon></span>
              <div class="total-info">
                <span class="total-value">{{ storageStats.totalSizeMB || '0' }}</span>
                <span class="total-unit">MB</span>
              </div>
            </div>
            <div class="total-label">总占用空间</div>
          </div>

          <div class="storage-progress">
            <div class="progress-bar">
              <div class="progress-used" :style="{ width: storageStats.referencedPercent || '0%' }"></div>
              <div class="progress-orphaned" :style="{ width: storageStats.orphanedPercent || '0%' }"></div>
            </div>
            <div class="progress-legend">
              <span class="legend-item referenced">
                <span class="legend-dot"></span>
                有效文件 {{ storageStats.referencedSizeMB || '0' }} MB
              </span>
              <span class="legend-item orphaned">
                <span class="legend-dot"></span>
                孤立文件 {{ storageStats.orphanedSizeMB || '0' }} MB
              </span>
            </div>
          </div>
        </div>

        <div class="storage-stats" v-loading="storageLoading">
          <div class="stat-card referenced">
            <div class="stat-icon referenced-icon"><el-icon><Document /></el-icon></div>
            <div class="stat-info">
              <div class="stat-value">{{ storageStats.referencedSizeMB || '0' }} MB</div>
              <div class="stat-label">有效文件</div>
              <div class="stat-count">{{ storageStats.referencedFiles || 0 }} 个文件</div>
            </div>
          </div>

          <div class="stat-card orphaned" :class="{ 'has-orphaned': storageStats.orphanedFiles > 0 }">
            <div class="stat-icon orphaned-icon"><el-icon><Delete /></el-icon></div>
            <div class="stat-info">
              <div class="stat-value">{{ storageStats.orphanedSizeMB || '0' }} MB</div>
              <div class="stat-label">孤立文件</div>
              <div class="stat-count">{{ storageStats.orphanedFiles || 0 }} 个文件</div>
            </div>
          </div>
        </div>

        <div v-if="storageStats.orphanedFiles > 0" class="cleanup-section">
          <el-alert type="warning" :closable="false" show-icon>
            <template #title>
              检测到 <strong>{{ storageStats.orphanedFiles }} 个孤立文件</strong>，占用 <strong>{{ storageStats.orphanedSizeMB }} MB</strong> 空间
            </template>
          </el-alert>

          <div class="cleanup-actions">
            <el-form inline>
              <el-form-item label="保留期限">
                <el-select v-model="cleanupDays" style="width: 120px">
                  <el-option :value="1" label="1天前" />
                  <el-option :value="3" label="3天前" />
                  <el-option :value="7" label="7天前" />
                  <el-option :value="30" label="30天前" />
                </el-select>
              </el-form-item>
              <el-form-item>
                <el-button type="danger" @click="handleCleanup" :loading="cleanupLoading">
                  <el-icon><Delete /></el-icon> 清理孤立文件
                </el-button>
              </el-form-item>
            </el-form>
          </div>
        </div>

        <div v-else-if="!storageLoading" class="no-orphaned">
          <el-icon color="#67c23a" :size="32"><CircleCheckFilled /></el-icon>
          <span>存储空间使用正常，暂无孤立文件</span>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { RefreshRight, Files, Folder, Document, Delete, CircleCheckFilled } from '@element-plus/icons-vue'
import { getStorageStatsApi, cleanupFilesApi, type StorageStats } from '@/api/system'
import { useUserStore } from '@/stores/user'

const storageLoading = ref(false)
const cleanupLoading = ref(false)
const cleanupDays = ref(7)
const storageStats = ref<StorageStats & { referencedPercent?: string; orphanedPercent?: string }>({} as any)

const fetchStorageStats = async () => {
  const userStore = useUserStore()
  if (!userStore.token) return

  storageLoading.value = true
  try {
    const { data } = await getStorageStatsApi()
    const stats: StorageStats = data || {} as StorageStats
    storageStats.value = {
      ...stats,
      referencedPercent: stats.totalSize > 0
        ? ((stats.referencedSize / stats.totalSize) * 100).toFixed(1) + '%'
        : '0%',
      orphanedPercent: stats.totalSize > 0
        ? ((stats.orphanedSize / stats.totalSize) * 100).toFixed(1) + '%'
        : '0%',
    }
  } catch (e: any) {
    if (e.response?.status !== 401) {
      ElMessage.error('获取存储统计失败')
    }
  } finally {
    storageLoading.value = false
  }
}

const handleCleanup = async () => {
  if (storageStats.value.orphanedFiles <= 0) {
    ElMessage.warning('暂无孤立文件需要清理')
    return
  }

  try {
    await ElMessageBox.confirm(
      `确认清理 ${cleanupDays.value} 天前的孤立文件吗？这将释放约 ${storageStats.value.orphanedSizeMB} MB 空间。`,
      '清理确认',
      { type: 'warning' }
    )
  } catch { return }

  cleanupLoading.value = true
  try {
    const { data } = await cleanupFilesApi(cleanupDays.value)
    ElMessage.success(`清理完成：删除了 ${data.deleted} 个文件，释放了 ${(data.freedSpace / 1024 / 1024).toFixed(2)} MB 空间`)
    fetchStorageStats()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '清理失败')
  } finally {
    cleanupLoading.value = false
  }
}

onMounted(() => {
  fetchStorageStats()
})
</script>

<style scoped>
.storage-management {
  padding: 20px;
  height: calc(100vh - 80px);
  overflow-y: auto;
}
.page-header { margin-bottom: 20px; }
.page-header h2 { font-size: 20px; font-weight: 600; color: var(--corp-text-primary); margin: 0; }
.storage-panel { max-width: 900px; }
.storage-overview {
  display: flex; align-items: center; gap: 32px; padding: 24px; margin-bottom: 20px;
  background: linear-gradient(135deg, rgba(64,158,255,0.06), rgba(64,158,255,0.02));
  border: 1px solid rgba(64,158,255,0.1); border-radius: 12px;
}
.storage-total { text-align: center; min-width: 120px; }
.total-main { display: flex; align-items: baseline; justify-content: center; gap: 4px; }
.total-icon { font-size: 20px; color: #409eff; margin-right: 4px; }
.total-value { font-size: 36px; font-weight: 700; color: var(--corp-primary, #2563eb); line-height: 1; }
.total-unit { font-size: 16px; font-weight: 500; color: var(--el-text-color-secondary); }
.total-label { font-size: 13px; color: var(--el-text-color-secondary); margin-top: 4px; }
.storage-progress { flex: 1; }
.progress-bar { height: 12px; background: var(--el-fill-color-light); border-radius: 6px; overflow: hidden; display: flex; }
.progress-used { background: linear-gradient(90deg, #67c23a, #85ce61); transition: width 0.3s ease; }
.progress-orphaned { background: linear-gradient(90deg, #e6a23c, #f5c76a); transition: width 0.3s ease; }
.progress-legend { display: flex; gap: 24px; margin-top: 8px; font-size: 12px; }
.legend-item { display: flex; align-items: center; gap: 6px; color: var(--el-text-color-secondary); }
.legend-dot { width: 8px; height: 8px; border-radius: 50%; }
.legend-item.referenced .legend-dot { background: #67c23a; }
.legend-item.orphaned .legend-dot { background: #e6a23c; }
.storage-stats { display: flex; gap: 16px; margin-bottom: 16px; }
.stat-card { flex: 1; display: flex; align-items: center; gap: 14px; padding: 16px; border-radius: 10px; background: var(--el-fill-color-light); border: 1px solid var(--el-border-color-lighter); }
.stat-icon { width: 42px; height: 42px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; }
.referenced-icon { background: rgba(103,194,58,0.1); color: #67c23a; }
.orphaned-icon { background: rgba(230,162,60,0.1); color: #e6a23c; }
.stat-card.has-orphaned { border-color: rgba(230,162,60,0.3); background: rgba(230,162,60,0.04); }
.stat-info { flex: 1; }
.stat-value { font-size: 20px; font-weight: 700; color: var(--corp-text-primary); line-height: 1.2; }
.stat-label { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 2px; }
.stat-count { font-size: 11px; color: var(--el-text-color-secondary); margin-top: 2px; }
.cleanup-section { margin-top: 16px; }
.cleanup-actions { margin-top: 16px; display: flex; align-items: center; gap: 16px; }
.no-orphaned { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 24px; color: var(--el-text-color-secondary); font-size: 14px; }
.card-header { display: flex; justify-content: space-between; align-items: center; font-weight: 600; color: var(--corp-text-primary); }
</style>
