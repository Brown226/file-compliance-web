<template>
  <div v-if="issueCount > 0" class="overview-issue-list">
    <div class="overview-issue-header">
      <h4 class="overview-section-title">问题概览</h4>
      <div class="overview-header-actions">
        <span class="switch-label">大白话</span>
        <el-switch :model-value="showPlainLanguage" @update:model-value="(v: boolean) => emit('update:showPlainLanguage', v)" size="small" />
      </div>
    </div>

    <!-- 严重错误 -->
    <template v-if="errorIssues.length > 0">
      <div class="overview-severity-group">
        <div class="severity-group-header severity-error">
          <span class="severity-dot-sm error-dot"></span>
          严重错误 · {{ errorIssues.length }} 条
        </div>
        <div
          v-for="issue in errorIssues.slice(0, 5)"
          :key="issue.id"
          class="overview-issue-card"
          @click="emit('navigate', issue)"
        >
          <div class="oic-tags">
            <el-tag :type="getCategoryTagType(issue.issueType)" size="small" effect="dark" round>
              {{ getIssueTypeLabel(issue.issueType) }}
            </el-tag>
            <el-tag type="danger" size="small" effect="plain" round>严重</el-tag>
          </div>
          <p class="oic-desc">{{ issue.description || '-' }}</p>
          <p v-if="showPlainLanguage && issue.plainLanguage" class="oic-plain"><el-icon :size="12"><InfoFilled /></el-icon> {{ issue.plainLanguage }}</p>
          <div class="oic-preview-row" v-if="issue.originalText">
            <span class="oic-preview-label">原：</span>
            <span class="oic-preview-text original">{{ truncateText(issue.originalText, 80) }}</span>
          </div>
          <div class="oic-preview-row" v-if="issue.suggestedText">
            <span class="oic-preview-label">改：</span>
            <span class="oic-preview-text suggested">{{ truncateText(issue.suggestedText, 80) }}</span>
          </div>
          <el-icon class="oic-arrow"><ArrowRight /></el-icon>
        </div>
        <div v-if="errorIssues.length > 5" class="view-all-wrapper">
          <button class="view-all-btn" @click="emit('view-all')">
            查看全部 {{ errorIssues.length }} 条严重错误
            <el-icon><ArrowRight /></el-icon>
          </button>
        </div>
      </div>
    </template>

    <!-- 警告 -->
    <template v-if="warningIssues.length > 0">
      <div class="overview-severity-group">
        <div class="severity-group-header severity-warning">
          <span class="severity-dot-sm warning-dot"></span>
          警告 · {{ warningIssues.length }} 条
        </div>
        <div
          v-for="issue in warningIssues.slice(0, 5)"
          :key="issue.id"
          class="overview-issue-card warning"
          @click="emit('navigate', issue)"
        >
          <div class="oic-tags">
            <el-tag :type="getCategoryTagType(issue.issueType)" size="small" effect="dark" round>
              {{ getIssueTypeLabel(issue.issueType) }}
            </el-tag>
            <el-tag type="warning" size="small" effect="plain" round>警告</el-tag>
          </div>
          <p class="oic-desc">{{ issue.description || '-' }}</p>
          <p v-if="showPlainLanguage && issue.plainLanguage" class="oic-plain"><el-icon :size="12"><InfoFilled /></el-icon> {{ issue.plainLanguage }}</p>
          <el-icon class="oic-arrow"><ArrowRight /></el-icon>
        </div>
        <div v-if="warningIssues.length > 5" class="view-all-wrapper">
          <button class="view-all-btn view-all-btn-warning" @click="emit('view-all')">
            查看全部 {{ warningIssues.length }} 条警告
            <el-icon><ArrowRight /></el-icon>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ArrowRight, InfoFilled } from '@element-plus/icons-vue'
import type { TaskDetail } from '@/types/models'
import { useIssueHelpers } from './composables'

defineProps<{
  issueCount: number
  errorIssues: TaskDetail[]
  warningIssues: TaskDetail[]
  showPlainLanguage: boolean
}>()

const emit = defineEmits<{
  (e: 'update:showPlainLanguage', value: boolean): void
  (e: 'navigate', issue: TaskDetail): void
  (e: 'view-all'): void
}>()

const { getCategoryTagType, getIssueTypeLabel, truncateText } = useIssueHelpers()
</script>

<style scoped>
.overview-issue-list {
  margin-top: 20px;
}

.overview-issue-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  margin-bottom: 16px;
  background: #F9FAFB;
  border: 1px solid #E5E7EB;
  border-radius: 6px;
}

.overview-section-title {
  font-size: 14px;
  font-weight: 700;
  color: #111827;
  margin: 0;
}

.overview-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.switch-label {
  font-size: 12px;
  color: #6B7280;
  white-space: nowrap;
}

/* 严重度分组 */
.overview-severity-group {
  margin-bottom: 16px;
}

.severity-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  padding: 6px 0 8px;
  margin-bottom: 6px;
  border-bottom: 1px solid #F3F4F6;
}
.severity-group-header.severity-error { color: #DC2626; }
.severity-group-header.severity-warning { color: #D97706; }

.severity-dot-sm {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.error-dot { background: #EF4444; }
.warning-dot { background: #F59E0B; }

/* 概览问题卡片 */
.overview-issue-card {
  position: relative;
  padding: 10px 36px 10px 12px;
  background: #FFFFFF;
  border: 1px solid #E5E7EB;
  border-left: 3px solid #EF4444;
  border-radius: 6px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.overview-issue-card:hover {
  border-color: #D1D5DB;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  transform: translateX(2px);
}
.overview-issue-card.warning {
  border-left-color: #F59E0B;
}

.oic-tags {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
}

.oic-desc {
  font-size: 13px;
  font-weight: 600;
  color: #111827;
  margin: 0 0 4px;
  line-height: 1.4;
}

.oic-plain {
  font-size: 12px;
  color: #6B7280;
  margin: 0 0 6px;
  line-height: 1.4;
}

.oic-plain .el-icon {
  margin-right: 4px;
  vertical-align: middle;
}

.oic-preview-row {
  display: flex;
  gap: 4px;
  font-size: 12px;
  line-height: 1.5;
  margin-bottom: 2px;
  overflow: hidden;
}

.oic-preview-label {
  color: #9CA3AF;
  flex-shrink: 0;
  font-weight: 500;
}

.oic-preview-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.oic-preview-text.original {
  color: #DC2626;
  background: #FEF2F2;
  padding: 1px 6px;
  border-radius: 3px;
}
.oic-preview-text.suggested {
  color: #059669;
  background: #ECFDF5;
  padding: 1px 6px;
  border-radius: 3px;
}

.oic-arrow {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 14px;
  color: #9CA3AF;
  opacity: 0;
  transition: opacity 0.15s;
}
.overview-issue-card:hover .oic-arrow {
  opacity: 1;
  color: #3B82F6;
}

/* 查看全部按钮 */
.view-all-wrapper {
  margin-top: 8px;
  text-align: center;
}

.view-all-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  font-size: 12px;
  color: #3B82F6;
  background: #EFF6FF;
  border: 1px solid #BFDBFE;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  font-weight: 500;
}

.view-all-btn:hover {
  background: #DBEAFE;
  border-color: #93C5FD;
  color: #2563EB;
}

.view-all-btn-warning {
  background: #FFFBEB;
  border-color: #FDE68A;
  color: #D97706;
}

.view-all-btn-warning:hover {
  background: #FEF3C7;
  border-color: #FCD34D;
  color: #B45309;
}
</style>
