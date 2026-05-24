<template>
  <div class="upload-step">
    <div class="step-title">
      <h1 class="page-title">智能文件审查</h1>
      <p class="page-subtitle">上传您的文件，AI 将为您深度分析、识别风险、守护合规。</p>
    </div>

    <div class="upload-container">
      <div class="primary-upload-section">
        <h3 class="section-title">
          <el-icon><Document /></el-icon>
          待审文件
          <el-tag type="danger" size="small">必选</el-tag>
        </h3>
        <el-upload
          ref="uploadRef"
          class="upload-dragger"
          drag
          multiple
          :auto-upload="false"
          :limit="10"
          :on-change="handleFileChange"
          :on-remove="handleFileRemove"
          :on-exceed="handleExceed"
          accept=".dwg,.doc,.docx,.xls,.xlsx,.pdf,.ppt,.pptx,.jpg,.png,.jpeg,.txt"
          :show-file-list="false"
        >
          <div class="upload-content">
            <el-icon :size="48" class="upload-icon"><UploadFilled /></el-icon>
            <div class="upload-text">
              <span class="upload-link">点击上传</span>
              <span>或将文件拖到此处</span>
            </div>
            <p class="upload-hint">支持 .docx .pdf .dwg .xls .ppt 格式</p>
          </div>
        </el-upload>

        <div v-if="fileList.length > 0" class="file-list-section">
          <div class="file-list">
            <div v-for="(file, index) in fileList" :key="index" class="file-item">
              <el-icon class="file-icon"><Document /></el-icon>
              <span class="file-name">{{ file.name }}</span>
              <span class="file-size">{{ formatFileSize(file.size || 0) }}</span>
              <el-button
                type="danger"
                text
                size="small"
                @click="removeFile(index)"
              >
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="entryModule === 'DOC_REVIEW'" class="reference-upload-section">
        <h3 class="section-title">
          <el-icon><Link /></el-icon>
          参考文件（用于以文审文）
          <el-tag type="info" size="small">可选</el-tag>
        </h3>
        <p class="section-description">
          上传参考文件作为审查依据，系统将基于参考文件对待审文件进行逐项比对。
        </p>
        <el-upload
          ref="referenceUploadRef"
          class="reference-upload"
          drag
          multiple
          :auto-upload="false"
          :limit="5"
          :on-change="handleReferenceFileChange"
          :on-remove="handleReferenceFileRemove"
          accept=".dwg,.doc,.docx,.xls,.xlsx,.pdf,.ppt,.pptx,.txt"
          :show-file-list="false"
        >
          <div class="upload-content">
            <el-icon :size="36" class="upload-icon"><FolderAdd /></el-icon>
            <div class="upload-text">
              <span class="upload-link">选择参考文件</span>
              <span>或拖到此处</span>
            </div>
            <p class="upload-hint">支持 .docx .pdf .dwg 等格式，最多 5 个文件</p>
          </div>
        </el-upload>

        <div v-if="refFileList.length > 0" class="file-list-section">
          <div class="file-list">
            <div v-for="(file, index) in refFileList" :key="index" class="file-item reference-file">
              <el-icon class="file-icon"><Document /></el-icon>
              <span class="file-name">{{ file.name }}</span>
              <span class="file-size">{{ formatFileSize(file.size || 0) }}</span>
              <el-button
                type="danger"
                text
                size="small"
                @click="removeReferenceFile(index)"
              >
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
          </div>
        </div>
      </div>

      <div class="step-actions">
        <el-button
          type="primary"
          size="large"
          :disabled="fileList.length === 0"
          @click="$emit('next')"
        >
          下一步：确认信息并分析
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import type { UploadFile } from 'element-plus'
import {
  UploadFilled, Document, Delete, Link, FolderAdd,
} from '@element-plus/icons-vue'

type EntryModule = 'LIBRARY' | 'CONSISTENCY' | 'PROOFREAD' | 'RULE_ONLY' | 'MULTIMODAL' | 'DOC_REVIEW'

const props = defineProps<{
  fileList: UploadFile[]
  refFileList: UploadFile[]
  entryModule: EntryModule | ''
  dwgParsedDataMap: Record<string, any>
}>()

const emit = defineEmits<{
  'update:fileList': [value: UploadFile[]]
  'update:refFileList': [value: UploadFile[]]
  next: []
  fileChange: [file: UploadFile, fileList: UploadFile[]]
  fileRemove: [file: UploadFile, fileList: UploadFile[]]
}>()

const uploadRef = ref()
const referenceUploadRef = ref()

const totalFileSize = computed(() =>
  props.fileList.reduce((sum, f) => sum + (f.size || 0), 0) +
  props.refFileList.reduce((sum, f) => sum + (f.size || 0), 0)
)

const handleFileChange = (file: UploadFile, newFileList: UploadFile[]) => {
  emit('update:fileList', newFileList)
  emit('fileChange', file, newFileList)
}

const handleFileRemove = (file: UploadFile, newFileList: UploadFile[]) => {
  emit('update:fileList', newFileList)
  emit('fileRemove', file, newFileList)
}

const handleExceed = (_files: File[], fileList: File[]) => {
  ElMessage.warning(`最多只能选择 10 个待审文件。当前已选择 ${fileList.length} 个文件。`)
}

const removeFile = (index: number) => {
  const newList = [...props.fileList]
  newList.splice(index, 1)
  emit('update:fileList', newList)
}

const handleReferenceFileChange = (_file: UploadFile, newFileList: UploadFile[]) => {
  emit('update:refFileList', newFileList)
}

const handleReferenceFileRemove = (_file: UploadFile, newFileList: UploadFile[]) => {
  emit('update:refFileList', newFileList)
}

const removeReferenceFile = (index: number) => {
  const newList = [...props.refFileList]
  newList.splice(index, 1)
  emit('update:refFileList', newList)
}

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
</script>

<style scoped>
.upload-step {
  text-align: center;
}

.step-title {
  margin-bottom: 20px;
}

.page-title {
  font-size: 28px;
  font-weight: 800;
  color: #111827;
  margin: 0 0 6px;
}

.page-subtitle {
  font-size: 14px;
  color: #6B7280;
  margin: 0;
}

.upload-container {
  max-width: 800px;
  margin: 0 auto;
}

.primary-upload-section {
  margin-bottom: 20px;
}

.reference-upload-section {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 2px dashed #E5E7EB;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 16px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 12px;
}

.section-description {
  font-size: 13px;
  color: #6B7280;
  margin: 0 0 12px;
  line-height: 1.5;
}

.reference-upload :deep(.el-upload-dragger) {
  padding: 24px 20px;
  border-radius: 10px;
  border: 2px dashed #D1D5DB;
  background: #F9FAFB;
  transition: all 0.15s;
}

.reference-upload :deep(.el-upload-dragger:hover) {
  border-color: #10B981;
  background: #F0FDF4;
}

.reference-upload .upload-icon {
  color: #6B7280;
}

.file-list-section {
  margin-top: 12px;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: white;
  border-radius: 6px;
  border: 1px solid #E5E7EB;
  transition: all 0.15s;
}

.file-item:hover {
  border-color: #3B82F6;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.1);
}

.file-item.reference-file {
  background: #F9FAFB;
  border-color: #D1D5DB;
}

.file-item.reference-file:hover {
  border-color: #10B981;
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.1);
}

.file-icon {
  color: #3B82F6;
  font-size: 18px;
}

.file-item.reference-file .file-icon {
  color: #10B981;
}

.file-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: #111827;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  font-size: 11px;
  color: #9CA3AF;
  flex-shrink: 0;
}

.step-actions {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}

.upload-dragger :deep(.el-upload-dragger) {
  padding: 36px 20px;
  border-radius: 10px;
  border: 2px dashed #E5E7EB;
  background: #FAFAFA;
  transition: all 0.15s;
}

.upload-dragger :deep(.el-upload-dragger:hover) {
  border-color: #3B82F6;
  background: #EFF6FF;
}

/* 隐藏 el-upload 内部的文件列表（使用自定义列表） */
.upload-dragger :deep(.el-upload-list) {
  display: none !important;
}

.upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.upload-icon {
  color: #9CA3AF;
}

.upload-text {
  font-size: 15px;
  color: #6B7280;
}

.upload-link {
  font-weight: 700;
  color: #3B82F6;
  cursor: pointer;
}

.upload-hint {
  font-size: 12px;
  color: #9CA3AF;
  margin: 0;
}
</style>