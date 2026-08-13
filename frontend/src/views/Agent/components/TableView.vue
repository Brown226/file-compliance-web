<template>
  <div class="table-view">
    <!-- 统计行 -->
    <div class="table-view-stats">
      <span class="table-view-stat">共 <b>{{ tables.length }}</b> 个表格</span>
      <span class="table-view-stat">合计 <b>{{ totalRows }}</b> 行</span>
      <span v-if="hasCsv" class="table-view-csv-hint">CSV 已生成</span>
    </div>

    <!-- 表格列表 -->
    <div v-for="(table, ti) in tables" :key="ti" class="table-card">
      <div class="table-card-header">
        <span class="table-card-title">表格 {{ ti + 1 }}</span>
        <span v-if="table.sheetName" class="table-card-tag">{{ table.sheetName }}</span>
        <span v-if="table.page" class="table-card-tag">第 {{ table.page }} 页</span>
        <span class="table-card-dim">{{ table.rows.length }} 行</span>
      </div>

      <div class="table-scroll">
        <table class="data-table">
          <thead v-if="table.headers.length > 0">
            <tr>
              <th v-for="(h, hi) in table.headers" :key="'h' + hi">{{ h }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, ri) in table.rows" :key="ri">
              <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
            </tr>
            <tr v-if="table.rows.length === 0">
              <td :colspan="Math.max(table.headers.length, 1)" class="table-empty">（空表格）</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 无表格 -->
    <div v-if="tables.length === 0" class="table-empty-all">未提取到表格</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface TableRow { sheetName?: string; page?: number; headers: string[]; rows: string[][] }

const props = defineProps<{
  result: { tables?: TableRow[]; count?: number; totalRows?: number; csv?: string } | null
}>()

const tables = computed<TableRow[]>(() => {
  if (!props.result || !Array.isArray(props.result.tables)) return []
  return props.result.tables
})
const totalRows = computed<number>(() => props.result?.totalRows ?? 0)
const hasCsv = computed(() => Boolean(props.result?.csv))
</script>

<style scoped>
.table-view {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid color-mix(in srgb, var(--color-success) 15%, transparent);
  background: var(--bg-subtle);
}
.table-view-stats {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--text-muted);
}
.table-view-stat b { color: var(--text); font-weight: 600; }
.table-view-csv-hint {
  margin-left: auto;
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-success) 12%, transparent);
  color: var(--color-success-600);
  font-size: 12px;
}
.table-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.table-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  background: var(--bg);
  font-size: 12px;
}
.table-card-title { font-weight: 600; color: var(--text); }
.table-card-tag {
  padding: 0 5px;
  border-radius: 4px;
  background: var(--bg-selected);
  color: var(--text-muted);
  font-size: 12px;
  font-family: var(--font-mono);
}
.table-card-dim { margin-left: auto; color: var(--text-dim); }
.table-scroll { overflow: auto; max-height: 300px; }
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.data-table th, .data-table td {
  padding: 4px 8px;
  border: 1px solid var(--border);
  text-align: left;
  white-space: nowrap;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.data-table thead th {
  position: sticky;
  top: 0;
  background: var(--bg-panel);
  color: var(--text);
  font-weight: 600;
}
.data-table tbody tr:nth-child(even) { background: var(--bg-subtle); }
.table-empty, .table-empty-all { color: var(--text-dim); font-style: italic; text-align: center; }
.table-empty-all { padding: 10px; }
</style>
