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

    <!-- 卡片头部：标签 + 描述 + 操作按钮 + 展开箭头 -->
    <div class="issue-header" @click="cardExpanded = !cardExpanded">
      <div class="header-left">
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
          <!-- UNVERIFIED 标记：AI 推测无依据 -->
          <el-tag
            v-if="detail.plainLanguage?.includes('⚠️')"
            type="warning"
            size="small"
            effect="dark"
            round
          >
            ⚠️ AI 推测
          </el-tag>
          <el-tag v-if="detail.isFalsePositive" type="info" size="small" effect="plain" round class="fp-tag">
            误报
          </el-tag>
          <!-- P1-6: 待人工复核徽标（AI_INFERRED 纯推断 / 合同 HIGH 风险 / 判标 LOW 置信度） -->
          <el-tag
            v-if="detail.reviewStatus === 'PENDING_REVIEW'"
            type="warning"
            size="small"
            effect="dark"
            round
            :title="detail.judgeReason || '该条目为低置信度/推断结果，建议人工复核后确认'"
          >
            待复核
          </el-tag>
          <!-- P1-6: 判标置信度（LOW 已由"待复核"徽标承载，避免双标签） -->
          <el-tag
            v-if="detail.judgeConfidence && detail.judgeConfidence !== 'LOW'"
            :type="detail.judgeConfidence === 'HIGH' ? 'success' : 'info'"
            size="small"
            effect="plain"
            round
            :title="detail.judgeReason || ''"
          >
            判标 {{ detail.judgeConfidence }}
          </el-tag>
          <!-- 合同审查：风险等级 + 条款类型 -->
          <el-tag
            v-if="reviewMode === 'CONTRACT_REVIEW' && detail.riskLevel"
            :type="detail.riskLevel === 'HIGH' ? 'danger' : detail.riskLevel === 'MEDIUM' ? 'warning' : 'info'"
            size="small" effect="dark" round
          >
            {{ riskLevelLabel(detail.riskLevel) }}
          </el-tag>
          <el-tag
            v-if="reviewMode === 'CONTRACT_REVIEW' && detail.clauseType"
            type="info" size="small" effect="plain" round
          >
            {{ clauseTypeLabel(detail.clauseType) }}
          </el-tag>
          <!-- 文件来源标签 -->
          <el-tag v-if="detail.file && !selectedFileId" type="info" size="small" effect="plain" round class="file-source-tag">
            <span class="file-icon-inline">{{ getFileEmoji(detail.file.fileType || detail.file.file_type) }}</span>
            {{ detail.file.fileName }}
          </el-tag>
          <!-- Task 42: dwg-vision 置信度标记（低于 0.6 待人工复核） -->
          <el-tag
            v-if="detail.confidence != null && detail.confidence < 0.6"
            type="warning"
            size="small"
            effect="dark"
            round
          >
            待复核
          </el-tag>
          <!-- Task 21: SoM 区域标号 -->
          <el-tag
            v-if="detail.markId != null"
            type="info"
            size="small"
            effect="plain"
            round
          >
            区域 {{ detail.markId }}
          </el-tag>
        </div>
        <span class="issue-desc">{{ detail.description || '-' }}</span>
        <!-- 大白话解释，默认展示 -->
        <span v-if="detail.plainLanguage" class="plain-language-preview">
          · {{ detail.plainLanguage }}
        </span>
        <!-- 2026-08-26：判标 LOW / 待复核条目卡内展示判标理由（此前仅 hover title 可见） -->
        <span
          v-if="detail.reviewStatus === 'PENDING_REVIEW' && detail.judgeReason"
          class="judge-reason-preview"
        >
          <el-icon :size="12"><InfoFilled /></el-icon> 判标：{{ detail.judgeReason }}
        </span>
        <!-- 折叠态预览：原文/建议首行 -->
        <div v-if="!cardExpanded" class="collapsed-preview">
          <div v-if="detail.originalText" class="collapsed-row original">
            <span class="collapsed-label">原：</span>{{ truncateIssueText(detail.originalText, 80) }}
          </div>
          <div v-if="detail.suggestedText" class="collapsed-row suggested">
            <span class="collapsed-label">改：</span>{{ truncateIssueText(detail.suggestedText, 80) }}
          </div>
        </div>
      </div>
      <div class="header-right">
        <!-- 快捷操作按钮 -->
        <div class="header-quick-actions" @click.stop>
          <el-tooltip content="定位原文" placement="top" :show-after="300">
            <el-button
              v-if="detail.textPosition || detail.cadHandleId"
              circle
              size="small"
              class="locate-action-btn"
              @click="emit('locateText', { detail, elementId: `issue-${detail.id}` })"
            >
              <el-icon :size="14"><Location /></el-icon>
            </el-button>
          </el-tooltip>
          <!-- Task 42: dwg-vision 定位图纸 bbox -->
          <el-tooltip content="定位图纸区域" placement="top" :show-after="300">
            <el-button
              v-if="detail.bbox"
              circle
              size="small"
              class="locate-bbox-btn"
              @click="emit('locateBbox', detail)"
            >
              <el-icon :size="14"><Aim /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip :content="detail.isFalsePositive ? '取消误报' : '标记误报'" placement="top" :show-after="300">
            <el-button
              circle
              size="small"
              :class="['fp-action-btn', { 'is-fp': detail.isFalsePositive }]"
              @click="detail.isFalsePositive ? emit('cancelFp', detail) : emit('openFpDialog', detail)"
            >
              <el-icon :size="14"><WarningFilled /></el-icon>
            </el-button>
          </el-tooltip>
          <!-- P2-2: 单条采纳建议（不限文件类型，此前仅 docx 有批量采纳入口） -->
          <el-tooltip :content="detail.adopted ? '取消采纳' : '采纳建议'" placement="top" :show-after="300">
            <el-button
              circle
              size="small"
              :class="['adopt-action-btn', { 'is-adopted': detail.adopted }]"
              @click="emit('toggleAdopt', detail)"
            >
              <el-icon :size="14"><CircleCheckFilled /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
        <!-- 展开箭头 -->
        <el-icon class="expand-arrow" :class="{ rotated: cardExpanded }"><ArrowDown /></el-icon>
      </div>
    </div>

    <!-- 卡片内容体：可折叠 -->
    <div v-show="cardExpanded" class="issue-body">
      <!-- 原文 / 建议修改 — 双向 diff 高亮 -->
      <div class="issue-row" v-if="detail.originalText">
        <span class="row-label">原文本</span>
        <span class="row-value original-text">
          <DiffHighlight
            :original="detail.originalText"
            :suggested="detail.suggestedText || ''"
            mode="original"
          />
        </span>
      </div>
      <div class="issue-row" v-if="detail.suggestedText">
        <span class="row-label">建议修改</span>
        <span class="row-value suggested-text">
          <DiffHighlight
            :original="detail.originalText || ''"
            :suggested="detail.suggestedText"
            mode="suggested"
          />
        </span>
      </div>

      <!-- 合同审查：修改建议 -->
      <div v-if="reviewMode === 'CONTRACT_REVIEW' && detail.recommendation" class="recommendation-section">
        <div class="recommendation-header">
          <el-icon><Edit /></el-icon>
          <span>修改建议</span>
        </div>
        <div class="recommendation-body">
          {{ detail.recommendation }}
        </div>
      </div>

      <!-- 标准条文 — 提权展示 -->
      <div v-if="detail.standardRef" class="standard-ref-section">
        <div class="standard-ref-header">
          <el-icon><Reading /></el-icon>
          <span>审查依据</span>
        </div>
        <div class="standard-ref-body">
          {{ detail.standardRef }}
        </div>
      </div>

      <!-- Task 28: 规范条文链接（dwg-vision compliance 专属） -->
      <div v-if="detail.clauseRef" class="clause-ref-section">
        <div class="clause-ref-header">
          <el-icon><DocumentIcon /></el-icon>
          <span class="clause-ref-label">规范条文</span>
          <span class="clause-ref-text">{{ detail.clauseRef }}</span>
          <el-button
            v-if="detail.clauseText"
            link
            type="primary"
            size="small"
            class="view-clause-btn"
            @click="emit('openClause', detail)"
          >
            查看条文
          </el-button>
        </div>
      </div>

      <!-- Task 22: CoT 推理过程（dwg-vision 专属，可折叠） -->
      <div v-if="detail.reasoning" class="reasoning-section">
        <el-collapse>
          <el-collapse-item name="reasoning">
            <template #title>
              <div class="reasoning-title">
                <el-icon><Warning /></el-icon>
                <span>推理过程</span>
              </div>
            </template>
            <div class="reasoning-body">{{ detail.reasoning }}</div>
          </el-collapse-item>
        </el-collapse>
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
                {{ (Math.min(detail.similarity, 1) * 100).toFixed(1) }}%
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

      <!-- 相似文档 -->
      <template v-if="detail.sourceReferences && detail.sourceReferences.length > 0">
        <div class="source-refs-section">
          <span class="row-label">相似文档</span>
          <div class="source-list">
            <el-alert
              v-if="detail.sourceReferences.length > 3"
              :title="`仅展示 Top ${topSourceRefs(detail.sourceReferences).length} 相似结果`"
              type="info"
              :closable="false"
              size="small"
              show-icon
              class="source-top-hint"
            />
            <el-collapse>
              <el-collapse-item
                v-for="(ref, idx) in topSourceRefs(detail.sourceReferences)"
                :key="idx"
                :name="idx"
              >
                <template #title>
                  <span class="source-title">
                    {{ ref.document_name || `参考文档 ${idx + 1}` }}
                    <el-tag size="small" type="warning" effect="plain" round v-if="ref.unverified" title="该引用未在检索结果/原文中核实，可能由 AI 编造">
                      引用存疑
                    </el-tag>
                    <el-tag size="small" type="info" effect="plain" round v-if="ref.similarity != null">
                      {{ (Math.min(ref.similarity, 1) * 100).toFixed(1) }}%
                    </el-tag>
                  </span>
                </template>
                <div
                  class="source-content"
                  :class="{ 'source-content--clamped': !expandedSources[idx] }"
                  @click="expandedSources[idx] = !expandedSources[idx]"
                >
                  {{ ref.content }}
                </div>
                <div v-if="shouldShowExpand(ref.content)" class="source-expand-btn">
                  <el-button link size="small" @click="expandedSources[idx] = !expandedSources[idx]">
                    {{ expandedSources[idx] ? '收起' : '展开全文' }}
                  </el-button>
                </div>
              </el-collapse-item>
            </el-collapse>
          </div>
        </div>
      </template>

      <div class="issue-row" v-if="detail.standardRefId">
        <span class="row-label">关联标准</span>
        <router-link :to="`/standards`" class="link-value">查看标准详情</router-link>
      </div>
      <div class="issue-row fp-reason-row" v-if="detail.isFalsePositive && detail.fpReason">
        <span class="row-label">误报原因</span>
        <span class="fp-reason-text">{{ detail.fpReason }}</span>
      </div>

      <!-- OPT-015: 审查结果反馈 -->
      <div v-if="taskId && !detail.isFalsePositive" class="issue-row feedback-row">
        <span class="row-label">质量反馈</span>
        <div class="feedback-actions">
          <template v-if="!feedbackSubmitted">
            <el-button size="small" :loading="feedbackLoading === 'useful'" class="fb-btn fb-useful" @click="submitFeedback('useful')">
              <el-icon><CircleCheck /></el-icon> 有用
            </el-button>
            <el-button size="small" :loading="feedbackLoading === 'false_positive'" class="fb-btn fb-fp" @click="submitFeedback('false_positive')">
              <el-icon><WarningFilled /></el-icon> 误报
            </el-button>
            <el-button size="small" :loading="feedbackLoading === 'missed'" class="fb-btn fb-missed" @click="submitFeedback('missed')">
              <el-icon><Warning /></el-icon> 漏报
            </el-button>
          </template>
          <span v-else class="fb-done">
            <el-icon><CircleCheckFilled /></el-icon> 已反馈：{{ feedbackLabel }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'
import type { IssueDetail } from './types/issue'
import {
  CopyDocument,
  Location,
  ArrowDown,
  Reading,
  WarningFilled,
  Warning,
  CircleCheck,
  CircleCheckFilled,
  Edit,
  Aim,
  Document as DocumentIcon,
} from '@element-plus/icons-vue'
import DiffHighlight from './DiffHighlight.vue'
import { useIssueHelpers } from './composables'
import { submitReviewFeedbackApi, type FeedbackType } from '@/api/dashboard'

const props = defineProps<{
  detail: IssueDetail
  batchMode: boolean
  selected: boolean
  isDocxSelected?: boolean
  highlightedId?: string | null
  selectedFileId?: string | null
  forceExpanded?: boolean
  reviewMode?: string
  taskId?: string
}>()

const emit = defineEmits<{
  locateText: [payload: { detail: IssueDetail; elementId: string }]
  copyHandleId: [handleId: string]
  openFpDialog: [detail: IssueDetail]
  cancelFp: [detail: IssueDetail]
  /** P2-2: 单条采纳/取消采纳 */
  toggleAdopt: [detail: IssueDetail]
  toggleSelect: [issueId: string, isSelected: boolean]
  selectFileById: [fileId: string]
  // Task 42: dwg-vision 专属事件
  /** 点击"定位图纸"按钮，触发 SVG 叠框 pan/zoom 到 bbox 区域 */
  locateBbox: [detail: IssueDetail]
  /** 点击"查看条文"按钮，弹窗展示 clauseRef + clauseText */
  openClause: [detail: IssueDetail]
}>()

// 卡片展开状态：error 默认展开，其他默认折叠
const cardExpanded = ref(props.detail.severity === 'error')

// 来源内容展开状态
const expandedSources = reactive<Record<number, boolean>>({})

const shouldShowExpand = (content: string | undefined | null): boolean =>
  (content?.length ?? 0) > 400

/** 截断文本（折叠态预览用） */
const truncateIssueText = (text: string, maxLen: number): string => {
  if (!text) return ''
  const t = text.trim()
  return t.length > maxLen ? t.slice(0, maxLen) + '...' : t
}

/** 响应外部全部展开/折叠控制 */
watch(() => props.forceExpanded, (val) => {
  if (val !== undefined) cardExpanded.value = val
})

/** 根据文件类型返回 emoji 图标 */
const getFileEmoji = (fileType: string | undefined): string => {
  if (!fileType) return '📎'
  const t = fileType.toLowerCase()
  if (t === 'docx' || t === 'doc') return '📄'
  if (t === 'dwg' || t === 'dxf') return '📐'
  if (t === 'pdf') return '📕'
  if (t === 'xlsx' || t === 'xls') return '📊'
  if (t === 'pptx' || t === 'ppt') return '📽'
  return '📎'
}

const {
  getIssueTypeLabel,
  getCategoryTagType,
  getSeverityType,
  getSeverityLabel,
  getLayerColor,
  getEntityTypeLabel,
  topSourceRefs,
} = useIssueHelpers()

/** 条款类型中文映射 */
const clauseTypeLabel = (type: string): string => {
  const map: Record<string, string> = {
    payment: '付款条款', penalty: '违约条款', warranty: '质保条款',
    ip: '知识产权', change: '变更条款', claim: '索赔条款',
    insurance: '保险条款', dispute: '争议解决', other: '其他',
  }
  return map[type] || type
}

/** 风险等级中文标签（纯文字，无 emoji） */
const riskLevelLabel = (level: string): string => {
  const map: Record<string, string> = {
    HIGH: '高风险',
    MEDIUM: '中风险',
    LOW: '低风险',
  }
  return map[level] || level
}

// ===== OPT-015: 审查结果反馈 =====
const feedbackLoading = ref<FeedbackType | null>(null)
const feedbackSubmitted = ref(false)
const feedbackLabel = computed(() => {
  switch (feedbackLoading.value) {
    case 'useful': return '有用'
    case 'false_positive': return '误报'
    case 'missed': return '漏报'
    default: return ''
  }
})

async function submitFeedback(type: FeedbackType) {
  if (!props.taskId || !props.detail.id) return
  feedbackLoading.value = type
  try {
    await submitReviewFeedbackApi(props.taskId, String(props.detail.id), {
      feedbackType: type,
      fileId: props.detail.fileId,
    })
    feedbackSubmitted.value = true
    feedbackLoading.value = type // 保留用于显示 label
    ElMessage.success('反馈已提交')
  } catch (e: any) {
    ElMessage.error(e?.message || '反馈提交失败')
    feedbackLoading.value = null
  }
}
</script>

<style scoped>
/* ===== 问题卡片 — 简化紧凑版 ===== */
.issue-card {
  margin-bottom: 8px;
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  transition: box-shadow 0.15s ease;
  border-left: 3px solid transparent;
}
.issue-card.severity-error   { border-left-color: var(--corp-danger); }
.issue-card.severity-warning { border-left-color: var(--corp-warning); }
.issue-card.severity-info    { border-left-color: var(--corp-text-secondary); }
.issue-card:hover { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12); }

/* ===== 头部：标签 + 描述 + 操作按钮 + 展开箭头 ===== */
.issue-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  cursor: pointer;
}
.issue-header:hover {
  background: var(--color-gray-50);
}
.header-left { flex: 1; min-width: 0; }
.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.header-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  align-items: center;
  flex-wrap: nowrap;
}

.issue-tags { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-bottom: 4px; }
.issue-desc {
  font-size: 13px;
  font-weight: 600;
  color: var(--corp-text-primary);
  line-height: 1.4;
  display: block;
}
.plain-language-preview {
  font-size: 12px;
  color: var(--corp-text-secondary);
  line-height: 1.4;
  margin-top: 2px;
  display: block;
}

/* 2026-08-26：判标理由预览（待复核条目，卡内可见） */
.judge-reason-preview {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  margin-top: 4px;
  padding: 4px 8px;
  background: var(--color-warning-bg);
  border-left: 2px solid var(--color-warning-600);
  border-radius: 3px;
  font-size: 12px;
  color: var(--color-warning-text);
  line-height: 1.4;
}

/* 折叠态预览：原文/建议首行 */
.collapsed-preview {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.collapsed-row {
  font-size: 12px;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 6px;
  border-radius: 3px;
}
.collapsed-row.original {
  color: var(--color-danger-600);
  background: var(--color-danger-bg); /* #FEF2F2 对齐 --color-danger-bg */
}
.collapsed-row.suggested {
  color: var(--color-success-600);
  background: var(--color-success-bg); /* #ECFDF5 对齐 --color-success-bg */
}
.collapsed-label {
  font-weight: 600;
  margin-right: 3px;
}

.severity-tag { font-size: 12px; }
.severity-error { font-weight: 700; }
.fp-tag {
  font-style: italic;
  background: #F3E8FF !important; /* 紫色专用底，无对应令牌 */
  color: #7C3AED !important; /* 紫色专用字，无对应令牌 */
}

/* 文件来源标签 */
.file-source-tag {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-icon-inline {
  margin-right: 3px;
  font-size: 12px;
}


/* 快捷操作按钮（始终可见，彩色） */
.header-quick-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.locate-action-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: var(--color-primary-50);
  color: var(--color-primary-600);
  border-radius: 6px;
  transition: all 0.15s ease;
}
.locate-action-btn:hover {
  background: var(--color-primary-100);
  color: var(--color-primary-700);
  transform: scale(1.1);
}
.fp-action-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: var(--color-warning-bg);
  color: var(--color-warning-600);
  border-radius: 6px;
  transition: all 0.15s ease;
}
.fp-action-btn:hover {
  background: #FDE68A; /* 无对应令牌，对齐 --color-warning-bg 或专用色 */
  color: var(--color-warning-text); /* #B45309 对齐 --color-warning-text */
  transform: scale(1.1);
}
.fp-action-btn.is-fp {
  background: var(--bg-surface-active);
  color: var(--corp-text-secondary);
}
.fp-action-btn.is-fp:hover {
  background: var(--corp-border-light);
  color: var(--color-gray-700);
}

/* 展开箭头 */
.expand-arrow {
  font-size: 16px;
  color: var(--color-gray-400);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}
.expand-arrow.rotated {
  transform: rotate(180deg);
}

/* ===== 卡片内容体 ===== */
.issue-body {
  padding: 8px 12px 12px;
  border-top: 1px solid var(--color-gray-100); /* 原 #F0F0F0 */
  background: var(--bg-surface-hover);
}

/* ===== 问题行 ===== */
.issue-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  align-items: flex-start;
}
.row-label {
  font-size: 12px;
  color: var(--corp-text-secondary);
  font-weight: 500;
  min-width: 65px;
  flex-shrink: 0;
  padding-top: 2px;
}
.row-value {
  flex: 1;
  font-size: 13px;
  color: var(--color-gray-800);
  line-height: 1.5;
  word-break: break-word;
}
.original-text {
  background: var(--color-danger-bg); /* #FEF2F2 对齐 --color-danger-bg */
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid #FECACA; /* 无对应令牌，对齐 --color-danger-bg 或专用色 */
}
.suggested-text {
  background: var(--color-success-bg); /* #F0FDF4 对齐 --color-success-bg */
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid #BBF7D0; /* 无对应令牌，对齐 --color-success-bg 或专用色 */
}
.fp-reason-row .fp-reason-text {
  color: #7C3AED; /* 紫色专用字，无对应令牌 */
  font-style: italic;
}
.link-value {
  color: var(--corp-primary);
  text-decoration: underline;
  font-weight: 500;
}

/* ===== 标准依据块 ===== */
.standard-ref-section {
  margin: 8px 0;
  padding: 6px 8px;
  background: var(--color-primary-50);
  border-radius: 4px;
  border-left: 3px solid var(--color-primary-400);
}
.standard-ref-header {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--color-info-text);
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 4px;
}
.standard-ref-body {
  font-size: 12px;
  color: var(--color-primary-900);
  line-height: 1.5;
}

/* ===== Task 42: dwg-vision 定位图纸按钮 ===== */
.locate-bbox-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: #FCE7F3; /* 粉色专用底，无对应令牌 */
  color: #BE185D; /* 粉色专用字，无对应令牌 */
  border-radius: 6px;
  transition: all 0.15s ease;
}
.locate-bbox-btn:hover {
  background: #FBCFE8; /* 粉色专用底，无对应令牌 */
  color: #9D174D; /* 粉色专用字，无对应令牌 */
  transform: scale(1.1);
}

/* ===== Task 28: 规范条文链接 ===== */
.clause-ref-section {
  margin: 8px 0;
  padding: 6px 8px;
  background: var(--color-success-bg); /* #F0FDF4 对齐 --color-success-bg */
  border-radius: 4px;
  border-left: 3px solid var(--corp-success);
}
.clause-ref-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #065F46; /* 对齐 --color-success-text 或专用色 */
}
.clause-ref-label {
  font-weight: 600;
}
.clause-ref-text {
  flex: 1;
  color: #047857; /* 无对应令牌，对齐 --color-success-text 或专用色 */
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
}
.view-clause-btn {
  padding: 0 6px;
  height: auto;
  font-size: 12px;
}

/* ===== Task 22: CoT 推理过程 ===== */
.reasoning-section {
  margin: 8px 0;
}
.reasoning-title {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--corp-text-secondary);
  font-weight: 500;
}
.reasoning-body {
  font-size: 12px;
  color: var(--color-gray-600);
  line-height: 1.6;
  background: var(--color-gray-50);
  padding: 6px 8px;
  border-radius: 4px;
  white-space: pre-wrap;
}

/* ===== 标准引用详情块 ===== */
.std-ref-detail-section {
  margin: 8px 0;
}
.std-ref-detail {
  margin-top: 4px;
}

/* ===== DWG 信息区域 ===== */
.dwg-info-section {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 8px;
}
.dwg-layer-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: var(--bg-surface-active);
  border-radius: 4px;
  font-size: 12px;
}
.layer-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--layer-color, var(--corp-text-secondary));
  flex-shrink: 0;
}
.dwg-coord-text {
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
  font-size: 12px;
  background: var(--bg-surface-active);
  padding: 2px 6px;
  border-radius: 4px;
}
.dwg-block-text {
  font-size: 12px;
  background: var(--bg-surface-active);
  padding: 2px 6px;
  border-radius: 4px;
}
.cad-handle-badge {
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
  font-size: 12px;
  background: var(--bg-surface-active);
  padding: 3px 8px;
  border-radius: 4px;
}

/* ===== 合同审查：修改建议块 ===== */
.recommendation-section {
  margin: 8px 0;
  padding: 6px 8px;
  background: #FFF7ED; /* 橙色浅底，无对应令牌，对齐 --color-warning-bg */
  border-radius: 4px;
  border-left: 3px solid var(--severity-major);
}
.recommendation-header {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #C2410C; /* 无对应令牌，对齐 --color-warning-text 或专用色 */
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 4px;
}
.recommendation-body {
  font-size: 12px;
  color: #9A3412; /* 无对应令牌，对齐 --color-warning-text 或专用色 */
  line-height: 1.5;
}

/* ===== 来源参考块 ===== */
.source-refs-section {
  margin-top: 8px;
}
.source-list {
  margin-top: 4px;
}
.source-top-hint {
  margin-bottom: 6px;
}
.source-title {
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.source-content {
  font-size: 12px;
  color: var(--corp-text-secondary);
  line-height: 1.5;
  transition: max-height 0.25s ease;
  cursor: pointer;
}
.source-content--clamped {
  max-height: 6em;
  overflow: hidden;
  position: relative;
}
.source-content--clamped::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2em;
  background: linear-gradient(transparent, var(--bg-surface));
  pointer-events: none;
}
.source-expand-btn {
  text-align: center;
  margin-top: 4px;
}
:deep(.el-collapse) { border: none; }
:deep(.el-collapse-item__header) {
  height: auto; min-height: 28px; line-height: 1.5; font-size: 13px;
  border-bottom: none; padding: 3px 0; background: transparent;
}
:deep(.el-collapse-item__wrap) { border-bottom: none; }
:deep(.el-collapse-item__content) { padding: 6px 0 3px 14px; }

/* ===== 误报卡片样式 ===== */
.false-positive-card {
  opacity: 0.5;
  background: var(--color-gray-50);
}
.false-positive-card .issue-header {
  cursor: default;
}
.false-positive-card .issue-header:hover {
  background: transparent;
}

/* ===== 高亮样式 ===== */
.issue-highlighted {
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.5);
  animation: highlight-pulse 0.5s ease-out;
  z-index: 100;
}
@keyframes highlight-pulse {
  0% { box-shadow: 0 0 0 6px rgba(59, 130, 246, 0.6); }
  50% { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.4); }
  100% { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.5); }
}

/* ===== 批量选择样式 ===== */
.batch-checkbox-wrapper {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  padding: 10px 8px;
  background: color-mix(in srgb, var(--bg-surface) 95%, transparent);
  z-index: 10;
}
.batch-checkbox {
  transform: scale(1.1);
}
.issue-card.batch-selected {
  border-left-color: var(--corp-primary) !important;
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.15), 0 4px 12px rgba(64, 158, 255, 0.1) !important; /* 光环保留 */
  transition: all 0.25s ease;
}
.issue-card.batch-selected:hover {
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.25), 0 6px 20px rgba(64, 158, 255, 0.15) !important;
}

/* ===== OPT-015: 质量反馈按钮 ===== */
.feedback-row {
  align-items: center;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--corp-border-light);
}
.feedback-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.fb-btn {
  border: none;
  border-radius: 6px;
  font-size: 12px;
  padding: 4px 10px;
}
.fb-useful {
  background: var(--color-success-bg); /* #D1FAE5 对齐 --color-success-bg */
  color: var(--color-success-600);
}
.fb-useful:hover { background: #A7F3D0; color: #047857; } /* 无对应令牌，对齐 --color-success-bg/--color-success-text */
.fb-fp {
  background: var(--color-warning-bg);
  color: var(--color-warning-600);
}
.fb-fp:hover { background: #FDE68A; color: var(--color-warning-text); } /* #FDE68A 无对应令牌；#B45309 对齐 --color-warning-text */
.fb-missed {
  background: var(--color-danger-bg);
  color: var(--color-danger-600);
}
.fb-missed:hover { background: #FECACA; color: #B91C1C; } /* 无对应令牌，对齐 --color-danger-bg/--color-danger-text */
.fb-done {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color-success-600);
  font-weight: 500;
}
</style>
