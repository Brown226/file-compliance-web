<template>
  <div class="right-panel">
    <div class="panel-header">
      <span class="panel-title">审查结果明细</span>
      <span class="result-count">共 {{ filteredAndSearched.length }} 项</span>
      <el-button
        v-if="selectedFileId"
        type="primary"
        link
        @click="$emit('update:selectedFileId', null)"
      >
        查看全部
      </el-button>
    </div>

    <!-- 筛选工具栏 (sticky) -->
    <div class="filter-toolbar" v-if="filteredAndSearched.length > 0 || hasActiveFilters">
      <div class="filter-group">
        <el-select v-model="filterSeverity" placeholder="严重度" clearable size="small" style="width:100px">
          <el-option label="错误" value="error" />
          <el-option label="警告" value="warning" />
          <el-option label="提示" value="info" />
        </el-select>
        <el-select v-model="filterCategory" placeholder="问题分类" clearable size="small" style="width:130px">
          <el-option v-for="t in allCategories" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>
        <!-- DWG 专属筛选：按图层 -->
        <el-select
          v-if="hasDwgDetails"
          v-model="filterDwgLayers"
          placeholder="按图层"
          clearable
          multiple
          collapse-tags
          collapse-tags-tooltip
          size="small"
          style="width:160px"
        >
          <el-option
            v-for="layer in dwgLayerOptions"
            :key="layer"
            :label="layer"
            :value="layer"
          />
        </el-select>
        <!-- DWG 专属筛选：按图元类型 -->
        <el-select
          v-if="hasDwgDetails"
          v-model="filterDwgEntityTypes"
          placeholder="按图元类型"
          clearable
          multiple
          collapse-tags
          collapse-tags-tooltip
          size="small"
          style="width:150px"
        >
          <el-option
            v-for="et in dwgEntityTypeOptions"
            :key="et.value"
            :label="et.label"
            :value="et.value"
          />
        </el-select>
        <!-- DWG 专属筛选：按规则类型 -->
        <el-select
          v-if="hasDwgDetails"
          v-model="filterDwgRuleTypes"
          placeholder="按规则类型"
          clearable
          multiple
          collapse-tags
          collapse-tags-tooltip
          size="small"
          style="width:150px"
        >
          <el-option
            v-for="rt in dwgRuleTypeOptions"
            :key="rt.value"
            :label="rt.label"
            :value="rt.value"
          />
        </el-select>
        <el-input v-model="searchText" placeholder="搜索原文本/描述..." clearable size="small" style="width:200px">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
      </div>
      <el-button link type="info" size="small" @click="resetFilters">
        <el-icon><RefreshRight /></el-icon> 重置
      </el-button>
    </div>

    <div class="error-content" ref="errorContentRef" v-loading="loading">
      <template v-if="filteredAndSearched.length > 0">
        <div
          v-for="detail in filteredAndSearched"
          :key="detail.id"
          :id="`issue-${detail.id}`"
          :class="['issue-card', { 'false-positive-card': detail.isFalsePositive, 'issue-highlighted': highlightedId === detail.id }]"
        >
          <!-- 卡片头部 -->
          <div class="issue-header">
            <div class="issue-tags">
              <el-tag :type="getCategoryTagType(detail.issueType)" size="small" effect="dark" round>
                {{ getIssueTypeLabel(detail.issueType) }}
              </el-tag>
              <el-tag v-if="detail.ruleCode" size="small" type="info" effect="plain" round>
                {{ detail.ruleCode }}
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
                    {{ detail.dwgMetadata.entityType }}
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
              <span class="row-value link-value" @click="$emit('selectFileById', detail.fileId)">{{ detail.file.fileName }}</span>
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
                @click="$emit('locateText', { detail, elementId: `issue-${detail.id}` })"
                class="action-btn"
              >
                <el-icon><Location /></el-icon> 定位
              </el-button>
              <el-button
                v-if="detail.cadHandleId"
                type="primary"
                size="small"
                @click="$emit('copyHandleId', detail.cadHandleId)"
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
                @click="$emit('openFpDialog', detail)"
                class="action-btn action-fp-btn"
              >
                标记误报
              </el-button>
              <el-button
                v-else
                type="info"
                size="small"
                plain
                @click="$emit('cancelFp', detail)"
                class="action-btn"
              >
                取消误报
              </el-button>
            </div>
          </div>
        </div>
      </template>
      <el-empty v-else description="该任务暂无审查结果（或筛选无匹配）" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { CopyDocument, Search, RefreshRight, Location } from '@element-plus/icons-vue'
import DiffText from './DiffText.vue'

const props = defineProps<{
  details: any[]
  loading: boolean
  selectedFileId: string | null
}>()

defineEmits<{
  'update:selectedFileId': [value: string | null]
  selectFileById: [fileId: string]
  copyHandleId: [handleId: string]
  openFpDialog: [detail: any]
  cancelFp: [detail: any]
  locateText: [payload: { detail: any; elementId: string }]
}>()

const errorContentRef = ref<HTMLElement | null>(null)

// 筛选状态
const filterSeverity = ref('')
const filterCategory = ref('')
const searchText = ref('')
// DWG 专属筛选状态
const filterDwgLayers = ref<string[]>([])
const filterDwgEntityTypes = ref<string[]>([])
const filterDwgRuleTypes = ref<string[]>([])

/** 是否有 DWG 问题数据 */
const hasDwgDetails = computed(() => {
  return filteredDetails.value.some((d: any) => d.dwgMetadata)
})

/** 从问题列表中提取所有图层选项 */
const dwgLayerOptions = computed(() => {
  const set = new Set<string>()
  filteredDetails.value.forEach((d: any) => {
    if (d.dwgMetadata?.layer) set.add(d.dwgMetadata.layer)
  })
  return Array.from(set).sort()
})

/** 图元类型选项 */
const dwgEntityTypeOptions = computed(() => {
  const set = new Set<string>()
  filteredDetails.value.forEach((d: any) => {
    if (d.dwgMetadata?.entityType) set.add(d.dwgMetadata.entityType)
  })
  return Array.from(set).sort().map(t => ({ value: t, label: getEntityTypeLabel(t) }))
})

/** DWG 规则类型选项 */
const dwgRuleTypeOptions = [
  { value: 'TITLE', label: '标题栏' },
  { value: 'LAYER', label: '图层' },
  { value: 'DIMENSION', label: '标注' },
  { value: 'STD_REF', label: '标准引用' },
  { value: 'SCALE', label: '比例' },
  { value: 'OVERLAP', label: '重叠' },
  { value: 'NAMING', label: '命名规范' },
  { value: 'FORMAT', label: '格式规范' },
]

/** 是否有激活的筛选条件 */
const hasActiveFilters = computed(() => {
  return filterSeverity.value || filterCategory.value || searchText.value.trim() ||
    filterDwgLayers.value.length > 0 || filterDwgEntityTypes.value.length > 0 || filterDwgRuleTypes.value.length > 0
})

const allCategories = [
  { value: 'TYPO', label: '错别字' },
  { value: 'VIOLATION', label: '合规违规' },
  { value: 'NAMING', label: '命名规范' },
  { value: 'ENCODING', label: '编码一致性' },
  { value: 'ATTRIBUTE', label: '封面属性' },
  { value: 'HEADER', label: '页眉检查' },
  { value: 'PAGE', label: '页码检查' },
  { value: 'SCAN', label: '图纸扫描' },
  { value: 'TEMPLATE', label: '模板统一' },
  { value: 'FORMAT', label: '格式规范' },
  { value: 'COMPLETENESS', label: '数据完整性' },
  { value: 'CONSISTENCY', label: '一致性' },
  { value: 'LAYOUT', label: '排版布局' },
  { value: 'STD_REF', label: '标准引用' },
  { value: 'DWG', label: 'DWG图纸' },
]

const filteredDetails = computed(() => {
  if (!props.selectedFileId) return props.details
  return props.details.filter((d: any) => d.fileId === props.selectedFileId)
})

const filteredAndSearched = computed(() => {
  let list = filteredDetails.value
  if (filterSeverity.value) {
    list = list.filter((d: any) => d.severity === filterSeverity.value)
  }
  if (filterCategory.value) {
    list = list.filter((d: any) => d.issueType === filterCategory.value)
  }
  // DWG 图层筛选
  if (filterDwgLayers.value.length > 0) {
    list = list.filter((d: any) => {
      const layer = d.dwgMetadata?.layer
      return layer && filterDwgLayers.value.includes(layer)
    })
  }
  // DWG 图元类型筛选
  if (filterDwgEntityTypes.value.length > 0) {
    list = list.filter((d: any) => {
      const et = d.dwgMetadata?.entityType
      return et && filterDwgEntityTypes.value.includes(et)
    })
  }
  // DWG 规则类型筛选
  if (filterDwgRuleTypes.value.length > 0) {
    list = list.filter((d: any) => {
      const code = d.ruleCode
      if (!code) return false
      let prefix = code.split('_')[0]
      if (prefix === 'DIM') prefix = 'DIMENSION'
      return filterDwgRuleTypes.value.includes(prefix)
    })
  }
  if (searchText.value.trim()) {
    const kw = searchText.value.trim().toLowerCase()
    list = list.filter((d: any) =>
      d.originalText.toLowerCase().includes(kw) ||
      (d.description && d.description.toLowerCase().includes(kw)) ||
      (d.ruleCode && d.ruleCode.toLowerCase().includes(kw))
    )
  }
  return list
})

const resetFilters = () => {
  filterSeverity.value = ''
  filterCategory.value = ''
  searchText.value = ''
  filterDwgLayers.value = []
  filterDwgEntityTypes.value = []
  filterDwgRuleTypes.value = []
}

const getIssueTypeLabel = (type: string): string => {
  const m: Record<string, string> = {
    TYPO: '错别字', VIOLATION: '合规违规', NAMING: '命名规范',
    ENCODING: '编码一致性', ATTRIBUTE: '封面属性', HEADER: '页眉检查',
    PAGE: '页码检查', SCAN: '图纸扫描', TEMPLATE: '模板统一',
    FORMAT: '格式规范', COMPLETENESS: '数据完整性', CONSISTENCY: '一致性',
    LAYOUT: '排版布局', STD_REF: '标准引用', DWG: 'DWG图纸',
  }
  return m[type] || type
}

const getCategoryTagType = (type: string): any => {
  const m: Record<string, any> = {
    TYPO: 'warning', VIOLATION: 'danger', NAMING: 'info',
    ENCODING: 'danger', ATTRIBUTE: 'warning', HEADER: 'success',
    PAGE: 'info', SCAN: 'info', TEMPLATE: 'warning',
    FORMAT: 'warning', COMPLETENESS: 'danger', CONSISTENCY: 'info',
    LAYOUT: 'info', STD_REF: 'warning', DWG: 'info',
  }
  return m[type] || 'info'
}

const getSeverityType = (severity: string): any => {
  return severity === 'error' ? 'danger' : severity === 'warning' ? 'warning' : 'info'
}

const getSeverityLabel = (s: string): string => {
  return s === 'error' ? '错误' : s === 'warning' ? '警告' : '提示'
}

/** 根据图层名称生成一致的颜色 */
const getLayerColor = (layerName: string): string => {
  // 使用简单哈希生成固定颜色
  let hash = 0
  for (let i = 0; i < layerName.length; i++) {
    hash = layerName.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 55%, 45%)`
}

/** DWG 图元类型中文映射 */
const getEntityTypeLabel = (type: string): string => {
  const m: Record<string, string> = {
    LINE: '直线', ARC: '圆弧', CIRCLE: '圆', TEXT: '单行文字',
    MTEXT: '多行文字', DIMENSION: '标注', INSERT: '块引用',
    POLYLINE: '多段线', LWPOLYLINE: '轻量多段线', HATCH: '填充',
    BLOCK: '块定义', ATTDEF: '属性定义', ATTRIBUTE: '属性',
    SPLINE: '样条曲线', ELLIPSE: '椭圆', OTHER: '其他',
  }
  return m[type] || type
}

/** 取相似度最高的前3个参考文档 */
const topSourceRefs = (refs: any[]): any[] => {
  if (!refs || refs.length <= 3) return refs || []
  // 按 similarity 降序排列，取前3
  return [...refs]
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, 3)
}

// 高亮状态
const highlightedId = ref<string | null>(null)
let highlightTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 滚动到指定问题卡片并高亮
 * @param detailId 要高亮的问题ID
 */
const scrollToIssue = (detailId: string) => {
  highlightedId.value = detailId

  // 清除之前的高亮定时器
  if (highlightTimer) {
    clearTimeout(highlightTimer)
  }

  // 滚动到目标元素
  nextTick(() => {
    const element = document.getElementById(`issue-${detailId}`)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })

  // 3秒后取消高亮
  highlightTimer = setTimeout(() => {
    highlightedId.value = null
  }, 3000)
}

// 暴露方法给父组件
defineExpose({
  errorContentRef,
  scrollToIssue,
})
</script>

<style scoped>
.right-panel {
  flex: 1; background-color: var(--corp-bg-panel); border-radius: var(--corp-radius-lg);
  display: flex; flex-direction: column; border: 1px solid var(--corp-border-light);
  box-shadow: var(--corp-shadow-sm); overflow: hidden; min-width: 0;
}

.panel-header {
  padding: 12px 20px; display: flex; justify-content: space-between; align-items: center;
  flex-shrink: 0; border-bottom: 1px solid var(--corp-border-light);
}
.panel-title { font-weight: 600; font-size: 15px; color: var(--corp-text-primary); }
.result-count { font-size: 13px; color: var(--corp-text-secondary); }

.filter-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 20px; border-bottom: 1px solid var(--corp-border-light);
  flex-shrink: 0; background-color: var(--bg-surface); position: sticky; top: 0; z-index: 10;
}
.filter-group { display: flex; align-items: center; gap: 10px; }

.error-content { flex: 1; padding: 16px 20px; overflow-y: auto; }

/* 问题卡片 - 左侧彩色边框按严重度区分 */
.issue-card {
  margin-bottom: 14px; background: var(--bg-surface);
  border: 1px solid var(--corp-border-light); border-radius: var(--radius-lg);
  box-shadow: var(--corp-shadow-sm); overflow: hidden;
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
  border-left-width: 4px;
}
.issue-card.severity-error   { border-left-color: var(--severity-critical); }
.issue-card.severity-warning { border-left-color: var(--severity-major); }
.issue-card.severity-info    { border-left-color: var(--severity-suggestion); }
.issue-card:hover { box-shadow: var(--corp-shadow-md); border-color: var(--corp-border); }

.issue-header { padding: 14px 18px 10px; border-bottom: 1px solid var(--corp-border-light); }
.issue-tags { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.issue-desc {
  font-size: 15px; font-weight: 600; color: var(--corp-text-primary);
  line-height: 1.5; display: block;
}
.severity-tag { font-size: 12px; letter-spacing: 0.02em; }
.severity-error { font-weight: 700; }
.fp-tag { 
  font-style: italic; 
  background-color: #f3e8ff !important;
  border-color: #a855f7 !important;
  color: #7c3aed !important;
}

.issue-body { padding: 14px 18px; font-size: 14px; color: var(--corp-text-regular); line-height: 1.7; }
.issue-row { display: flex; margin-bottom: 10px; align-items: flex-start; gap: 12px; }
.issue-row:last-child { margin-bottom: 0; }
.row-label {
  width: 80px; flex-shrink: 0; color: var(--corp-text-secondary); font-weight: 500;
  font-size: 13px; padding-top: 1px;
}
.row-value { flex: 1; word-break: break-all; line-height: 1.6; }

/* 原文本 & 建议修改 — 大字号高亮块 */
.original-text, .suggested-text {
  padding: 6px 12px; border-radius: var(--radius-md); font-weight: 500;
  display: inline-block; max-width: 100%; font-size: 14px; line-height: 1.6;
}
.original-text { color: var(--corp-danger); background-color: var(--corp-danger-light); border: 1px solid rgba(239,68,68,0.15); }
.suggested-text { color: var(--corp-success); background-color: var(--corp-success-light); border: 1px solid rgba(16,185,129,0.15); }
.cad-handle-badge {
  font-family: var(--font-mono);
  background: var(--color-primary-50); color: var(--corp-primary);
  padding: 4px 14px; border-radius: var(--radius-full); border: 1px solid rgba(37,99,235,0.15);
  font-size: 13px; font-weight: 600; display: inline-block;
}
.link-value {
  color: var(--corp-primary); cursor: pointer; text-decoration: none;
  font-weight: 500; font-size: 14px;
}
.link-value:hover { color: var(--corp-primary-hover); text-decoration: underline; }
.standard-ref-value {
  color: var(--corp-primary); font-weight: 500; background: var(--color-primary-50);
  padding: 4px 12px; border-radius: var(--radius-md); display: inline-block;
  border: 1px solid rgba(37,99,235,0.10); font-size: 13px;
}

/* 标准引用匹配详情 */
.std-ref-detail-section {
  display: flex;
  margin-bottom: 10px;
  align-items: flex-start;
  gap: 12px;
}
.std-ref-detail {
  flex: 1;
  min-width: 0;
}
.std-ref-detail :deep(.el-descriptions) {
  margin: 0;
}
.std-ref-detail :deep(.el-descriptions__label) {
  width: 80px;
  font-size: 13px;
  color: var(--corp-text-secondary);
}
.std-ref-detail :deep(.el-descriptions__content) {
  font-size: 13px;
}
.correct-value {
  color: var(--corp-success);
  font-weight: 500;
  font-family: var(--font-mono);
}

/* ===== DWG 专属信息区域 ===== */
.dwg-info-section {
  margin-bottom: 10px;
  padding: 8px 12px;
  background: linear-gradient(135deg, rgba(230, 126, 34, 0.04) 0%, rgba(243, 156, 18, 0.06) 100%);
  border-radius: var(--radius-md);
  border: 1px solid rgba(230, 126, 34, 0.12);
}

.dwg-layer-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 12px;
  border-radius: var(--radius-full);
  background: var(--color-primary-50);
  color: var(--layer-color, var(--corp-primary));
  font-size: 13px;
  font-weight: 600;
  border: 1px solid rgba(0, 0, 0, 0.06);
  font-family: var(--font-mono);
}

.dwg-layer-badge .layer-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--layer-color, var(--corp-primary));
  flex-shrink: 0;
}

.dwg-coord-text {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--corp-text-secondary);
  background: var(--color-gray-50);
  padding: 3px 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--corp-border-light);
}

.dwg-block-text {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--corp-primary);
  font-weight: 500;
}

/* CAD 定位按钮增强 */
.cad-locate-btn {
  position: relative;
  transition: all 0.2s ease;
}
.cad-locate-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25);
}
.cad-locate-btn:active {
  transform: translateY(0);
}

.source-refs-section { margin-top: 4px; }
.source-list { flex: 1; min-width: 0; }
.source-top-hint { font-size: 12px; color: var(--corp-text-secondary); font-style: italic; margin-bottom: 4px; }
::deep(.el-collapse) { border: none; }
::deep(.el-collapse-item__header) {
  height: auto; min-height: 32px; line-height: 1.5; font-size: 14px;
  border-bottom: none; padding: 4px 0; background: transparent;
}
::deep(.el-collapse-item__wrap) { border-bottom: none; }
::deep(.el-collapse-item__content) { padding: 8px 0 4px 16px; }
.source-title { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--corp-primary); font-weight: 500; }
.source-content {
  padding: 10px 14px; background: var(--color-primary-50);
  border-radius: var(--corp-radius-md); border-left: 3px solid var(--corp-primary);
  font-size: 13px; line-height: 1.7; color: var(--corp-text-regular);
  white-space: pre-wrap; word-break: break-all;
}

.fp-reason-row .fp-reason-text {
  color: var(--corp-text-secondary); font-style: italic; font-size: 13px;
  padding: 4px 12px; background: var(--color-gray-50); border-radius: var(--corp-radius-md); display: inline-block;
}

.issue-footer {
  padding: 10px 18px; border-top: 1px solid var(--corp-border-light);
  background: var(--color-gray-50); display: flex; justify-content: flex-end;
}
.footer-actions { display: flex; gap: 10px; }
.action-btn { font-size: 13px; border-radius: var(--corp-radius-md); font-weight: 500; padding: 7px 16px; }
.action-fp-btn.el-button { 
  border-color: #d97706 !important; 
  color: #92400e !important;
  background-color: #fef3c7 !important;
}
.action-fp-btn.el-button:hover { background-color: #fde68a !important; border-color: #d97706 !important; }

.false-positive-card.false-positive-card {
  opacity: 0.6;
  background: repeating-linear-gradient(-45deg, var(--bg-surface), var(--bg-surface) 8px, var(--color-gray-50) 8px, var(--color-gray-50) 16px);
  border: 1px dashed var(--color-gray-300);
}
.false-positive-card:hover { opacity: 0.8; }

/* 高亮效果 */
.issue-highlighted {
  animation: highlight-pulse 0.5s ease-out;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.5) !important;
  border-color: var(--corp-primary) !important;
  z-index: 100;
}

@keyframes highlight-pulse {
  0% {
    transform: scale(1.02);
    box-shadow: 0 0 0 6px rgba(59, 130, 246, 0.6);
  }
  50% {
    transform: scale(1.01);
    box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.4);
  }
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.5);
  }
}

@media (max-width: 800px) {
  .filter-toolbar { flex-wrap: wrap; }
  .filter-group { flex-wrap: wrap; }
}

/* DWG 筛选工具栏增强 */
.filter-toolbar .el-select .el-tag {
  max-width: 90px;
}
</style>
