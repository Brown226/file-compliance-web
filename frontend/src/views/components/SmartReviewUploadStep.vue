<template>
  <div class="upload-step">
    <div v-if="!hideActions" class="step-title">
      <h1 class="page-title">{{ pageTitle }}</h1>
      <p class="page-subtitle">{{ pageSubtitle }}</p>
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
          v-model:file-list="uploadFileList"
          :on-change="handleFileChange"
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
            <div class="format-tags">
              <span class="format-tag">.docx</span>
              <span class="format-tag">.pdf</span>
              <span class="format-tag">.dwg</span>
              <span class="format-tag">.xls</span>
              <span class="format-tag">.ppt</span>
              <span class="format-tag">更多</span>
            </div>
          </div>
        </el-upload>

        <div v-if="fileList.length > 0" class="file-list-section">
          <div class="file-list">
            <div v-for="(file, index) in fileList" :key="index" class="file-item">
              <el-icon class="file-icon" :style="{ color: getFileMeta(file.name).color }">
                <component :is="getFileMeta(file.name).icon" />
              </el-icon>
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

      <p v-if="fileList.length === 0 && entryModule !== 'RULE_ONLY' && !hideActions" class="empty-hint">
        至少上传一个待审文件后可继续
      </p>

      <div v-if="entryModule === 'DOC_REVIEW' || entryModule === 'CONTRACT'" class="reference-upload-section">
        <h3 class="section-title">
          <el-icon><Link /></el-icon>
          {{ entryModule === 'CONTRACT' ? '合同模板' : '参考文件（用于以文审文）' }}
          <el-tag type="info" size="small">可选</el-tag>
        </h3>
        <p class="section-description">
          {{ entryModule === 'CONTRACT' ? '上传合同模板进行比对审查，不上传则基于通用知识纯风险扫描' : '上传参考文件作为审查依据，系统将基于参考文件对待审文件进行逐项比对。' }}
        </p>
        <el-upload
          ref="referenceUploadRef"
          class="reference-upload"
          drag
          multiple
          :auto-upload="false"
          :limit="5"
          v-model:file-list="uploadRefFileList"
          :on-change="handleReferenceFileChange"
          accept=".dwg,.doc,.docx,.xls,.xlsx,.pdf,.ppt,.pptx,.txt"
          :show-file-list="false"
        >
          <div class="upload-content">
            <el-icon :size="36" class="upload-icon"><FolderAdd /></el-icon>
            <div class="upload-text">
              <span class="upload-link">选择参考文件</span>
              <span>或拖到此处</span>
            </div>
            <div class="format-tags">
              <span class="format-tag">.docx</span>
              <span class="format-tag">.pdf</span>
              <span class="format-tag">.dwg</span>
              <span class="format-tag">最多5个</span>
            </div>
          </div>
        </el-upload>

        <div v-if="refFileList.length > 0" class="file-list-section">
          <div class="file-list">
            <div v-for="(file, index) in refFileList" :key="index" class="file-item reference-file">
              <el-icon class="file-icon" :style="{ color: getFileMeta(file.name).color }">
                <component :is="getFileMeta(file.name).icon" />
              </el-icon>
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

      <div v-if="!hideActions" class="step-actions">
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
  PictureFilled, Files, Grid,
} from '@element-plus/icons-vue'

type EntryModule = 'LIBRARY' | 'CONSISTENCY' | 'PROOFREAD' | 'RULE_ONLY' | 'DOC_REVIEW' | 'CONTRACT'

const props = defineProps<{
  fileList: UploadFile[]
  refFileList: UploadFile[]
  entryModule: EntryModule | ''
  dwgParsedDataMap: Record<string, any>
  hideActions?: boolean
}>()

const emit = defineEmits<{
  'update:fileList': [value: UploadFile[]]
  'update:refFileList': [value: UploadFile[]]
  next: []
  fileChange: [file: UploadFile, fileList: UploadFile[]]
  fileRemove: [file: UploadFile, fileList: UploadFile[]]
}>()

// ===== 模块说明映射 =====
const moduleMeta: Record<string, { title: string; subtitle: string }> = {
  LIBRARY: {
    title: '以库审文',
    subtitle: '基于知识库和标准库进行综合合规审查，上传文件后 AI 将自动匹配审查规则，双重检查确保合规。',
  },
  CONSISTENCY: {
    title: '一致性审查',
    subtitle: '多份文件间或文件内部的数据一致性检查，上传待比对文件，系统将自动校验参数与数据的自洽性。',
  },
  PROOFREAD: {
    title: '基础校对',
    subtitle: '错别字、语法、语句通顺性、术语一致性等文字质量检查，快速完成文字层面的质量把关。',
  },
  DOC_REVIEW: {
    title: '以文审文',
    subtitle: '将待审文件与参考文件逐项比对，上传待审文件和参考文件，AI 将语义级分析差异与遗漏。',
  },
  RULE_ONLY: {
    title: '规则库审查',
    subtitle: '仅执行预定义规则检查，不调用 AI，速度最快。上传文件后自动按规则进行格式、编码等检查。',
  },
  CONTRACT: {
    title: '合同风险审查',
    subtitle: '上传待审合同文件，AI 将从所选立场出发，识别不利风险条款、缺失保护条款及与模板的差异。',
  },
}

const pageTitle = computed(() => {
  if (props.entryModule && moduleMeta[props.entryModule]) {
    return moduleMeta[props.entryModule].title
  }
  return '智能文件审查'
})

const pageSubtitle = computed(() => {
  if (props.entryModule && moduleMeta[props.entryModule]) {
    return moduleMeta[props.entryModule].subtitle
  }
  return '上传您的文件，AI 将为您深度分析、识别风险、守护合规。'
})

const totalFileSize = computed(() =>
  props.fileList.reduce((sum, f) => sum + (f.size || 0), 0) +
  props.refFileList.reduce((sum, f) => sum + (f.size || 0), 0)
)

const uploadRef = ref()
const referenceUploadRef = ref()

// ★ 修复：通过 v-model:file-list 双向绑定，确保 el-upload 内部状态与外部 prop 同步
// 避免自定义 removeFile 后 el-upload 内部仍保留已删除文件，导致下次添加时幽灵重现
const uploadFileList = computed({
  get: () => props.fileList,
  set: (val: UploadFile[]) => emit('update:fileList', val)
})

const uploadRefFileList = computed({
  get: () => props.refFileList,
  set: (val: UploadFile[]) => emit('update:refFileList', val)
})

const handleFileChange = (file: UploadFile) => {
  // OPT-019: 文件大小预检提示
  if ((file.size || 0) > 50 * 1024 * 1024) {
    ElMessage.warning(`文件「${file.name}」超过 50MB，可能无法完整解析，建议拆分后上传`)
  }
  emit('fileChange', file, uploadFileList.value)
}

const handleExceed = (_files: File[], fileList: File[]) => {
  ElMessage.warning(`最多只能选择 10 个待审文件。当前已选择 ${fileList.length} 个文件。`)
}

const removeFile = (index: number) => {
  const newList = [...props.fileList]
  const removed = newList[index]
  newList.splice(index, 1)
  emit('update:fileList', newList)
  // 同步 el-upload 内部状态（v-model:file-list 会自动同步，此处触发 fileRemove 事件）
  if (removed) emit('fileRemove', removed, newList)
}

const handleReferenceFileChange = (_file: UploadFile) => {
  // v-model:file-list 已自动同步，无需额外 emit
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

// ===== 文件类型图标映射 =====
const getFileMeta = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, { icon: any; color: string }> = {
    pdf: { icon: PictureFilled, color: '#EF4444' },
    doc: { icon: Document, color: '#2563EB' },
    docx: { icon: Document, color: '#2563EB' },
    xls: { icon: Grid, color: '#16A34A' },
    xlsx: { icon: Grid, color: '#16A34A' },
    ppt: { icon: Files, color: '#E9730F' },
    pptx: { icon: Files, color: '#E9730F' },
    dwg: { icon: PictureFilled, color: '#8B5CF6' },
    jpg: { icon: PictureFilled, color: '#EC4899' },
    jpeg: { icon: PictureFilled, color: '#EC4899' },
    png: { icon: PictureFilled, color: '#EC4899' },
    txt: { icon: Document, color: '#6B7280' },
  }
  return map[ext] || { icon: Document, color: '#6B7280' }
}
</script>

<style scoped>
.upload-step {
  text-align: center;
}

.upload-container {
  max-width: 100%;
}

.step-title {
  margin-bottom: 16px;
}

.page-title {
  font-size: 24px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 4px;
}

.page-subtitle {
  font-size: 13px;
  color: #9CA3AF;
  margin: 0;
}

.upload-container {
  max-width: 100%;
}

.primary-upload-section {
  margin-bottom: 20px;
}

.reference-upload-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px dashed #E2E8F0;
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
  border-radius: 8px;
  border: 2px dashed #D1D5DB;
  background: #F9FAFB;
  transition: border-color 0.2s, background 0.2s;
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
  padding: 44px 20px;
  border-radius: 8px;
  border: 2px dashed #D1D5DB;
  background: #FAFBFC;
  transition: border-color 0.2s, background 0.2s;
}

.upload-dragger :deep(.el-upload-dragger:hover) {
  border-color: #2563EB;
  background: #EFF6FF;
}

.upload-dragger :deep(.el-upload-dragger.is-dragover) {
  border-color: #2563EB;
  border-style: solid;
  background: #DBEAFE;
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

.format-tags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
}

.format-tag {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 500;
  color: #6B7280;
  background: #F3F4F6;
  border-radius: 6px;
  border: 1px solid #E5E7EB;
  line-height: 1.6;
  transition: background 0.15s;
}
.format-tag:hover {
  background: #E5E7EB;
}

.empty-hint {
  margin: 8px 0 0;
  font-size: 14px;
  color: #9CA3AF;
  text-align: center;
  font-weight: 500;
}
</style>