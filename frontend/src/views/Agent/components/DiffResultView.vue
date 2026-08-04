<template>
  <div class="diff-result-view">
    <!-- 变更统计条 -->
    <div class="diff-stats">
      <span class="stat added">＋新增 {{ stats.added }}</span>
      <span class="stat removed">－删除 {{ stats.removed }}</span>
      <span class="stat modified">～修改 {{ stats.modified }}</span>
      <span class="stat unchanged">＝未变 {{ stats.unchanged }}</span>
      <span class="stat total">共 {{ result.totalChanges }} 处变更</span>
    </div>

    <!-- LLM 变更摘要 -->
    <div v-if="result.summary" class="diff-summary">
      <div class="diff-summary-title">变更摘要</div>
      <div class="diff-summary-body">{{ result.summary }}</div>
    </div>

    <!-- 变更块列表 -->
    <div v-if="changes.length > 0" class="diff-changes">
      <div
        v-for="(c, idx) in changes"
        :key="idx"
        class="diff-change"
        :class="`type-${c.type}`"
      >
        <div class="change-head">
          <span class="change-badge" :class="`badge-${c.type}`">{{ typeLabel(c.type) }}</span>
          <span v-if="c.sectionTitle" class="change-section" :title="c.sectionTitle">{{ c.sectionTitle }}</span>
          <span class="change-index">#{{ idx + 1 }}</span>
        </div>
        <div v-if="c.type === 'added'" class="change-text added-text">{{ c.newText }}</div>
        <div v-if="c.type === 'removed'" class="change-text removed-text">{{ c.oldText }}</div>
        <template v-if="c.type === 'modified'">
          <div class="change-text removed-text">
            <span class="arrow-mark">旧</span>{{ c.oldText }}
          </div>
          <div class="change-text added-text">
            <span class="arrow-mark">新</span>{{ c.newText }}
          </div>
        </template>
      </div>
    </div>

    <div v-else-if="result.totalChanges === 0" class="diff-empty">
      <span class="diff-empty-icon">✓</span> 两份文档内容一致，无差异
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface DiffChange {
  type: string
  index: number
  oldText?: string
  newText?: string
  sectionTitle?: string
}

interface DiffStats {
  added: number
  removed: number
  modified: number
  unchanged: number
}

interface DiffResult {
  changes?: DiffChange[]
  stats?: DiffStats
  summary?: string
  totalChanges?: number
}

const props = defineProps<{ result: DiffResult }>()

/** 剥离后端 <file_content> 防注入标签（那是给 LLM 的，不是给用户看的） */
function stripFileContentTags(text?: string): string {
  if (!text) return ''
  return text.replace(/<\/?file_content>/g, '')
}

const changes = computed(() => (props.result.changes || []).map(c => ({
  ...c,
  oldText: stripFileContentTags(c.oldText),
  newText: stripFileContentTags(c.newText),
})))

function typeLabel(type: string): string {
  switch (type) {
    case 'added': return '新增'
    case 'removed': return '删除'
    case 'modified': return '修改'
    default: return type
  }
}
</script>

<style scoped>
.diff-result-view {
  font-size: 12px;
  line-height: 1.6;
}

/* 统计条 */
.diff-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  padding: 8px 10px;
  border-top: 1px solid rgba(34, 197, 94, 0.15);
  background: var(--bg-subtle);
}
.stat {
  font-family: var(--font-mono);
  font-size: 11px;
}
.stat.added { color: #16a34a; }
.stat.removed { color: #dc2626; }
.stat.modified { color: #d97706; }
.stat.unchanged { color: var(--text-dim); }
.stat.total { color: var(--text-muted); }

/* 摘要 */
.diff-summary {
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  background: rgba(217, 119, 6, 0.05);
}
.diff-summary-title {
  font-size: 11px;
  font-weight: 600;
  color: #d97706;
  margin-bottom: 4px;
}
.diff-summary-body {
  color: var(--text-muted);
  white-space: pre-wrap;
  word-break: break-word;
}

/* 变更列表 */
.diff-changes {
  border-top: 1px solid var(--border);
}
.diff-change {
  padding: 6px 10px;
  border-top: 1px solid rgba(128, 128, 128, 0.12);
}
.diff-change:first-child { border-top: none; }
.change-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.change-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}
.badge-added { background: rgba(22, 163, 74, 0.12); color: #16a34a; }
.badge-removed { background: rgba(220, 38, 38, 0.12); color: #dc2626; }
.badge-modified { background: rgba(217, 119, 6, 0.12); color: #d97706; }
.change-section {
  font-size: 11px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.change-index {
  font-size: 10px;
  color: var(--text-dim);
  flex-shrink: 0;
}

/* 变更文本（对齐参考：左框线 + 底色区分） */
.change-text {
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 4px 8px;
  border-radius: 4px;
  margin-top: 2px;
}
.added-text {
  background: rgba(22, 163, 74, 0.06);
  border-left: 3px solid #16a34a;
  color: var(--text);
}
.removed-text {
  background: rgba(220, 38, 38, 0.05);
  border-left: 3px solid #dc2626;
  color: var(--text-muted);
  text-decoration: line-through;
  text-decoration-color: rgba(220, 38, 38, 0.4);
}
.arrow-mark {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  margin-right: 6px;
  color: var(--text-dim);
}

/* 空态 */
.diff-empty {
  padding: 12px 10px;
  border-top: 1px solid rgba(34, 197, 94, 0.15);
  color: #16a34a;
  font-size: 12px;
}
.diff-empty-icon {
  display: inline-block;
  width: 16px;
  height: 16px;
  line-height: 16px;
  text-align: center;
  border-radius: 50%;
  background: rgba(22, 163, 74, 0.15);
  margin-right: 6px;
  font-size: 10px;
}
</style>
