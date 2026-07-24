<template>
  <div class="basic-settings">
    <div class="page-intro">
      <h3>基础设置</h3>
      <p>管理系统运行参数、并发策略与文件保留策略。</p>
    </div>

    <!-- 通用设置 -->
    <section class="settings-card">
      <div class="card-header">
        <el-icon :size="18"><SetUp /></el-icon>
        <div>
          <h4>通用设置</h4>
          <span class="card-desc">系统名称、文件上传与数据清理策略</span>
        </div>
      </div>
      <div class="card-body">
        <el-form :model="basicSettings" label-width="90px" label-position="left">
          <div class="form-grid two-col">
            <el-form-item label="系统名称">
              <el-input v-model="basicSettings.systemName" placeholder="核审通" />
            </el-form-item>

            <el-form-item label="上传限制">
              <div class="inline-number">
                <el-input-number v-model="basicSettings.maxUploadSizeMB" :min="1" :max="500" controls-position="right" />
                <span class="unit-label">MB</span>
              </div>
            </el-form-item>
          </div>

          <el-form-item label="自动清理" class="single-item">
            <div class="inline-number">
              <el-input-number v-model="basicSettings.autoCleanupDays" :min="0" :max="365" controls-position="right" />
              <span class="unit-label">天</span>
            </div>
            <div class="form-tip">0 表示不自动清理。已完成任务的文件在指定天数后自动删除。</div>
          </el-form-item>
        </el-form>
      </div>
    </section>

    <!-- 性能设置 -->
    <section class="settings-card">
      <div class="card-header">
        <el-icon :size="18"><Cpu /></el-icon>
        <div>
          <h4>性能设置</h4>
          <span class="card-desc">任务队列与 LLM 调用并发控制</span>
        </div>
      </div>
      <div class="card-body">
        <el-form :model="basicSettings" label-width="110px" label-position="left">
          <div class="form-grid two-col">
            <el-form-item label="全局并发上限">
              <el-input-number v-model="basicSettings.globalConcurrencyLimit" :min="1" :max="20" controls-position="right" />
              <div class="form-tip">同时运行的审查任务总数上限</div>
            </el-form-item>

            <el-form-item label="队列并发数">
              <el-input-number v-model="basicSettings.queueConcurrency" :min="1" :max="10" controls-position="right" />
              <div class="form-tip">同时从队列取出的任务数</div>
            </el-form-item>

            <el-form-item label="每用户并发">
              <el-input-number v-model="basicSettings.maxConcurrentReviews" :min="1" :max="10" controls-position="right" />
              <div class="form-tip">单个用户同时审查的文件数</div>
            </el-form-item>

            <el-form-item label="LLM 分片并发">
              <el-input-number v-model="basicSettings.chunkConcurrency" :min="1" :max="5" controls-position="right" />
              <div class="form-tip">单个文件内 LLM 调用分片数</div>
            </el-form-item>
          </div>
        </el-form>
      </div>
    </section>

    <!-- 保存面板 -->
    <section class="settings-card save-card">
      <div class="save-body">
        <div class="save-info">
          <div class="save-item">
            <span class="save-label">系统版本</span>
            <span class="save-value">v3.0.0</span>
          </div>
          <div class="save-divider"></div>
          <div class="save-item">
            <span class="save-label">上次保存</span>
            <span class="save-value">{{ lastSavedAt || '未保存' }}</span>
          </div>
        </div>
        <el-button type="primary" size="default" @click="handleSaveBasicSettings" :loading="basicSettingsSaving">
          <el-icon><Check /></el-icon>
          保存设置
        </el-button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Check, SetUp, Cpu } from '@element-plus/icons-vue'
import { getSystemConfigApi, saveSystemConfigApi } from '@/api/system'
import { useSystemConfigStore } from '@/stores/system-config'

const systemConfigStore = useSystemConfigStore()

const basicSettingsSaving = ref(false)
const lastSavedAt = ref('')

const basicSettings = reactive({
  systemName: '核审通',
  maxUploadSizeMB: 100,
  autoCleanupDays: 0,
  globalConcurrencyLimit: 5,
  queueConcurrency: 3,
  maxConcurrentReviews: 3,
  chunkConcurrency: 2,
})

const formatDateTime = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

const handleSaveBasicSettings = async () => {
  basicSettingsSaving.value = true
  try {
    await saveSystemConfigApi('basic_settings', basicSettings)
    systemConfigStore.loadSystemName()
    lastSavedAt.value = formatDateTime(new Date())
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
      if (v.queueConcurrency) basicSettings.queueConcurrency = v.queueConcurrency
      if (v.maxConcurrentReviews) basicSettings.maxConcurrentReviews = v.maxConcurrentReviews
      if (v.chunkConcurrency) basicSettings.chunkConcurrency = v.chunkConcurrency
    }
    if (data?.updatedAt) {
      lastSavedAt.value = formatDateTime(new Date(data.updatedAt))
    }
  } catch {}
}

onMounted(() => {
  loadBasicSettings()
})
</script>

<style scoped>
.basic-settings {
  padding: 20px 24px 32px;
  max-width: 900px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-intro {
  padding: 4px 0 4px 12px;
  border-left: 3px solid #2563eb;
  margin-bottom: 4px;
}

.page-intro h3 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: #0f172a;
}

.page-intro p {
  margin: 0;
  font-size: 12.5px;
  color: #64748b;
  line-height: 1.5;
}

/* 通用卡片 */
.settings-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  overflow: hidden;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid #f1f5f9;
  background: #fafbfc;
}

.card-header :deep(.el-icon) {
  color: #64748b;
  flex-shrink: 0;
}

.card-header h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}

.card-desc {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: #94a3b8;
}

.card-body {
  padding: 18px 20px 6px;
}

/* 表单网格 */
.form-grid {
  display: grid;
  gap: 0 20px;
}

.form-grid.two-col {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.single-item {
  max-width: calc(50% - 10px);
}

.inline-number {
  display: flex;
  align-items: center;
  gap: 8px;
}

.unit-label {
  font-size: 12px;
  color: #64748b;
}

.form-tip {
  font-size: 12px;
  color: #64748b;
  margin-top: 4px;
  line-height: 1.5;
}

/* 保存面板 */
.save-card {
  background: #fafbfc;
}

.save-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
}

.save-info {
  display: flex;
  align-items: center;
  gap: 16px;
}

.save-divider {
  width: 1px;
  height: 16px;
  background: #e5e7eb;
}

.save-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.save-label {
  font-size: 12px;
  color: #94a3b8;
}

.save-value {
  font-size: 13px;
  font-weight: 500;
  color: #0f172a;
}

/* Element Plus 覆盖 */
:deep(.el-input-number) {
  width: 120px;
}

:deep(.el-input__inner) {
  font-size: 13px;
}

@media (max-width: 720px) {
  .form-grid.two-col {
    grid-template-columns: 1fr;
  }

  .single-item {
    max-width: 100%;
  }

  .save-body {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
