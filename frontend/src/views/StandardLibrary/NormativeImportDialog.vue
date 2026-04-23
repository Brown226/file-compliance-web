<template>
  <el-dialog
    v-model="visible"
    title="Normative 标准库导入"
    width="500px"
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <div class="import-dialog-content">
      <!-- 功能说明 -->
      <el-alert type="info" :closable="false" show-icon style="margin-bottom: 16px;">
        <template #title>
          导入说明
        </template>
        <template #default>
          支持从 Normative 工具导出的 Excel 文件批量导入标准库数据。
        </template>
      </el-alert>

      <!-- 文件上传 -->
      <el-upload
        :auto-upload="false"
        :limit="1"
        accept=".xlsx,.xls"
        :on-change="handleFileChange"
        :on-remove="handleFileRemove"
        :file-list="fileList"
        drag
        class="normative-upload"
      >
        <div class="upload-content">
          <el-icon class="upload-icon"><UploadFilled /></el-icon>
          <div class="upload-text">
            <span class="upload-title">将 Normative Excel 文件拖到此处</span>
            <span class="upload-subtitle">或点击选择文件</span>
          </div>
        </div>
      </el-upload>

      <!-- 导入选项 -->
      <div v-if="selectedFile" class="options-section">
        <el-divider content-position="left">导入选项</el-divider>
        <el-form :model="importOptions" label-width="100px">
          <el-form-item label="跳过无效行">
            <el-switch v-model="importOptions.skipInvalidRows" />
          </el-form-item>
          <el-form-item label="覆盖已存在">
            <el-switch v-model="importOptions.overwriteExisting" />
          </el-form-item>
        </el-form>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose">取消</el-button>
        <el-button
          type="primary"
          :disabled="!selectedFile"
          @click="handleImport"
          :loading="importLoading"
        >
          <el-icon><Download /></el-icon> 开始导入
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import {
  UploadFilled, Download,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { UploadFile } from 'element-plus'
import {
  importNormativeExcelApi,
} from '@/api/standard'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'success': []
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

// 文件相关
const selectedFile = ref<File | null>(null)
const fileList = ref<UploadFile[]>([])
const importLoading = ref(false)

// 导入选项
const importOptions = reactive({
  skipInvalidRows: true,
  overwriteExisting: false,
})

// 文件选择
const handleFileChange = (file: UploadFile) => {
  selectedFile.value = file.raw || null
  fileList.value = [file]
}

// 文件移除
const handleFileRemove = () => {
  selectedFile.value = null
  fileList.value = []
}

// 执行导入
const handleImport = async () => {
  if (!selectedFile.value) {
    ElMessage.warning('请先选择文件')
    return
  }
  importLoading.value = true
  try {
    const { data } = await importNormativeExcelApi(selectedFile.value, {
      skipInvalidRows: importOptions.skipInvalidRows,
      overwriteExisting: importOptions.overwriteExisting,
    })
    ElMessage.success(data?.message || `导入完成：成功 ${data?.imported} 行`)
    // 重置状态
    resetForm()
    // 关闭弹窗并通知成功
    visible.value = false
    emit('success')
  } catch (e: any) {
    console.error('导入失败:', e)
    ElMessage.error(e?.response?.data?.error || '导入失败')
  } finally {
    importLoading.value = false
  }
}

// 关闭弹窗
const handleClose = () => {
  resetForm()
  visible.value = false
}

// 重置表单
const resetForm = () => {
  selectedFile.value = null
  fileList.value = []
  importOptions.skipInvalidRows = true
  importOptions.overwriteExisting = false
}
</script>

<style scoped>
.import-dialog-content {
  max-height: 50vh;
  overflow-y: auto;
}

/* 上传区域 */
.normative-upload {
  width: 100%;
  margin-bottom: 16px;
}

.normative-upload :deep(.el-upload-dragger) {
  padding: 32px;
  background: var(--el-fill-color-light);
  border: 2px dashed var(--el-border-color);
  border-radius: 8px;
  transition: all 0.3s;
}

.normative-upload :deep(.el-upload-dragger:hover) {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.upload-icon {
  font-size: 48px;
  color: var(--el-color-primary);
}

.upload-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.upload-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.upload-subtitle {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* 选项区域 */
.options-section {
  margin-bottom: 16px;
}

.options-section :deep(.el-divider--horizontal) {
  margin: 12px 0;
}

.options-section :deep(.el-form-item) {
  margin-bottom: 8px;
}

/* 底部按钮 */
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
