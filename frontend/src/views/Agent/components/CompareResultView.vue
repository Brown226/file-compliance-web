<template>
  <div class="compare-result-view">
    <!-- 结论 + 命中统计 -->
    <div class="crv-header">
      <div class="crv-conclusion">{{ result?.conclusion || '未生成结论' }}</div>
      <div class="crv-stats" v-if="result && (result.docAHits || result.docBHits)">
        <span class="crv-stat">A 命中 <b>{{ result.docAHits }}</b> 段</span>
        <span class="crv-stat">B 命中 <b>{{ result.docBHits }}</b> 段</span>
        <span class="crv-stat">比对 <b>{{ result.totalCompared }}</b> 项</span>
      </div>
    </div>

    <!-- 主题级对比表 -->
    <div v-if="items.length > 0" class="crv-table-wrap">
      <table class="crv-table">
        <thead>
          <tr>
            <th style="width: 24%">主题</th>
            <th style="width: 76px">状态</th>
            <th>文档 A 表述</th>
            <th>文档 B 表述</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(it, idx) in items" :key="idx">
            <td class="crv-topic">{{ it.topic }}</td>
            <td>
              <span class="crv-status" :class="`st-${it.status}`">{{ statusLabel(it.status) }}</span>
            </td>
            <td class="crv-text">{{ it.docAText || '—' }}</td>
            <td class="crv-text">{{ it.docBText || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 无可比项 -->
    <div v-else class="crv-empty">无对比条目（可能未检索到可比对内容）</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface CompareItem {
  topic: string
  status: 'consistent' | 'inconsistent' | 'missing'
  docAText?: string
  docBText?: string
}

const props = defineProps<{
  result: {
    conclusion?: string
    items?: CompareItem[]
    docAHits?: number
    docBHits?: number
    totalCompared?: number
  } | null
}>()

const items = computed<CompareItem[]>(() => {
  if (!props.result || !Array.isArray(props.result.items)) return []
  return props.result.items
})

function statusLabel(s: string): string {
  return { consistent: '一致', inconsistent: '不一致', missing: '缺失' }[s] || s
}
</script>

<style scoped>
.compare-result-view {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid rgba(99, 102, 241, 0.15);
  background: var(--bg-subtle);
}
.crv-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.crv-conclusion {
  font-size: 12px;
  color: var(--text);
  line-height: 1.5;
}
.crv-stats {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--text-muted);
}
.crv-stat b { color: var(--text); font-weight: 600; }
.crv-table-wrap { overflow: auto; max-height: 320px; }
.crv-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.crv-table th, .crv-table td {
  padding: 5px 8px;
  border: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}
.crv-table thead th {
  position: sticky;
  top: 0;
  background: var(--bg-panel);
  color: var(--text);
  font-weight: 600;
}
.crv-topic { font-weight: 600; color: var(--text); }
.crv-text {
  color: var(--text-muted);
  word-break: break-all;
  line-height: 1.5;
}
.crv-status {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}
.st-consistent { background: rgba(34, 197, 94, 0.14); color: #16a34a; }
.st-inconsistent { background: rgba(239, 68, 68, 0.14); color: #dc2626; }
.st-missing { background: rgba(249, 115, 22, 0.14); color: #ea580c; }
.crv-empty {
  padding: 10px;
  color: var(--text-dim);
  font-style: italic;
  text-align: center;
  font-size: 12px;
}
</style>
