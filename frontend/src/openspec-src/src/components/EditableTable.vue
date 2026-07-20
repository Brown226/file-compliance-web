<template>
  <div class="editor-block">
    <table class="info-table">
      <tbody>
        <tr v-for="(row, rowIndex) in tableData" :key="rowIndex">
          <td 
            contenteditable="true" 
            @input="handleCellInput(rowIndex, 'item1', $event)"
            @blur="$emit('table-modified')"
            v-text="typeof row === 'object' ? row.item1 : ''"
          ></td>
          <td 
            contenteditable="true" 
            @input="handleCellInput(rowIndex, 'value1', $event)"
            @blur="$emit('table-modified')"
            v-text="typeof row === 'object' ? row.value1 : ''"
          ></td>
          <td 
            contenteditable="true" 
            @input="handleCellInput(rowIndex, 'item2', $event)"
            @blur="$emit('table-modified')"
            v-text="typeof row === 'object' ? row.item2 : ''"
          ></td>
          <td 
            contenteditable="true" 
            @input="handleCellInput(rowIndex, 'value2', $event)"
            @blur="$emit('table-modified')"
            v-text="typeof row === 'object' ? row.value2 : ''"
          ></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">

interface TableRow {
  item1: string
  value1: string
  item2: string
  value2: string
}

const props = defineProps<{
  tableData: TableRow[]
}>()

const emit = defineEmits<{
  'update-cell': [{ rowIndex: number, field: string, value: string }]
  'table-modified': []
}>()

const handleCellInput = (rowIndex: number, field: string, event: Event) => {
  const target = event.target as HTMLElement
  if (!target) return
  
  const value = target.textContent || ''
  emit('update-cell', { rowIndex, field, value })
}


// 更新表格单元格数据
const updateTableCell = (chapter: any, { rowIndex, field, value }: { rowIndex: number, field: string, value: string }) => {
  if (!chapter.paragraphs) return
  
  // 找到表格段落
  const tableParagraph = chapter.paragraphs.find((p: any) => p.type === 'table')
  if (!tableParagraph || !tableParagraph.content || !tableParagraph.content[rowIndex]) return
  
  // 更新表格数据
  tableParagraph.content[rowIndex][field] = value
}
</script>

<style scoped>
.info-table td:focus {
  outline: 2px solid #409eff;
  outline-offset: -2px;
}

/* 可编辑表格样式 - 基于原型设计 */
.info-table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.info-table td {
  padding: 12px 16px;
  border: 1px solid #e5e7eb;
  font-size: 14px;
  line-height: 1.5;
  color: #374151;
  background: white;
  transition: all 0.2s ease;
  min-width: 120px;
  position: relative;
}

.info-table td:nth-child(odd) {
  background: #f9fafb;
  font-weight: 500;
  color: #1f2937;
}

.info-table td:nth-child(even) {
  background: white;
}

.info-table td[contenteditable="true"]:hover {
  background: #f3f4f6;
  border-color: #d1d5db;
  cursor: text;
}

.info-table td[contenteditable="true"]:focus {
  outline: none;
  background: white;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.info-table tr:hover td {
  background: #f8fafc;
}

.info-table tr:hover td:nth-child(odd) {
  background: #f1f5f9;
}

/* 表格容器样式 */
.editor-block .info-table {
  margin: 0;
  border-radius: 6px;
}

@media (max-width: 768px) {
  .info-table {
    font-size: 13px;
  }
  
  .info-table td {
    padding: 10px 12px;
    min-width: 100px;
  }
}
</style>