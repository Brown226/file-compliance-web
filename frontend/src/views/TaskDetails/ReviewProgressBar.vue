<template>
  <div v-if="reviewing" class="inline-review-progress">
    <div class="progress-top">
      <div class="progress-status">
        <el-icon class="is-loading" :size="16"><Loading /></el-icon>
        <span class="progress-title">{{ isSelfCheck ? '正在执行标准引用自检' : '正在智能审查文档' }}</span>
      </div>
      <span class="progress-percent">{{ reviewProgress }}%</span>
    </div>
    <el-progress
      :percentage="reviewProgress"
      :stroke-width="6"
      :show-text="false"
      :status="reviewProgress >= 100 ? 'success' : ''"
      color="var(--color-primary-600)"
    />
    <div class="progress-details">
      <p class="progress-step">{{ reviewStep || '准备中...' }}</p>
      <p class="progress-message">{{ reviewMessage }}</p>
      <div v-if="fileProgress.fileName" class="chunk-progress">
        <el-icon><Document /></el-icon>
        <span class="chunk-filename">{{ fileProgress.fileName }}</span>
        <el-tag size="small" type="info" round>
          分片 {{ fileProgress.chunkIndex }}/{{ fileProgress.totalChunks }}
        </el-tag>
      </div>
      <div v-if="liveIssueCount > 0" class="live-issue-count">
        <el-icon color="var(--corp-warning)"><Warning /></el-icon>
        已发现 <strong>{{ liveIssueCount }}</strong> 个问题
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Loading, Document, Warning } from '@element-plus/icons-vue'

defineProps<{
  reviewing: boolean
  reviewProgress: number
  reviewStep: string
  reviewMessage: string
  isSelfCheck: boolean
  fileProgress: {
    fileName: string
    chunkIndex: number
    totalChunks: number
  }
  liveIssueCount: number
}>()
</script>
