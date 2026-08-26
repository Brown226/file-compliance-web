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
        <!-- 2026-08-26 判标全模式扩展：只看待人工复核条目 -->
        <el-select v-model="filterReviewStatus" placeholder="复核状态" clearable size="small" style="width:110px">
          <el-option label="待复核" value="pending" />
        </el-select>
        <el-input v-model="searchText" placeholder="搜索原文本/描述..." clearable size="small" style="width:200px">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button
          v-if="hasDwgDetails || hasActiveAdvancedFilters"
          size="small"
          link
          type="primary"
          @click="showAdvancedFilters = !showAdvancedFilters"
        >
          {{ showAdvancedFilters ? '收起筛选' : '更多筛选' }}
          <el-icon><ArrowDown /></el-icon>
        </el-button>
      </div>
      <div class="filter-actions">
        <!-- 仅看实质问题（弱化 FLUENCE/提示级噪声，对应 docs/12 信噪比诊断） -->
        <el-tooltip content="折叠修辞级/提示类噪声，只看错误与警告级实质问题" placement="top">
          <el-switch
            v-model="hideLowValue"
            size="small"
            inline-prompt
            active-text="仅实质"
            inactive-text="全部"
            style="margin-right:4px"
          />
        </el-tooltip>
        <!-- 全部展开/折叠 -->
        <el-button
          size="small"
          plain
          @click="toggleExpandAll"
          :disabled="batchMode"
          :title="allExpanded ? '全部折叠' : '全部展开'"
        >
          <el-icon><component :is="allExpanded ? Fold : Expand" /></el-icon>
          {{ allExpanded ? '折叠' : '展开' }}
        </el-button>
        <!-- 分组切换 -->
        <el-button
          :type="groupMode ? 'primary' : 'default'"
          size="small"
          plain
          @click="groupMode = !groupMode"
          :disabled="batchMode"
        >
          <el-icon><Collection /></el-icon> {{ groupMode ? '已分组' : '分组' }}
        </el-button>
        <el-button link type="info" size="small" @click="resetFilters">
          <el-icon><RefreshRight /></el-icon> 重置
        </el-button>
      </div>
      <!-- 高级筛选（默认折叠） -->
      <div v-if="showAdvancedFilters" class="filter-group filter-advanced">
        <el-select v-model="filterCategory" placeholder="问题分类" clearable size="small" style="width:130px">
          <el-option v-for="t in allCategories" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>
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
      </div>
    </div>

    <!-- 批量操作工具栏（选中即显示，无需进入/退出模式） -->
    <BatchToolbar
      :selected-count="selectedIssueIds.length"
      :filtered-count="filteredAndSearched.length"
      :is-all-selected="isAllSelected"
      :is-indeterminate="isIndeterminate"
      :is-docx-selected="!!isDocxSelected"
      :has-adoptable-items="hasAdoptableItems"
      :adoptable-count="adoptableCount"
      :has-fp-markable-items="hasFpMarkableItems"
      :fp-markable-count="fpMarkableCount"
      :batch-loading="batchLoading"
      @toggle-select-all="toggleSelectAll"
      @batch-adopt="handleBatchAdopt"
      @batch-false-positive="handleBatchFalsePositive"
      @clear-selection="clearSelection"
      @exit-batch-mode="exitBatchMode"
    />

    <div class="error-content" :class="{ 'batch-mode-active': batchMode }" ref="errorContentRef" v-loading="loading">
      <template v-if="filteredAndSearched.length > 0">
        <!-- RULE_ONLY 模式：按检查项分组 -->
        <template v-if="isCustomRuleMode && ruleRegistryLoaded && !batchMode">
          <div v-for="group in issuesByRuleGroup" :key="group.groupName" class="rule-group-section">
            <div class="rule-group-title">
              <span class="rule-group-icon">📋</span>
              {{ group.groupName }}
            </div>
            <div
              v-for="rule in group.rules"
              :key="rule.prefix"
              class="rule-group-card"
              :class="{ 'rule-group-card--empty': rule.items.length === 0 }"
            >
              <div class="rule-group-header" @click="toggleRuleGroup(rule.prefix)">
                <el-icon class="rule-group-arrow" :class="{ expanded: expandedRuleGroups.has(rule.prefix) }">
                  <ArrowRight />
                </el-icon>
                <span class="rule-group-label">{{ rule.label }}</span>
                <span class="rule-group-desc" v-if="rule.description">{{ rule.description }}</span>
                <div class="rule-group-stats">
                  <el-tag v-if="rule.errorCount > 0" size="small" type="danger" round>
                    {{ rule.errorCount }} 错误
                  </el-tag>
                  <el-tag v-if="rule.warningCount > 0" size="small" type="warning" round>
                    {{ rule.warningCount }} 警告
                  </el-tag>
                  <el-tag v-if="rule.infoCount > 0" size="small" type="info" round>
                    {{ rule.infoCount }} 提示
                  </el-tag>
                  <span v-if="rule.items.length === 0" class="rule-pass-badge">
                    <el-icon color="var(--corp-success)"><CircleCheck /></el-icon> 通过
                  </span>
                </div>
              </div>
              <div v-show="expandedRuleGroups.has(rule.prefix) && rule.items.length > 0" class="rule-group-items">
                <IssueCard
                  v-for="detail in rule.items"
                  :key="detail.id"
                  :detail="detail"
                  :batch-mode="false"
                  :selected="false"
                  :is-docx-selected="isDocxSelected"
                  :highlighted-id="highlightedId"
                  :selected-file-id="selectedFileId"
                  :force-expanded="allExpanded"
                  :review-mode="reviewMode"
                  :task-id="taskId"
                  @locate-text="(payload: any) => $emit('locateText', payload)"
                  @copy-handle-id="(handleId: string) => $emit('copyHandleId', handleId)"
                  @open-fp-dialog="(detail: IssueDetail) => $emit('openFpDialog', detail)"
                  @cancel-fp="(detail: IssueDetail) => $emit('cancelFp', detail)"
                  @toggle-adopt="(detail: IssueDetail) => $emit('toggleAdopt', detail)"
                  @toggle-select="toggleIssueSelection"
                  @select-file-by-id="(fileId: string) => $emit('selectFileById', fileId)"
                  @locate-bbox="(detail: IssueDetail) => $emit('locateBbox', detail)"
                  @open-clause="(detail: IssueDetail) => $emit('openClause', detail)"
                />
              </div>
            </div>
          </div>
        </template>
        <!-- 分组模式 -->
        <template v-else-if="groupMode && !batchMode && !isCustomRuleMode">
          <div v-for="group in groupedIssues" :key="group.key" class="issue-group">
            <div class="group-header" @click="toggleGroup(group.key)">
              <el-icon class="group-arrow" :class="{ expanded: expandedGroups.has(group.key) }">
                <ArrowRight />
              </el-icon>
              <span class="group-label">{{ group.label }}</span>
              <el-tag size="small" :type="group.severity === 'error' ? 'danger' : 'warning'" round>
                {{ group.count }} 条
              </el-tag>
              <span class="group-sample">例：{{ group.sampleDesc }}</span>
            </div>
            <div v-show="expandedGroups.has(group.key)" class="group-items">
              <IssueCard
                v-for="detail in group.items"
                :key="detail.id"
                :detail="detail"
                :batch-mode="false"
                :selected="false"
                :is-docx-selected="isDocxSelected"
                :highlighted-id="highlightedId"
                :selected-file-id="selectedFileId"
                :force-expanded="allExpanded"
                :review-mode="reviewMode"
                @locate-text="(payload) => $emit('locateText', payload)"
                @copy-handle-id="(handleId) => $emit('copyHandleId', handleId)"
                @open-fp-dialog="(detail) => $emit('openFpDialog', detail)"
                @cancel-fp="(detail) => $emit('cancelFp', detail)"
                @toggle-adopt="(detail) => $emit('toggleAdopt', detail)"
                @toggle-select="toggleIssueSelection"
                @select-file-by-id="(fileId) => $emit('selectFileById', fileId)"
                @locate-bbox="(detail) => $emit('locateBbox', detail)"
                @open-clause="(detail) => $emit('openClause', detail)"
              />
            </div>
          </div>
        </template>
        <!-- 普通列表模式 -->
        <template v-else>
          <IssueCard
            v-for="detail in effectiveIssues"
            :key="detail.id"
            :detail="detail"
            :batch-mode="batchMode"
            :selected="selectedIssueIds.includes(detail.id)"
            :is-docx-selected="isDocxSelected"
            :highlighted-id="highlightedId"
            :selected-file-id="selectedFileId"
            :force-expanded="allExpanded"
            :review-mode="reviewMode"
            @locate-text="(payload) => $emit('locateText', payload)"
            @copy-handle-id="(handleId) => $emit('copyHandleId', handleId)"
            @open-fp-dialog="(detail) => $emit('openFpDialog', detail)"
            @cancel-fp="(detail) => $emit('cancelFp', detail)"
            @toggle-adopt="(detail) => $emit('toggleAdopt', detail)"
            @toggle-select="toggleIssueSelection"
            @select-file-by-id="(fileId) => $emit('selectFileById', fileId)"
            @locate-bbox="(detail) => $emit('locateBbox', detail)"
            @open-clause="(detail) => $emit('openClause', detail)"
          />
        </template>
      </template>
      <el-empty v-else description="该任务暂无审查结果（或筛选无匹配）" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, nextTick, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Search,
  RefreshRight,
  Operation,
  Collection,
  ArrowRight,
  ArrowDown,
  CircleCheck,
  Expand,
  Fold,
} from '@element-plus/icons-vue'
import IssueCard from './IssueCard.vue'
import BatchToolbar from './BatchToolbar.vue'
import { useIssueFilter, useBatchSelection } from './composables'
import { ALL_CATEGORIES, DWG_RULE_TYPE_OPTIONS } from './constants/issue-config'
import type { IssueDetail } from './types/issue'
import { getRuleRegistryApi, type RuleGroupMeta, type RuleMetaItem } from '@/api/system'

const props = defineProps<{
  details: IssueDetail[]
  loading: boolean
  selectedFileId: string | null
  isDocxSelected?: boolean
  /** 审查模式（用于按检查项分组，仅 RULE_ONLY 模式生效） */
  reviewMode?: string
  /** RULE_ONLY 模式启用的规则前缀列表 */
  enabledPrefixes?: string[]
  /** OPT-015: 任务 ID（用于审查结果反馈） */
  taskId?: string
}>()

const emit = defineEmits<{
  'update:selectedFileId': [value: string | null]
  selectFileById: [fileId: string]
  copyHandleId: [handleId: string]
  openFpDialog: [detail: IssueDetail]
  cancelFp: [detail: IssueDetail]
  /** P2-2: 单条采纳透传 */
  toggleAdopt: [detail: IssueDetail]
  locateText: [payload: { detail: IssueDetail; elementId: string }]
  batchFalsePositive: [issueIds: string[], reason?: string]
  batchAdopt: [issueIds: string[]]
  // Task 42: dwg-vision 专属事件透传
  locateBbox: [detail: IssueDetail]
  openClause: [detail: IssueDetail]
}>()

const errorContentRef = ref<HTMLElement | null>(null)
const showAdvancedFilters = ref(false)

// 将 props 转换为 ref 以便 composables 使用
const detailsRef = computed(() => props.details)
const selectedFileIdRef = computed(() => props.selectedFileId)

// 使用 composables
const {
  filterSeverity,
  filterCategory,
  filterReviewStatus,
  searchText,
  filterDwgLayers,
  filterDwgEntityTypes,
  filterDwgRuleTypes,
  filteredDetails,
  hasDwgDetails,
  dwgLayerOptions,
  dwgEntityTypeOptions,
  hasActiveFilters,
  filteredAndSearched,
  resetFilters,
} = useIssueFilter(detailsRef, selectedFileIdRef)

const {
  batchMode,
  selectedIssueIds,
  batchLoading,
  isAllSelected,
  isIndeterminate,
  adoptableCount,
  fpMarkableCount,
  hasAdoptableItems,
  hasFpMarkableItems,
  enterBatchMode,
  exitBatchMode,
  toggleIssueSelection,
  toggleSelectAll,
  clearSelection,
  getSelectedIssues,
} = useBatchSelection(filteredAndSearched)

// 常量配置
const allCategories = ALL_CATEGORIES
const dwgRuleTypeOptions = DWG_RULE_TYPE_OPTIONS

const hasActiveAdvancedFilters = computed(() => !!(filterCategory.value || filterDwgLayers.value?.length || filterDwgEntityTypes.value?.length || filterDwgRuleTypes.value?.length))

// ===== 信噪比治理：仅看实质问题（弱化 FLUENCE/提示级噪声，对应 docs/12 诊断） =====
const hideLowValue = ref(true)

const SEV_RANK: Record<string, number> = { error: 0, warning: 1, info: 2, prompt: 3 }

// 对过滤后的问题做：严重度排序 + 可选的噪声弱化
const effectiveIssues = computed(() => {
  const list = filteredAndSearched.value
  let out = list
  if (hideLowValue.value) {
    out = out.filter((it: IssueDetail) => {
      // 弱化：FLUENCE 修辞类 + 提示(info/prompt)级，只留 error/warning 的实质问题
      if (it.issueType === 'FLUENCE') return false
      if (it.severity === 'info' || it.severity === 'prompt') return false
      return true
    })
  }
  // 严重度排序：error 置顶
  return [...out].sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9))
})

// ===== 分组功能 =====
const groupMode = ref(false)
const expandedGroups = reactive(new Set<string>())

// ===== 全部展开/折叠 =====
const allExpanded = ref(false)

const toggleExpandAll = () => {
  allExpanded.value = !allExpanded.value
}

/** 按描述模式将问题分组 */
const groupedIssues = computed(() => {
  const groups = new Map<string, { key: string; label: string; count: number; severity: string; sampleDesc: string; items: IssueDetail[] }>()

  for (const issue of effectiveIssues.value) {
    const key = getGroupKey(issue)
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: getGroupLabel(issue),
        count: 0,
        severity: issue.severity,
        sampleDesc: getShortDesc(issue.description || ''),
        items: [],
      })
    }
    const g = groups.get(key)!
    g.count++
    // 保留更高严重级别的
    if (issue.severity === 'error') g.severity = 'error'
    g.items.push(issue)
  }

  // 如果只有一个组，返回空（不需要分组）
  const result = Array.from(groups.values())
  if (result.length <= 1) return []

  // 默认仅展开含 error 的组（先让用户看到高价值问题，弱化警告噪声）
  if (result.length > 0 && expandedGroups.size === 0) {
    for (const g of result) {
      if (g.severity === 'error') expandedGroups.add(g.key)
    }
  }

  // 排序：error 组优先，其余按数量降序
  const sevRank = (s: string) => s === 'error' ? 0 : s === 'warning' ? 1 : 2
  return result.sort((a, b) => {
    const r = sevRank(a.severity) - sevRank(b.severity)
    return r !== 0 ? r : b.count - a.count
  })
})

/** 提取分组键：截取描述的前14个字符作为分组依据 */
function getGroupKey(issue: IssueDetail): string {
  const desc = (issue.description || '').trim()
  // 提取冒号或逗号前的核心问题描述
  const short = desc.split(/[：:，,。]/)[0].trim()
  return short.slice(0, 14) + '_' + issue.severity
}

/** 获取分组标签 */
function getGroupLabel(issue: IssueDetail): string {
  const desc = (issue.description || '').trim()
  const short = desc.split(/[：:，,。]/)[0].trim()
  return short.length > 20 ? short.slice(0, 20) + '...' : short
}

/** 获取简短描述作为示例 */
function getShortDesc(desc: string): string {
  const after = desc.split(/[：:]/, 2)[1] || desc
  return after.trim().slice(0, 30) + (after.trim().length > 30 ? '...' : '')
}

/** 切换分组展开/折叠 */
function toggleGroup(key: string) {
  if (expandedGroups.has(key)) {
    expandedGroups.delete(key)
  } else {
    expandedGroups.add(key)
  }
}

// ===== RULE_ONLY 模式：按检查项分组 =====
const isCustomRuleMode = computed(() => props.reviewMode === 'RULE_ONLY')

/** 规则注册表数据（按需加载） */
const ruleRegistry = ref<{ groups: RuleGroupMeta[]; prefixMap: Map<string, RuleMetaItem> } | null>(null)
const ruleRegistryLoaded = ref(false)

/** 从 ruleCode 提取规则前缀（如 NAME_001 → NAME, DWG_TITLE_001 → DWG_TITLE） */
function extractRulePrefix(ruleCode: string): string {
  if (!ruleCode) return 'OTHER'
  // 匹配前缀：取最后一个下划线之前的部分
  const match = ruleCode.match(/^(.+)_\d+$/)
  return match ? match[1] : ruleCode
}

/** 按检查项分组的结果（仅 RULE_ONLY 模式） */
const issuesByRuleGroup = computed(() => {
  if (!isCustomRuleMode.value || !ruleRegistryLoaded.value) return []

  const prefixMap = ruleRegistry.value?.prefixMap
  if (!prefixMap) return []

  // 按规则前缀分组
  const groupMap = new Map<
    string,
    {
      prefix: string
      label: string
      description: string
      group: string
      icon: string
      enabled: boolean
      errorCount: number
      warningCount: number
      infoCount: number
      items: IssueDetail[]
    }
  >()

  for (const issue of effectiveIssues.value) {
    const prefix = extractRulePrefix(issue.ruleCode || '')
    const meta = prefixMap.get(prefix)

    if (!groupMap.has(prefix)) {
      groupMap.set(prefix, {
        prefix,
        label: meta?.label || prefix,
        description: meta?.description || '',
        group: meta?.group || '其他',
        icon: meta?.icon || 'WarningFilled',
        enabled: props.enabledPrefixes?.includes(prefix) ?? false,
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
        items: [],
      })
    }

    const g = groupMap.get(prefix)!
    g.items.push(issue)
    if (issue.severity === 'error') g.errorCount++
    else if (issue.severity === 'warning') g.warningCount++
    else g.infoCount++
  }

  // 按组（group）分组排序，每组内按数量降序
  const byGroup = new Map<string, typeof groupMap extends Map<any, infer V> ? V[] : never>()
  for (const g of groupMap.values()) {
    const groupName = g.group
    if (!byGroup.has(groupName)) byGroup.set(groupName, [])
    byGroup.get(groupName)!.push(g)
  }

  return Array.from(byGroup.entries()).map(([groupName, rules]) => ({
    groupName,
    rules: rules.sort((a, b) => b.items.length - a.items.length),
  }))
})

/** 切换规则组展开/折叠 */
function toggleRuleGroup(key: string) {
  if (expandedRuleGroups.has(key)) {
    expandedRuleGroups.delete(key)
  } else {
    expandedRuleGroups.add(key)
  }
}

/** 规则组展开状态 */
const expandedRuleGroups = reactive(new Set<string>())
// 默认全部展开
watch(() => issuesByRuleGroup.value, (groups) => {
  if (groups.length > 0 && expandedRuleGroups.size === 0) {
    for (const g of groups) {
      for (const r of g.rules) {
        expandedRuleGroups.add(r.prefix)
      }
    }
  }
}, { immediate: true })

// 组件挂载时，仅 RULE_ONLY 模式加载规则注册表
onMounted(async () => {
  if (!isCustomRuleMode.value) return
  try {
    const res = await getRuleRegistryApi()
    const data = res.data
    const prefixMap = new Map<string, RuleMetaItem>()
    for (const group of data.groups) {
      for (const item of group.items) {
        prefixMap.set(item.prefix, item)
      }
    }
    ruleRegistry.value = { groups: data.groups, prefixMap }
    ruleRegistryLoaded.value = true
  } catch (e) {
    console.error('[IssueCardList] 加载规则注册表失败:', e)
  }
})

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

// 批量采纳建议
const handleBatchAdopt = async () => {
  if (!hasAdoptableItems.value) return

  try {
    await ElMessageBox.confirm(
      `确定要批量采纳 ${adoptableCount.value} 条建议吗？采纳后将标记为已采纳。`,
      '批量确认',
      {
        confirmButtonText: '确认采纳',
        cancelButtonText: '取消',
        type: 'success',
        distinguishCancelAndClose: true,
      }
    )

    batchLoading.value = true

    // 筛选出可采纳的问题ID
    const adoptableIds = getSelectedIssues()
      .filter((issue: IssueDetail) => issue.suggestedText && !issue.isFalsePositive)
      .map((issue: IssueDetail) => issue.id)

    // 触发父组件事件（真实采纳结果与提示由父组件 handleBatchAdoptFromIssueList 完成后给出，
    // 2026-08 修复：此前此处无条件弹"已提交 N 条采纳请求"，与父组件结果提示重复）
    emit('batchAdopt', adoptableIds)

    // 延迟清空选择，让用户看到反馈
    setTimeout(() => {
      clearSelection()
    }, 1000)
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error('批量操作失败')
      console.error('批量采纳失败:', error)
    }
  } finally {
    batchLoading.value = false
  }
}

// 批量标记误报
const handleBatchFalsePositive = async () => {
  if (!hasFpMarkableItems.value) return

  try {
    const { value: reason } = await ElMessageBox.prompt(
      `请输入将 ${fpMarkableCount.value} 条问题标记为误报的原因：`,
      '批量标记误报',
      {
        confirmButtonText: '确认标记',
        cancelButtonText: '取消',
        inputPlaceholder: '例如：该条款符合公司内部规定...',
        inputType: 'textarea',
        inputValidator: (val: string) => {
          if (!val || val.trim().length < 5) {
            return '请至少输入5个字符的原因说明'
          }
          return true
        },
      }
    )

    batchLoading.value = true

    // 筛选出可标记的问题ID
    const fpMarkableIds = getSelectedIssues()
      .filter((issue: IssueDetail) => !issue.isFalsePositive)
      .map((issue: IssueDetail) => issue.id)

    // 触发父组件事件（真实标记结果与提示由父组件 handleBatchFalsePositiveFromIssueList 完成后给出，
    // 2026-08 修复：此前此处无条件弹"已提交 N 条"假成功提示）
    emit('batchFalsePositive', fpMarkableIds, reason)

    setTimeout(() => {
      clearSelection()
    }, 1000)
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error('批量操作失败')
      console.error('批量标记误报失败:', error)
    }
  } finally {
    batchLoading.value = false
  }
}

// 暴露方法给父组件
defineExpose({
  errorContentRef,
  scrollToIssue,
})
</script>

<style scoped>
/* ===== 面板容器 — Inset Shadow ===== */
.right-panel {
  flex: 1;
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  box-shadow: var(--border-inset), 0 1px 2px rgba(0, 0, 0, 0.04);
  overflow: hidden;
  min-width: 0;
}

.panel-header {
  padding: 10px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-gray-100); /* 原 #F0F0F0 */
}
.panel-title { font-weight: 800; font-size: 14px; color: var(--corp-text-primary); }
.result-count { font-size: var(--text-sm); color: var(--corp-text-secondary); }

.filter-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-bottom: 1px solid var(--color-gray-100); /* 原 #F0F0F0 */
  flex-shrink: 0;
  background: var(--bg-surface);
  position: sticky;
  top: 0;
  z-index: 10;
}
.filter-group { display: flex; align-items: center; gap: 8px; }
.filter-advanced { padding-top: 8px; border-top: 1px solid var(--color-gray-100); margin-top: 8px; } /* 原 #F0F0F0 */

/* ===== 批量操作工具栏样式已迁移至 BatchToolbar.vue ===== */

/* 批量模式下卡片增加左边距（为checkbox留空间） */
.batch-mode-active .issue-card {
  position: relative;
  padding-left: 36px;
}

.error-content { flex: 1; padding: 12px 14px; overflow-y: auto; }

@media (max-width: 800px) {
  .filter-toolbar { flex-wrap: wrap; }
  .filter-group { flex-wrap: wrap; }
}
.filter-toolbar .el-select .el-tag { max-width: 80px; }

/* ===== 分组样式 ===== */
.filter-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.issue-group {
  margin-bottom: 4px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--color-gray-50);
  border: 1px solid var(--corp-border-light); /* 原 #E2E8F0 */
  border-radius: var(--radius-md);
  cursor: pointer;
  user-select: none;
  transition: background 0.15s, box-shadow 0.15s;
  margin-bottom: 2px;
}
.group-header:hover {
  background: var(--color-gray-100); /* 原 #F1F5F9 */
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.group-arrow {
  font-size: 12px;
  color: var(--corp-text-secondary); /* 原 #64748B */
  transition: transform 0.2s ease;
  flex-shrink: 0;
}
.group-arrow.expanded {
  transform: rotate(90deg);
}

.group-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-gray-800); /* 原 #1E293B */
  flex-shrink: 0;
}

.group-sample {
  font-size: 12px;
  color: var(--color-gray-400); /* 原 #94A3B8 */
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

.group-items {
  padding-left: 4px;
  border-left: 2px solid var(--corp-border-light); /* 原 #E2E8F0 */
  margin-left: 8px;
  margin-bottom: 8px;
}

/* ===== RULE_ONLY 模式：按检查项分组 ===== */
.rule-group-section {
  margin-bottom: 16px;
}

.rule-group-title {
  font-size: 12px;
  font-weight: 800;
  color: var(--corp-text-secondary); /* 原 #64748B */
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 0 4px 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.rule-group-icon {
  font-size: 13px;
}

.rule-group-card {
  margin-bottom: 4px;
  border: 1px solid var(--corp-border-light); /* 原 #E2E8F0 */
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-surface);
  transition: border-color 0.15s;
}
.rule-group-card:hover {
  border-color: var(--corp-border); /* 原 #CBD5E1 */
}
.rule-group-card--empty {
  opacity: 0.7;
  background: var(--color-gray-50);
}

.rule-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  transition: background 0.12s;
}
.rule-group-header:hover {
  background: var(--color-gray-50);
}

.rule-group-arrow {
  font-size: 12px;
  color: var(--color-gray-400); /* 原 #94A3B8 */
  flex-shrink: 0;
  transition: transform 0.2s ease;
}
.rule-group-arrow.expanded {
  transform: rotate(90deg);
}

.rule-group-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-gray-800); /* 原 #1E293B */
  flex-shrink: 0;
}

.rule-group-desc {
  font-size: 12px;
  color: var(--color-gray-400); /* 原 #94A3B8 */
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rule-group-stats {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.rule-pass-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  color: var(--corp-success); /* 原 #67C23A */
  font-weight: 600;
}

.rule-group-items {
  padding: 0 14px 10px;
  border-top: 1px solid var(--color-gray-100); /* 原 #F0F0F0 */
}
</style>
