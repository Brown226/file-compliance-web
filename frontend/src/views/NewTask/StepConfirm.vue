<template>
  <div class="step-confirm">
    <el-card shadow="hover" class="confirm-card">
      <template #header>
        <div class="card-title">
          <el-icon :size="20" color="var(--color-primary-500)"><CircleCheckFilled /></el-icon>
          <span>确认提交审查任务</span>
        </div>
      </template>

      <div class="confirm-sections">
        <!-- 基本信息 -->
        <div class="confirm-section">
          <div class="section-label">基本信息</div>
          <div class="info-grid">
            <div class="info-item">
              <span class="info-key">任务名称</span>
              <span class="info-val">{{ form.title || '未填写' }}</span>
            </div>
            <div class="info-item">
              <span class="info-key">审查模式</span>
              <span class="info-val">
                <el-tag size="small" type="primary">{{ getModeLabel(selectedMode) }}</el-tag>
              </span>
            </div>
            <div class="info-item" v-if="form.description">
              <span class="info-key">任务描述</span>
              <span class="info-val desc">{{ form.description }}</span>
            </div>
          </div>
        </div>

        <!-- 待审文件 -->
        <div class="confirm-section">
          <div class="section-label">
            待审文件
            <el-tag size="small" type="info" round>{{ fileList.length }} 个</el-tag>
          </div>
          <div class="file-list">
            <div v-for="file in fileList" :key="file.uid" class="file-item">
              <el-icon :size="16" color="var(--color-primary-500)"><Document /></el-icon>
              <span class="file-name">{{ file.name }}</span>
              <span class="file-size">{{ formatSize(file.size) }}</span>
            </div>
            <div v-if="fileList.length === 0" class="empty-hint">未上传文件</div>
          </div>
        </div>

        <!-- 参照文件（以文审文模式） -->
        <div class="confirm-section" v-if="selectedMode === 'DOC_REVIEW' && refFileList.length > 0">
          <div class="section-label">
            参照文件
            <el-tag size="small" type="success" round>{{ refFileList.length }} 个</el-tag>
          </div>
          <div class="file-list">
            <div v-for="file in refFileList" :key="file.uid" class="file-item">
              <el-icon :size="16" color="var(--color-success)"><Document /></el-icon>
              <span class="file-name">{{ file.name }}</span>
              <span class="file-size">{{ formatSize(file.size) }}</span>
            </div>
          </div>
        </div>

        <!-- 关联知识库 -->
        <div class="confirm-section" v-if="selectedKnowledgeIds.length > 0">
          <div class="section-label">
            关联知识库
            <el-tag size="small" type="warning" round>{{ selectedKnowledgeIds.length }} 个</el-tag>
          </div>
          <div class="kb-list">
            <el-tag
              v-for="kbId in selectedKnowledgeIds"
              :key="kbId"
              size="small"
              type="info"
              class="kb-tag"
            >
              {{ getKbName(kbId) }}
            </el-tag>
          </div>
        </div>

        <!-- 预计耗时 -->
        <div class="confirm-section">
          <div class="estimate-row">
            <el-icon :size="16" color="var(--color-warning)"><Timer /></el-icon>
            <span>预计审查耗时：约 <strong>{{ estimatedTime }}</strong></span>
          </div>
        </div>
      </div>
    </el-card>

    <!-- 操作按钮 -->
    <div class="action-bar">
      <el-button plain @click="$emit('prev')" :disabled="submitting">
        <el-icon><ArrowLeft /></el-icon> 上一步
      </el-button>
      <el-button type="primary" :loading="submitting" @click="$emit('submit')">
        <el-icon><CircleCheckFilled /></el-icon> 提交审查任务
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { UploadFile } from 'element-plus'
import { CircleCheckFilled, Document, Timer, ArrowLeft } from '@element-plus/icons-vue'

const props = defineProps<{
  form: { title: string; description: string }
  selectedMode: string
  fileList: UploadFile[]
  refFileList: UploadFile[]
  submitting: boolean
  knowledgeBases: Array<{ id: string; name: string }>
  selectedKnowledgeIds: string[]
}>()

defineEmits<{
  prev: []
  submit: []
}>()

const getModeLabel = (mode: string) => {
  const map: Record<string, string> = {
    FULL_REVIEW: '全量审查',
    LIBRARY_REVIEW: '以库审文',
    DOC_REVIEW: '以文审文',
    CONSISTENCY: '一致性检查',
    TYPO_GRAMMAR: '错别字/语法',
    MULTIMODAL: '多模态识别',
    CUSTOM_RULE: '自定义规则',
  }
  return map[mode] || mode
}

const getKbName = (id: string) => {
  return props.knowledgeBases.find(kb => kb.id === id)?.name || id
}

const formatSize = (bytes?: number) => {
  if (!bytes) return '-'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

const estimatedTime = computed(() => {
  const fileCount = props.fileList.length
  if (fileCount === 0) return '0 分钟'
  const minutes = Math.max(1, Math.ceil(fileCount * 1.5))
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
})
</script>

<style scoped>
.step-confirm {
  max-width: 960px;
  margin: 0 auto;
}

.confirm-card {
  border-radius: var(--radius-lg);
}

.card-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--corp-text-primary);
}

.confirm-sections {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.confirm-section {
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-gray-100);
}

.confirm-section:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.section-label {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--color-gray-700);
  margin-bottom: var(--space-3);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-3);
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.info-key {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
}

.info-val {
  font-size: var(--text-base);
  color: var(--corp-text-primary);
  font-weight: 500;
}

.info-val.desc {
  font-weight: 400;
  color: var(--corp-text-secondary);
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.file-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--color-gray-50);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
}

.file-name {
  flex: 1;
  color: var(--color-gray-700);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  color: var(--corp-text-tertiary);
  font-size: var(--text-xs);
  flex-shrink: 0;
}

.empty-hint {
  text-align: center;
  color: var(--corp-text-tertiary);
  font-size: var(--text-sm);
  padding: var(--space-3) 0;
}

.kb-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.kb-tag {
  border-radius: var(--radius-sm);
}

.estimate-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-base);
  color: var(--corp-text-secondary);
  padding: var(--space-3) var(--space-4);
  background: var(--corp-warning-light);
  border: 1px solid #FDE68A;
  border-radius: var(--radius-md);
}

.estimate-row strong {
  color: var(--color-warning);
}

.action-bar {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-6);
  padding: var(--space-5) 0;
}
</style>
