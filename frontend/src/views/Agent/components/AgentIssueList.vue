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
              <div class="section-content ref-row">
                <span class="ref-text">{{ issue.standardRef }}</span>
                <el-button
                  v-if="refResolvable(issue.standardRef)"
                  size="small"
                  text
                  type="primary"
                  class="ref-jump-btn"
                  :loading="refJumping"
                  @click.stop="viewClause(issue.standardRef)"
                >
                  查看条文
                </el-button>
              </div>
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

            <!-- P2-⑧ 误报反馈 / P2-⑬ 定位原文 -->
            <div class="fp-action-row">
              <el-button
                v-if="issue.originalText"
                size="small"
                text
                :icon="Aim"
                class="locate-btn"
                @click.stop="emit('locate-issue', issue)"
              >
                定位原文
              </el-button>
              <el-button
                size="small"
                text
                :icon="CircleClose"
                class="fp-btn"
                :loading="fpMarking.has(fpKey(issue))"
                @click.stop="markFalsePositive(issue)"
              >
                标记误报
              </el-button>
              <span v-if="fpDone.has(fpKey(issue))" class="fp-done">已反馈误报库</span>
            </div>
          </div>
        </transition>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, ArrowDown, Document, CircleClose, Aim } from '@element-plus/icons-vue'
import { getStandardTreeApi, getClausesByStandardApi } from '@/views/StandardLibrary/service/standardClauses'
import { markAgentIssueFalsePositiveApi } from '@/api/agent'
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

// P2-⑬ 行级批注：向父组件请求定位原文（父组件负责打开文件 + 传 highlight 给 AgentFileViewer）
const emit = defineEmits<{
  (e: 'locate-issue', issue: AgentIssue): void
}>()

const router = useRouter()

const filterSeverity = ref<'error' | 'warning' | 'info' | ''>('')
const searchText = ref('')
const expandedIds = ref<Set<string>>(new Set())

// ===== P1-⑦ 查看条文跳转 =====
// standardRef 形如「GB 50052-2009 供配电系统设计规范 · 3.0.2」或「GB/T 50001-2017 第3.0.2条」。
// 跳转目标：/knowledge?tab=clauses&standardId={id}&clauseId={id}（StandardClauses 按 query 定位展开条文）
// 用模块级缓存避免重复拉取标准树（Agent 会话中多个 issue 共享同一批标准）。
let treeCache: StandardTreeNode[] | null = null
let treeCachePromise: Promise<StandardTreeNode[]> | null = null
const refJumping = ref(false)

async function getTreeOnce(): Promise<StandardTreeNode[]> {
  if (treeCache) return treeCache
  if (!treeCachePromise) {
    treeCachePromise = getStandardTreeApi().then(t => {
      treeCache = t
      return t
    })
  }
  return treeCachePromise
}

/** 从 standardRef 中提取标准编号（如 GB/T 50001-2017），未识别返回 null */
function extractStandardNumber(ref: string): string | null {
  // 匹配「GB/T 50001-2017」「GB 50052-2009」「JGJ 102-2003」等编号
  const m = ref.match(/([A-Za-z]+(?:[\/-][A-Za-z]+)*\s*\d+(?:\.\d+)*[-–]\s*\d{4})/)
  return m ? m[1].replace(/\s+/g, ' ').trim() : null
}

/** 从 standardRef 中提取条文号（如 3.0.2），未识别返回 null */
function extractClauseNumber(ref: string): string | null {
  // 优先「第X条」形式，其次裸数字编号 3.0.2 / 5.1
  const m1 = ref.match(/第\s*([\d.]+)\s*条/)
  if (m1) return m1[1].trim()
  // 排除已作为标准编号一部分的数字（编号年份 4 位），找条文号
  const m2 = ref.match(/(?:^|[\s·,，、··])(\d+(?:\.\d+){1,2})\b/)
  return m2 ? m2[1] : null
}

function normalizeNo(s: string): string {
  return s.replace(/\s+/g, '').replace(/–/g, '-').toLowerCase()
}

/** 判断 standardRef 是否可能解析出可跳转的标准+条文（有编号形如标准+条文，才显示按钮） */
function refResolvable(ref: string): boolean {
  if (!ref) return false
  return !!extractStandardNumber(ref) && !!extractClauseNumber(ref)
}

async function viewClause(ref: string) {
  const standardNo = extractStandardNumber(ref)
  const clauseNo = extractClauseNumber(ref)
  if (!standardNo || !clauseNo) return
  refJumping.value = true
  try {
    const tree = await getTreeOnce()
    const norm = normalizeNo(standardNo)
    const node = tree.find(n => normalizeNo(n.standard.number) === norm)
    if (!node) {
      ElMessage.warning(`未找到标准「${standardNo}」，请到知识库确认标准编号`)
      return
    }
    // 条文可能在标准树未含 clauses（树默认不含），需要按标准查条文
    let clause = node.clauses?.find(c => normalizeNo(c.clause.clauseNumber) === normalizeNo(clauseNo))
    if (!clause) {
      const clauses = await getClausesByStandardApi(node.standard.id)
      clause = clauses.find(c => normalizeNo(c.clause.clauseNumber) === normalizeNo(clauseNo)) || null
    }
    if (!clause) {
      ElMessage.warning(`未找到标准「${standardNo}」中的条文「${clauseNo}」`)
      return
    }
    router.push({
      path: '/knowledge',
      query: { tab: 'clauses', standardId: node.standard.id, clauseId: clause.clause.id },
    })
  } finally {
    refJumping.value = false
  }
}

// ===== P2-⑧ 误报反馈闭环 =====
// 用 issue 关键字段拼唯一键，避免同一 issue 重复反馈；Set 持久记录已反馈。
const fpMarking = ref<Set<string>>(new Set())
const fpDone = ref<Set<string>>(new Set())

function fpKey(issue: AgentIssue): string {
  return `${(issue as any).id || ''}:${(issue.originalText || '').slice(0, 40)}`
}

async function markFalsePositive(issue: AgentIssue) {
  const key = fpKey(issue)
  const originalText = issue.originalText || issue.description || ''
  if (!originalText) {
    ElMessage.warning('该问题无原文，无法标记误报')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认将该问题标记为误报？\n原文：${originalText.slice(0, 60)}${originalText.length > 60 ? '…' : ''}`,
      '标记误报',
      { confirmButtonText: '确认标记', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return // 用户取消
  }

  if (fpMarking.value.has(key)) return
  fpMarking.value.add(key)
  try {
    const res = await markAgentIssueFalsePositiveApi({
      originalText,
      issueType: issue.issueType,
      ruleCode: issue.ruleCode,
      severity: issue.severity,
      reason: 'Agent 审查结果误报反馈',
    })
    fpDone.value.add(key)
    ElMessage.success(res?.added ? '已加入误报库' : '误报库已更新（该原文此前已被标记）')
  } catch (e: any) {
    ElMessage.error(`标记失败：${e?.message || '未知错误'}`)
  } finally {
    fpMarking.value.delete(key)
  }
}

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
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  overflow: hidden;
  margin: 8px 0;
}

.list-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.list-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--text);
}

.list-count {
  font-size: 12px;
  color: var(--text-muted);
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
  color: var(--text-dim);
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
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
}

.issue-card:last-child {
  border-bottom: none;
}

.issue-card:hover {
  background: var(--bg-hover);
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

.dot-error { background: var(--danger); }
.dot-warning { background: var(--warning); }
.dot-info { background: var(--accent); }

.issue-type {
  flex-shrink: 0;
}

.issue-desc {
  flex: 1;
  font-size: 12px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.issue-rule {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-hover);
  padding: 1px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}

.expand-icon {
  color: var(--text-dim);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.expand-icon.rotated {
  transform: rotate(180deg);
}

.card-body {
  padding: 8px 12px 12px;
  background: var(--bg);
  border-top: 1px solid var(--border);
}

.section {
  margin-bottom: 8px;
}

.section:last-child {
  margin-bottom: 0;
}

.section-label {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 3px;
  font-weight: 600;
}

.section-content {
  font-size: 12px;
  color: var(--text);
  line-height: 1.5;
  padding: 6px 8px;
  background: var(--bg-subtle);
  border-radius: 4px;
  word-break: break-all;
}

.section-content.original {
  border-left: 2px solid var(--danger);
}

.section-content.suggested {
  border-left: 2px solid var(--success);
}

.ref-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ref-text {
  flex: 1;
  word-break: break-all;
}

.ref-jump-btn {
  flex-shrink: 0;
}

.fp-action-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px dashed var(--border);
}

.fp-btn {
  color: var(--warning);
  font-size: 12px;
}

.locate-btn {
  color: var(--accent);
  font-size: 12px;
}

.fp-done {
  font-size: 11px;
  color: var(--success);
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
  font-size: 11px;
  color: var(--text-muted);
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
