<template>
  <div
    :id="`issue-${detail.id}`"
    :class="[
      'issue-card',
      { 'false-positive-card': detail.isFalsePositive },
      { 'issue-highlighted': highlightedId === detail.id },
      { 'batch-selected': selected },
      `severity-${detail.severity}`
    ]"
  >
    <!-- 批量选择 Checkbox -->
    <div class="batch-checkbox-wrapper" v-if="batchMode">
      <el-checkbox
        :model-value="selected"
        @change="(val: boolean) => emit('toggleSelect', detail.id, val)"
        class="batch-checkbox"
      />
    </div>

    <!-- 卡片头部 -->
    <div class="issue-header">
      <div class="issue-tags">
        <el-tag :type="getCategoryTagType(detail.issueType)" size="small" effect="dark" round>
          {{ getIssueTypeLabel(detail.issueType) }}
        </el-tag>
        <el-tag
          :type="getSeverityType(detail.severity)"
          size="small"
          :effect="detail.severity === 'error' ? 'dark' : 'plain'"
          round
          :class="['severity-tag', `severity-${detail.severity}`]"
        >
          {{ getSeverityLabel(detail.severity) }}
        </el-tag>
        <el-tag v-if="detail.isFalsePositive" type="info" size="small" effect="plain" round class="fp-tag">
          误报
        </el-tag>
      </div>
      <span class="issue-desc">{{ detail.description || '-' }}</span>
    </div>

    <!-- 大白话解释 -->
    <div v-if="detail.plainLanguage" class="plain-language-section">
      <div class="plain-language-header">
        <el-icon><ChatLineRound /></el-icon>
        <span>通俗解释</span>
      </div>
      <div class="plain-language-content">
        {{ detail.plainLanguage }}
      </div>
    </div>

    <!-- 卡片内容体 -->
    <div class="issue-body">
      <div class="issue-row">
        <span class="row-label">原文本</span>
        <span class="row-value original-text">
          <template v-if="detail.diffRanges && detail.ruleCode?.startsWith('STD_')">
            <DiffText :text="detail.originalText" :ranges="detail.diffRanges.original || []" mode="red" />
          </template>
          <template v-else>{{ detail.originalText }}</template>
        </span>
      </div>
      <div class="issue-row" v-if="detail.suggestedText">
        <span class="row-label">建议修改</span>
        <span class="row-value suggested-text">
          <template v-if="detail.diffRanges && detail.ruleCode?.startsWith('STD_')">
            <DiffText :text="detail.suggestedText" :ranges="detail.diffRanges.correct || []" mode="green" />
          </template>
          <template v-else>{{ detail.suggestedText }}</template>
        </span>
      </div>

      <!-- 标准引用匹配详情 -->
      <template v-if="detail.ruleCode?.startsWith('STD_')">
        <div class="std-ref-detail-section">
          <span class="row-label">匹配详情</span>
          <div class="std-ref-detail">
            <el-descriptions :column="2" size="small" border>
              <el-descriptions-item label="匹配级别" v-if="detail.matchLevel != null">
                <el-tag size="small" :type="detail.matchLevel <= 2 ? 'success' : detail.matchLevel <= 6 ? 'warning' : 'info'">
                  Level {{ detail.matchLevel }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="相似度" v-if="detail.similarity != null">
                {{ (detail.similarity * 100).toFixed(1) }}%
              </el-descriptions-item>
              <el-descriptions-item label="标准编号" v-if="detail.suggestedText" :span="2">
                <span class="correct-value">{{ detail.suggestedText }}</span>
              </el-descriptions-item>
            </el-descriptions>
          </div>
        </div>
      </template>

      <!-- DWG 专属信息区域 -->
      <template v-if="detail.dwgMetadata">
        <div class="dwg-info-section">
          <div class="issue-row" v-if="detail.dwgMetadata.layer">
            <span class="row-label">图层</span>
            <span class="dwg-layer-badge" :style="{ '--layer-color': getLayerColor(detail.dwgMetadata.layer) }">
              <span class="layer-dot"></span>
              {{ detail.dwgMetadata.layer }}
            </span>
          </div>
          <div class="issue-row" v-if="detail.dwgMetadata.entityType">
            <span class="row-label">图元类型</span>
            <el-tag size="small" effect="plain" round type="info">
              {{ getEntityTypeLabel(detail.dwgMetadata.entityType) }}
            </el-tag>
          </div>
          <div class="issue-row" v-if="detail.dwgMetadata.position">
            <span class="row-label">坐标位置</span>
            <span class="dwg-coord-text">
              X: {{ detail.dwgMetadata.position.x.toFixed(2) }},
              Y: {{ detail.dwgMetadata.position.y.toFixed(2) }}
              <template v-if="detail.dwgMetadata.position.z != null">
                , Z: {{ detail.dwgMetadata.position.z.toFixed(2) }}
              </template>
            </span>
          </div>
          <div class="issue-row" v-if="detail.dwgMetadata.blockName">
            <span class="row-label">所属块</span>
            <span class="dwg-block-text">{{ detail.dwgMetadata.blockName }}</span>
          </div>
        </div>
      </template>

      <div class="issue-row" v-if="detail.cadHandleId">
        <span class="row-label">CAD Handle</span>
        <span class="cad-handle-badge">{{ detail.cadHandleId }}</span>
      </div>
      <div class="issue-row" v-if="detail.file && !selectedFileId">
        <span class="row-label">所属文件</span>
        <span class="row-value link-value" @click="emit('selectFileById', detail.fileId)">{{ detail.file.fileName }}</span>
      </div>

      <!-- 标准条文（相似文档） -->
      <template v-if="detail.sourceReferences && detail.sourceReferences.length > 0">
        <div class="source-refs-section">
          <span class="row-label">相似文档</span>
          <div class="source-list">
            <div v-if="detail.sourceReferences.length > 3" class="source-top-hint">
              仅展示 Top {{ topSourceRefs(detail.sourceReferences).length }} 相似结果
            </div>
            <el-collapse>
              <el-collapse-item
                v-for="(ref, idx) in topSourceRefs(detail.sourceReferences)"
                :key="idx"
                :name="idx"
              >
                <template #title>
                  <span class="source-title">
                    {{ ref.document_name || `参考文档 ${idx + 1}` }}
                    <el-tag size="small" type="info" effect="plain" round v-if="ref.similarity != null">
                      {{ (ref.similarity * 100).toFixed(1) }}%
                    </el-tag>
                  </span>
                </template>
                <div class="source-content">{{ ref.content }}</div>
              </el-collapse-item>
            </el-collapse>
          </div>
        </div>
      </template>
      <div class="issue-row" v-else-if="detail.standardRef">
        <span class="row-label">标准条文</span>
        <span class="row-value standard-ref-value">{{ detail.standardRef }}</span>
      </div>
      <div class="issue-row" v-if="detail.standardRefId">
        <span class="row-label">关联标准</span>
        <router-link :to="`/standards`" class="link-value">查看标准详情</router-link>
      </div>
      <div class="issue-row fp-reason-row" v-if="detail.isFalsePositive && detail.fpReason">
        <span class="row-label">误报原因</span>
        <span class="fp-reason-text">{{ detail.fpReason }}</span>
      </div>
    </div>

    <!-- 卡片底部操作栏 -->
    <div class="issue-footer">
      <div class="footer-actions">
        <el-button
          v-if="detail.textPosition"
          type="primary"
          size="small"
          @click="emit('locateText', { detail, elementId: `issue-${detail.id}` })"
          class="action-btn"
        >
          <el-icon><Location /></el-icon> 定位
        </el-button>
        <el-button
          v-if="detail.cadHandleId"
          type="primary"
          size="small"
          @click="emit('copyHandleId', detail.cadHandleId)"
          class="action-btn cad-locate-btn"
        >
          <el-icon><CopyDocument /></el-icon> CAD 定位
          <template #loading>
            <el-icon class="is-loading"><CopyDocument /></el-icon> 复制中...
          </template>
        </el-button>
        <el-button
          v-if="!detail.isFalsePositive"
          type="warning"
          size="small"
          plain
          @click="emit('openFpDialog', detail)"
          class="action-btn action-fp-btn"
        >
          标记误报
        </el-button>
        <el-button
          v-if="isDocxSelected && detail.suggestedText && !detail.isFalsePositive"
          type="success"
          size="small"
          plain
          @click="emit('adoptSuggestion', detail)"
          class="action-btn"
        >
          <el-icon><Check /></el-icon> 采纳建议
        </el-button>
        <el-button
          v-else-if="detail.isFalsePositive"
          type="info"
          size="small"
          plain
          @click="emit('cancelFp', detail)"
          class="action-btn"
        >
          取消误报
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { IssueDetail } from './types/issue'
import {
  CopyDocument,
  Location,
  ChatLineRound,
  Check,
} from '@element-plus/icons-vue'
import DiffText from './DiffText.vue'
import { useIssueHelpers } from './composables'

const props = defineProps<{
  detail: IssueDetail
  batchMode: boolean
  selected: boolean
  isDocxSelected?: boolean
  highlightedId?: string | null
  selectedFileId?: string | null
}>()

const emit = defineEmits<{
  locateText: [payload: { detail: IssueDetail; elementId: string }]
  copyHandleId: [handleId: string]
  openFpDialog: [detail: IssueDetail]
  adoptSuggestion: [detail: IssueDetail]
  cancelFp: [detail: IssueDetail]
  toggleSelect: [issueId: string, isSelected: boolean]
  selectFileById: [fileId: string]
}>()

const {
  getIssueTypeLabel,
  getCategoryTagType,
  getSeverityType,
  getSeverityLabel,
  getLayerColor,
  getEntityTypeLabel,
  topSourceRefs,
} = useIssueHelpers()
</script>

<style scoped>
/* ===== 问题卡片 — 左侧彩色竖条（参考项目核心模式） ===== */
.issue-card {
  margin-bottom: 10px;
  background: #FFFFFF;
  border-radius: var(--radius-md);
  box-shadow: var(--border-inset), 0 1px 2px rgba(0, 0, 0, 0.04);
  overflow: hidden;
  transition: box-shadow 0.15s ease;
  border-left: 4px solid transparent;
}
.issue-card.severity-error   { border-left-color: #EF4444; }
.issue-card.severity-warning { border-left-color: #F59E0B; }
.issue-card.severity-info    { border-left-color: #6B7280; }
.issue-card:hover { box-shadow: var(--border-inset), 0 4px 12px rgba(0, 0, 0, 0.06); }

.issue-header {
  padding: 10px 14px 8px;
  border-bottom: 1px solid #F0F0F0;
}
.issue-tags { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-bottom: 6px; }
.issue-desc {
  font-size: 14px;
  font-weight: 700;
  color: #111827;
  line-height: 1.4;
  display: block;
}
.severity-tag { font-size: 11px; letter-spacing: 0.02em; }
.severity-error { font-weight: 800; }
.fp-tag {
  font-style: italic;
  background: #F3E8FF !important;
  color: #7C3AED !important;
}

/* 大白话解释 — 蓝色左侧竖条 */
.plain-language-section {
  margin: 0 14px 10px;
  border-left: 4px solid #60A5FA;
  background: #EFF6FF;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  overflow: hidden;
}
.plain-language-header {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: 700;
  color: #1E40AF;
  transition: background 0.12s;
}
.plain-language-header:hover { background: rgba(59, 130, 246, 0.06); }
.plain-language-content {
  padding: 0 10px 8px;
  font-size: var(--text-base);
  line-height: 1.6;
  color: #1E40AF;
}

.issue-body {
  padding: 10px 14px;
  font-size: var(--text-base);
  color: #374151;
  line-height: 1.6;
}
.issue-row {
  display: flex;
  margin-bottom: 8px;
  align-items: flex-start;
  gap: 10px;
}
.issue-row:last-child { margin-bottom: 0; }
.row-label {
  width: 72px;
  flex-shrink: 0;
  color: #666666;
  font-weight: 700;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  padding-top: 2px;
}
.row-value { flex: 1; word-break: break-all; line-height: 1.5; }

/* 原文本 & 建议修改 — 参考项目的 blockquote 色块风格 */
.original-text, .suggested-text {
  padding: 6px 10px;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  font-weight: 500;
  display: inline-block;
  max-width: 100%;
  font-size: var(--text-base);
  line-height: 1.5;
}
/* 红色竖条 = 原文 */
.original-text {
  color: #991B1B;
  background: #FEE2E2;
  border-left: 4px solid #F87171;
}
/* 绿色竖条 = 建议 */
.suggested-text {
  color: #166534;
  background: #DCFCE7;
  border-left: 4px solid #34D399;
}

.cad-handle-badge {
  font-family: var(--font-mono);
  background: #EFF6FF;
  color: #3B82F6;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  font-weight: 700;
  display: inline-block;
}
.link-value {
  color: #3B82F6;
  cursor: pointer;
  text-decoration: none;
  font-weight: 600;
  font-size: var(--text-base);
}
.link-value:hover { color: #2563EB; text-decoration: underline; }
.standard-ref-value {
  color: #1E40AF;
  font-weight: 600;
  background: #EFF6FF;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  display: inline-block;
  font-size: var(--text-sm);
}

/* 标准引用匹配详情 */
.std-ref-detail-section {
  display: flex;
  margin-bottom: 8px;
  align-items: flex-start;
  gap: 10px;
}
.std-ref-detail { flex: 1; min-width: 0; }
.std-ref-detail :deep(.el-descriptions) { margin: 0; }
.std-ref-detail :deep(.el-descriptions__label) {
  width: 72px;
  font-size: var(--text-sm);
  color: #666666;
}
.std-ref-detail :deep(.el-descriptions__content) { font-size: var(--text-sm); }
.correct-value {
  color: #10B981;
  font-weight: 600;
  font-family: var(--font-mono);
}

/* DWG 专属信息区域 */
.dwg-info-section {
  margin-bottom: 8px;
  padding: 6px 10px;
  background: #FFF7ED;
  border-radius: var(--radius-sm);
  border-left: 4px solid #FB923C;
}
.dwg-layer-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 10px;
  border-radius: var(--radius-full);
  background: #EFF6FF;
  color: var(--layer-color, #3B82F6);
  font-size: var(--text-sm);
  font-weight: 700;
  font-family: var(--font-mono);
}
.dwg-layer-badge .layer-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--layer-color, #3B82F6);
  flex-shrink: 0;
}
.dwg-coord-text {
  font-family: var(--font-mono);
  font-size: 11px;
  color: #6B7280;
  background: #FAFAFA;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
}
.dwg-block-text {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: #3B82F6;
  font-weight: 600;
}

.cad-locate-btn {
  position: relative;
  transition: all 0.15s ease;
}
.cad-locate-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.2);
}

.source-refs-section { margin-top: 4px; }
.source-list { flex: 1; min-width: 0; }
.source-top-hint { font-size: 11px; color: #6B7280; font-style: italic; margin-bottom: 4px; }
::deep(.el-collapse) { border: none; }
::deep(.el-collapse-item__header) {
  height: auto; min-height: 28px; line-height: 1.5; font-size: var(--text-base);
  border-bottom: none; padding: 3px 0; background: transparent;
}
::deep(.el-collapse-item__wrap) { border-bottom: none; }
::deep(.el-collapse-item__content) { padding: 6px 0 3px 14px; }
.source-title {
  display: flex; align-items: center; gap: 6px;
  font-size: var(--text-base); color: #3B82F6; font-weight: 600;
}
.source-content {
  padding: 8px 10px;
  background: #EFF6FF;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  border-left: 3px solid #3B82F6;
  font-size: var(--text-sm);
  line-height: 1.6;
  color: #374151;
  white-space: pre-wrap;
  word-break: break-all;
}

.fp-reason-row .fp-reason-text {
  color: #6B7280;
  font-style: italic;
  font-size: var(--text-sm);
  padding: 3px 10px;
  background: #FAFAFA;
  border-radius: var(--radius-sm);
  display: inline-block;
}

.issue-footer {
  padding: 8px 14px;
  border-top: 1px solid #F0F0F0;
  background: #FAFAFA;
  display: flex;
  justify-content: flex-end;
}
.footer-actions { display: flex; gap: 8px; }
.action-btn {
  font-size: var(--text-sm);
  border-radius: var(--radius-md);
  font-weight: 600;
  padding: 5px 12px;
}
.action-fp-btn.el-button {
  border-color: #D97706 !important;
  color: #92400E !important;
  background: #FEF3C7 !important;
}
.action-fp-btn.el-button:hover { background: #FDE68A !important; }

.false-positive-card.false-positive-card {
  opacity: 0.6;
  background: repeating-linear-gradient(-45deg, #FFFFFF, #FFFFFF 8px, #FAFAFA 8px, #FAFAFA 16px);
  border: 1px dashed #D1D5DB;
}
.false-positive-card:hover { opacity: 0.8; }

.issue-highlighted {
  animation: highlight-pulse 0.5s ease-out;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.5) !important;
  z-index: 100;
}
@keyframes highlight-pulse {
  0% { box-shadow: 0 0 0 6px rgba(59, 130, 246, 0.6); }
  50% { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.4); }
  100% { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.5); }
}

/* 批量选择 Checkbox 样式 */
.batch-checkbox-wrapper {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 5;
  background: white;
  border-radius: 50%;
  padding: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
  transition: all 0.2s ease;
}

.batch-checkbox-wrapper:hover {
  box-shadow: 0 3px 10px rgba(64, 158, 255, 0.2);
  transform: scale(1.05);
}

.batch-checkbox :deep(.el-checkbox__inner) {
  width: 18px;
  height: 18px;
  border-radius: 4px;
}

.batch-checkbox :deep(.el-checkbox__inner::after) {
  width: 5px;
  height: 9px;
  left: 6px;
  top: 2px;
}

/* 批量选中状态的卡片样式 */
.issue-card.batch-selected {
  border-left-color: #409EFF !important;
  box-shadow:
    var(--border-inset),
    0 0 0 2px rgba(64, 158, 255, 0.15),
    0 4px 12px rgba(64, 158, 255, 0.1) !important;
  transition: all 0.25s ease;
}

.issue-card.batch-selected:hover {
  box-shadow:
    var(--border-inset),
    0 0 0 2px rgba(64, 158, 255, 0.25),
    0 6px 20px rgba(64, 158, 255, 0.15) !important;
}
</style>
