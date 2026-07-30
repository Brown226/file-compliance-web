<template>
  <div class="agent-issue-list">
    <div class="list-header">
      <span class="list-title">审查结果</span>
      <span class="list-count">共 {{ issues.length }} 项</span>
      <div class="list-filters">
        <el-select
          v-model="filterSeverity"
          placeholder="严重度"
          clearable
          size="small"
          style="width: 90px"
        >
          <el-option label="错误" value="error" />
          <el-option label="警告" value="warning" />
          <el-option label="提示" value="info" />
        </el-select>
        <el-input
          v-model="searchText"
          placeholder="搜索原文/描述..."
          clearable
          size="small"
          style="width: 180px"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
      </div>
    </div>

    <div v-if="filteredIssues.length === 0" class="empty-state">
      <el-icon :size="32" color="#9ca3af"><Document /></el-icon>
      <p>{{ issues.length === 0 ? '暂无审查结果' : '无匹配结果' }}</p>
    </div>

    <div v-else class="issue-cards">
      <div
        v-for="(issue, idx) in filteredIssues"
        :key="issue.id || idx"
        class="issue-card"
        :class="[`severity-${issue.severity || 'warning'}`, { expanded: expandedIds.has(issue.id || String(idx)) }]"
      >
        <div class="card-header" @click="toggleExpand(issue.id || String(idx))">
          <span class="severity-dot" :class="`dot-${issue.severity || 'warning'}`"></span>
          <el-tag size="small" :type="severityTagType(issue.severity)" effect="plain" class="issue-type">
            {{ issueTypeLabel(issue.issueType) }}
          </el-tag>
          <span class="issue-desc">{{ issue.description || issue.originalText?.slice(0, 60) || '无描述' }}</span>
          <span v-if="issue.ruleCode" class="issue-rule">{{ issue.ruleCode }}</span>
          <el-icon class="expand-icon" :class="{ rotated: expandedIds.has(issue.id || String(idx)) }">
            <ArrowDown />
          </el-icon>
        </div>

        <transition name="expand">
          <div v-if="expandedIds.has(issue.id || String(idx))" class="card-body">
            <!-- 原文 / 建议 -->
            <div v-if="issue.originalText" class="section">
              <div class="section-label">原文</div>
              <div class="section-content original">{{ issue.originalText }}</div>
            </div>
            <div v-if="issue.suggestedText" class="section">
              <div class="section-label">建议</div>
              <div class="section-content suggested">{{ issue.suggestedText }}</div>
            </div>
            <div v-if="issue.plainLanguage" class="section">
              <div class="section-label">大白话</div>
              <div class="section-content">{{ issue.plainLanguage }}</div>
            </div>
            <div v-if="issue.standardRef" class="section">
              <div class="section-label">标准引用</div>
              <div class="section-content">{{ issue.standardRef }}</div>
            </div>
            <div v-if="issue.recommendation" class="section">
              <div class="section-label">修改建议</div>
              <div class="section-content">{{ issue.recommendation }}</div>
            </div>

            <!-- 元信息 -->
            <div class="meta-row">
              <span v-if="issue.riskLevel" class="meta-item">
                风险：
                <el-tag size="small" :type="riskTagType(issue.riskLevel)" effect="dark">
                  {{ riskLabel(issue.riskLevel) }}
                </el-tag>
              </span>
              <span v-if="issue.clauseType" class="meta-item">条款：{{ issue.clauseType }}</span>
              <span v-if="issue.fileName" class="meta-item">文件：{{ issue.fileName }}</span>
            </div>
          </div>
        </transition>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Search, ArrowDown, Document } from '@element-plus/icons-vue'
import type { IssueDetail } from '@/views/TaskDetails/types/issue'

/**
 * Agent 审查结果卡片列表（轻量级版 IssueCardList）
 *
 * 与 TaskDetails/IssueCardList 的差异：
 * - 无 batchMode / fp 标记 / locateText 等重度交互（Agent 场景只看结果）
 * - 无 dwgMetadata 高级筛选（Agent 工具返回的 issues 通常不含 dwg 元数据）
 * - 简化为：严重度筛选 + 文本搜索 + 折叠展开
 * - 字段更宽松：允许 issues 为 any[]，只取常见字段
 *
 * 用法：
 *   <AgentIssueList :issues="parsedIssues" />
 */

interface AgentIssue {
  id?: string
  severity?: 'error' | 'warning' | 'info'
  issueType?: string
  ruleCode?: string
  description?: string
  originalText?: string
  suggestedText?: string
  plainLanguage?: string
  standardRef?: string
  recommendation?: string
  riskLevel?: 'HIGH' | 'MEDIUM' | 'LOW'
  clauseType?: string
  fileName?: string
}

const props = defineProps<{
  issues: AgentIssue[] | IssueDetail[]
}>()

const filterSeverity = ref<'error' | 'warning' | 'info' | ''>('')
const searchText = ref('')
const expandedIds = ref<Set<string>>(new Set())

const filteredIssues = computed(() => {
  let result = props.issues as AgentIssue[]
  if (filterSeverity.value) {
    result = result.filter(i => i.severity === filterSeverity.value)
  }
  if (searchText.value.trim()) {
    const q = searchText.value.trim().toLowerCase()
    result = result.filter(i => {
      const desc = (i.description || '').toLowerCase()
      const orig = (i.originalText || '').toLowerCase()
      return desc.includes(q) || orig.includes(q)
    })
  }
  return result
})

function toggleExpand(id: string) {
  if (expandedIds.value.has(id)) {
    expandedIds.value.delete(id)
  } else {
    expandedIds.value.add(id)
  }
}

// ===== 标签与颜色映射 =====

function issueTypeLabel(t?: string): string {
  if (!t) return '未知'
  const map: Record<string, string> = {
    VIOLATION: '违规',
    CONSISTENCY: '一致性',
    COMPLETENESS: '完整性',
    TYPO: '错别字',
    NAMING: '命名',
    UNKNOWN: '未知',
  }
  return map[t] || t
}

function severityTagType(s?: string): 'danger' | 'warning' | 'info' {
  if (s === 'error') return 'danger'
  if (s === 'warning') return 'warning'
  return 'info'
}

function riskLabel(r?: string): string {
  if (r === 'HIGH') return '高'
  if (r === 'MEDIUM') return '中'
  if (r === 'LOW') return '低'
  return r || ''
}

function riskTagType(r?: string): 'danger' | 'warning' | 'info' {
  if (r === 'HIGH') return 'danger'
  if (r === 'MEDIUM') return 'warning'
  return 'info'
}
</script>

<style scoped>
.agent-issue-list {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #ffffff;
  overflow: hidden;
  margin: 8px 0;
}

.list-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  flex-wrap: wrap;
}

.list-title {
  font-weight: 600;
  font-size: 13px;
  color: #1f2937;
}

.list-count {
  font-size: 12px;
  color: #6b7280;
}

.list-filters {
  margin-left: auto;
  display: flex;
  gap: 6px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px;
  color: #9ca3af;
}

.empty-state p {
  margin: 8px 0 0;
  font-size: 12px;
}

.issue-cards {
  max-height: 500px;
  overflow-y: auto;
}

.issue-card {
  border-bottom: 1px solid #f3f4f6;
  transition: background 0.15s;
}

.issue-card:last-child {
  border-bottom: none;
}

.issue-card:hover {
  background: #f9fafb;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
}

.severity-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-error { background: #ef4444; }
.dot-warning { background: #f59e0b; }
.dot-info { background: #3b82f6; }

.issue-type {
  flex-shrink: 0;
}

.issue-desc {
  flex: 1;
  font-size: 12px;
  color: #374151;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.issue-rule {
  font-size: 11px;
  color: #6b7280;
  background: #f3f4f6;
  padding: 1px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}

.expand-icon {
  color: #9ca3af;
  transition: transform 0.2s;
  flex-shrink: 0;
}

.expand-icon.rotated {
  transform: rotate(180deg);
}

.card-body {
  padding: 8px 12px 12px;
  background: #ffffff;
  border-top: 1px solid #f3f4f6;
}

.section {
  margin-bottom: 8px;
}

.section:last-child {
  margin-bottom: 0;
}

.section-label {
  font-size: 11px;
  color: #6b7280;
  margin-bottom: 3px;
  font-weight: 600;
}

.section-content {
  font-size: 12px;
  color: #1f2937;
  line-height: 1.5;
  padding: 6px 8px;
  background: #f9fafb;
  border-radius: 4px;
  word-break: break-all;
}

.section-content.original {
  border-left: 2px solid #ef4444;
}

.section-content.suggested {
  border-left: 2px solid #10b981;
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #f3f4f6;
  font-size: 11px;
  color: #6b7280;
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.expand-enter-active,
.expand-leave-active {
  transition: all 0.2s ease;
  max-height: 400px;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
}
</style>
