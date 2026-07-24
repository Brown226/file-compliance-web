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
          <p v-if="showPlainLanguage && issue.plainLanguage" class="oic-plain">💡 {{ issue.plainLanguage }}</p>
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
          <p v-if="showPlainLanguage && issue.plainLanguage" class="oic-plain">💡 {{ issue.plainLanguage }}</p>
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
import { ArrowRight } from '@element-plus/icons-vue'
import type { TaskDetail } from '@/types/models'

defineProps<{
  issueCount: number
  errorIssues: TaskDetail[]
  warningIssues: TaskDetail[]
  showPlainLanguage: boolean
  getCategoryTagType: (issueType: string) => 'danger' | 'warning' | 'info' | 'success' | 'primary'
  getIssueTypeLabel: (issueType: string) => string
  truncateText: (text: string, maxLen: number) => string
}>()

const emit = defineEmits<{
  (e: 'update:showPlainLanguage', value: boolean): void
  (e: 'navigate', issue: TaskDetail): void
  (e: 'view-all'): void
}>()
</script>
