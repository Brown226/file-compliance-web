<template>
  <div class="storage-management">
    <div class="page-intro">
      <h3>存储管理</h3>
      <p>查看系统上传文件存储路径、空间占用统计，并清理不再被引用的孤立文件。</p>
    </div>

    <div class="storage-grid">
      <!-- 路径配置 -->
      <section class="settings-card path-card">
        <div class="card-header">
          <div class="header-title">
            <el-icon><FolderOpened /></el-icon>
            <span>存储路径配置</span>
          </div>
          <el-button type="primary" size="small" @click="showEditDialog = true" :loading="pathLoading">
            <el-icon><Edit /></el-icon>
            修改路径
          </el-button>
        </div>
        <div class="card-body">
          <div class="path-row">
            <span class="path-label">当前路径</span>
            <el-tooltip :content="pathConfig.effective" placement="top">
              <span class="path-value">{{ pathConfig.effective }}</span>
            </el-tooltip>
          </div>
        </div>
      </section>

      <!-- 总览 -->
      <section class="settings-card stats-card">
        <div class="card-header">
          <div class="header-title">
            <el-icon><Files /></el-icon>
            <span>存储空间统计</span>
          </div>
          <el-button size="small" @click="fetchStorageStats" :loading="storageLoading">
            <el-icon><RefreshRight /></el-icon>
            刷新
          </el-button>
        </div>
        <div class="card-body">
          <div class="overview" v-loading="storageLoading">
            <div class="total-block">
              <div class="total-value">
                <span>{{ storageStats.totalSizeMB || '0' }}</span>
                <span class="total-unit">MB</span>
              </div>
              <div class="total-label">总占用空间</div>
            </div>

            <div class="progress-block">
              <div class="progress-track">
                <div class="progress-used" :style="{ width: storageStats.referencedPercent || '0%' }"></div>
                <div class="progress-orphaned" :style="{ width: storageStats.orphanedPercent || '0%' }"></div>
              </div>
              <div class="progress-legend">
                <div class="legend-item">
                  <span class="legend-dot used"></span>
                  <span class="legend-label">有效文件</span>
                  <span class="legend-value">{{ storageStats.referencedSizeMB || '0' }} MB</span>
                </div>
                <div class="legend-item">
                  <span class="legend-dot orphaned"></span>
                  <span class="legend-label">孤立文件</span>
                  <span class="legend-value">{{ storageStats.orphanedSizeMB || '0' }} MB</span>
                </div>
              </div>
            </div>
          </div>

          <div class="stat-detail-grid" v-loading="storageLoading">
            <div class="detail-card referenced">
              <div class="detail-icon"><el-icon><Document /></el-icon></div>
              <div class="detail-info">
                <div class="detail-value">{{ storageStats.referencedSizeMB || '0' }} <span class="detail-unit">MB</span></div>
                <div class="detail-label">有效文件</div>
                <div class="detail-count">{{ storageStats.referencedFiles || 0 }} 个</div>
              </div>
            </div>

            <div class="detail-card orphaned" :class="{ 'has-orphaned': storageStats.orphanedFiles > 0 }">
              <div class="detail-icon"><el-icon><Delete /></el-icon></div>
              <div class="detail-info">
                <div class="detail-value">{{ storageStats.orphanedSizeMB || '0' }} <span class="detail-unit">MB</span></div>
                <div class="detail-label">孤立文件</div>
                <div class="detail-count">{{ storageStats.orphanedFiles || 0 }} 个</div>
              </div>
            </div>
          </div>

          <!-- 清理区 -->
          <div v-if="storageStats.orphanedFiles > 0" class="cleanup-box">
            <div class="cleanup-info">
              <span class="cleanup-title">检测到 {{ storageStats.orphanedFiles }} 个孤立文件</span>
              <span class="cleanup-desc">占用 {{ storageStats.orphanedSizeMB }} MB 空间，可安全清理以释放磁盘。</span>
            </div>
            <div class="cleanup-actions">
              <el-select v-model="cleanupDays" style="width: 120px">
                <el-option :value="1" label="1天前" />
                <el-option :value="3" label="3天前" />
                <el-option :value="7" label="7天前" />
                <el-option :value="30" label="30天前" />
              </el-select>
              <el-button type="danger" @click="handleCleanup" :loading="cleanupLoading">
                <el-icon><Delete /></el-icon>
                清理孤立文件
              </el-button>
            </div>
          </div>

          <div v-else-if="!storageLoading" class="no-orphaned">
            <el-icon :size="32"><CircleCheckFilled /></el-icon>
            <span>存储空间使用正常，暂无孤立文件</span>
          </div>
        </div>
      </section>
    </div>

    <el-dialog v-model="showEditDialog" title="修改存储路径" width="520px" :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="90px">
        <el-form-item label="存储路径" prop="path">
          <el-input v-model="form.path" placeholder="请输入绝对路径，如 /data/uploads" />
        </el-form-item>
        <el-form-item label="初始化目录">
          <el-checkbox v-model="form.initDirs" checked>
            创建子目录结构（knowledge, feedback, selfcheck 等）
          </el-checkbox>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditDialog = false">取消</el-button>
        <el-button type="primary" @click="handleSavePath" :loading="savePathLoading">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  RefreshRight, Files, FolderOpened, Document, Delete,
  CircleCheckFilled, Edit
} from '@element-plus/icons-vue'
import {
  getStorageStatsApi, cleanupFilesApi, getUploadPathConfigApi, setUploadPathConfigApi,
  type StorageStats, type UploadPathConfig
} from '@/api/system'
import { useUserStore } from '@/stores/user'

const storageLoading = ref(false)
const cleanupLoading = ref(false)
const pathLoading = ref(false)
const savePathLoading = ref(false)
const cleanupDays = ref(7)
const storageStats = ref<StorageStats & { referencedPercent?: string; orphanedPercent?: string }>({} as any)
const pathConfig = ref<UploadPathConfig>({ effective: '' })
const showEditDialog = ref(false)

const form = reactive({ path: '', initDirs: true })
const formRules = {
  path: [
    { required: true, message: '请输入存储路径', trigger: 'blur' },
    { pattern: /^\//, message: '路径必须为以 / 开头的绝对路径', trigger: 'blur' },
  ],
}

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

const fetchPathConfig = async () => {
  const userStore = useUserStore()
  if (!userStore.token) return
  pathLoading.value = true
  try {
    const { data } = await getUploadPathConfigApi()
    pathConfig.value = data
    form.path = data.effective
  } catch {
  } finally {
    pathLoading.value = false
  }
}

const handleSavePath = async () => {
  savePathLoading.value = true
  try {
    const { data } = await setUploadPathConfigApi(form.path)

    let msg = `存储路径已变更为 ${data.newPath}`
    if (data.warning) msg += '。' + data.warning

    await ElMessageBox.alert(msg, '路径变更成功', {
      type: data.filesAtOldPath > 0 ? 'warning' : 'success',
      confirmButtonText: '知道了',
    })

    showEditDialog.value = false
    fetchPathConfig()
    fetchStorageStats()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '保存失败')
  } finally {
    savePathLoading.value = false
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
  fetchPathConfig()
  fetchStorageStats()
})
</script>

<style scoped>
.storage-management {
  padding: 20px 24px 32px;
  max-width: 900px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-intro {
  padding: 4px 0 4px 12px;
  border-left: 3px solid var(--color-primary-600);
}

.page-intro h3 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.page-intro p {
  margin: 0;
  font-size: 12.5px;
  color: var(--corp-text-secondary);
  line-height: 1.5;
}

/* 通用卡片 */
.settings-card {
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  overflow: hidden;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-gray-100);
  background: var(--corp-bg-sunken);
}

.header-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.header-title :deep(.el-icon) {
  color: var(--corp-text-secondary);
}

.card-body {
  padding: 18px 20px;
}

/* 路径卡片 */
.path-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.path-label {
  font-size: 12px;
  color: var(--corp-text-tertiary);
  white-space: nowrap;
  padding-top: 2px;
}

.path-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--corp-text-primary);
  word-break: break-all;
  line-height: 1.5;
}

/* 总览 */
.overview {
  display: flex;
  align-items: center;
  gap: 28px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--color-gray-100);
  margin-bottom: 18px;
}

.total-block {
  min-width: 110px;
  text-align: center;
}

.total-value {
  font-size: 32px;
  font-weight: 700;
  color: var(--corp-text-primary);
  line-height: 1;
}

.total-unit {
  font-size: 14px;
  font-weight: 500;
  color: var(--corp-text-secondary);
  margin-left: 4px;
}

.total-label {
  font-size: 12px;
  color: var(--corp-text-secondary);
  margin-top: 6px;
}

.progress-block {
  flex: 1;
}

.progress-track {
  height: 10px;
  background: var(--color-gray-100);
  border-radius: 5px;
  overflow: hidden;
  display: flex;
}

.progress-used {
  background: var(--color-primary-600);
  transition: width 0.3s ease;
}

.progress-orphaned {
  background: var(--color-gray-400);
  transition: width 0.3s ease;
}

.progress-legend {
  display: flex;
  gap: 24px;
  margin-top: 10px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.legend-dot.used { background: var(--color-primary-600); }
.legend-dot.orphaned { background: var(--color-gray-400); }

.legend-label {
  color: var(--corp-text-secondary);
}

.legend-value {
  color: var(--corp-text-primary);
  font-weight: 500;
}

/* 详情卡片 */
.stat-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-bottom: 18px;
}

.detail-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  border-radius: 6px;
  border: 1px solid var(--corp-border-light);
  background: var(--corp-bg-sunken);
}

.detail-icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  background: var(--bg-surface);
  color: var(--corp-text-secondary);
  border: 1px solid var(--corp-border-light);
}

.detail-info {
  flex: 1;
}

.detail-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--corp-text-primary);
  line-height: 1.2;
}

.detail-unit {
  font-size: 12px;
  font-weight: 500;
  color: var(--corp-text-secondary);
  margin-left: 2px;
}

.detail-label {
  font-size: 12px;
  color: var(--corp-text-secondary);
  margin-top: 2px;
}

.detail-count {
  font-size: 11px;
  color: var(--corp-text-tertiary);
  margin-top: 2px;
}

.detail-card.has-orphaned {
  border-color: var(--color-danger-bg);
  background: var(--color-danger-bg);
}

.detail-card.has-orphaned .detail-icon {
  color: var(--color-danger-text);
  border-color: var(--color-danger-bg);
}

/* 清理区 */
.cleanup-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-bg); /* 原 #fde68a 浅黄边框，对齐 --color-warning-bg */
  border-radius: 6px;
  flex-wrap: wrap;
}

.cleanup-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cleanup-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-warning-text);
}

.cleanup-desc {
  font-size: 12px;
  color: var(--color-warning-600);
}

.cleanup-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 正常状态 */
.no-orphaned {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  color: var(--color-success-text);
  font-size: 14px;
  background: var(--color-success-bg);
  border: 1px solid var(--color-success-bg); /* 原 #bbf7d0 浅绿边框，对齐 --color-success-bg */
  border-radius: 6px;
}

.no-orphaned :deep(.el-icon) {
  color: var(--color-success);
}

@media (max-width: 720px) {
  .overview {
    flex-direction: column;
    align-items: flex-start;
  }

  .stat-detail-grid {
    grid-template-columns: 1fr;
  }

  .cleanup-box {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
