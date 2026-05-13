<template>
  <div class="excel-preview-panel">
    <div class="preview-header">
      <span class="preview-title">Excel 预览</span>
      <span class="preview-filename" v-if="fileName">{{ fileName }}</span>
    </div>

    <div v-if="loading" class="preview-loading">
      <el-icon class="is-loading" :size="24"><Loading /></el-icon>
      <span>正在加载 Excel 内容...</span>
    </div>

    <div v-else-if="!sheetNames.length" class="preview-empty">
      <el-icon :size="32" color="#94a3b8"><Grid /></el-icon>
      <p>暂无表格内容可预览</p>
      <p class="empty-hint">请先选择一个 Excel 文件</p>
    </div>

    <template v-else>
      <div class="sheet-tabs" v-if="sheetNames.length > 1">
        <el-button
          v-for="name in sheetNames"
          :key="name"
          :type="activeSheet === name ? 'primary' : 'default'"
          size="small"
          @click="switchSheet(name)"
        >
          {{ name }}
        </el-button>
      </div>

      <div class="table-area" ref="tableAreaRef">
        <table class="excel-table">
          <thead>
            <tr>
              <th class="row-number-header">#</th>
              <th
                v-for="(col, ci) in currentHeaders"
                :key="ci"
              >{{ col }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, ri) in currentRows" :key="ri">
              <td class="row-number">{{ ri + 1 }}</td>
              <td
                v-for="(cell, ci) in row"
                :key="ci"
                :class="{ 'cell-highlight': isCellHighlighted(cell) }"
                :ref="(el) => registerCell(el, ri, ci, cell)"
              >{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Loading, Grid } from '@element-plus/icons-vue'
import request from '@/utils/request'
import * as XLSX from 'xlsx'

const props = defineProps<{
  taskId: string
  fileId: string | null
  locateTarget?: { originalText: string } | null
}>()

const loading = ref(false)
const fileName = ref('')
const sheetNames = ref<string[]>([])
const activeSheet = ref('')
const sheets = ref<Record<string, string[][]>>({})
const tableAreaRef = ref<HTMLElement | null>(null)

const highlightCells = ref<Set<string>>(new Set())

const currentData = computed(() => sheets.value[activeSheet.value] || [])
const currentHeaders = computed(() => currentData.value[0] || [])
const currentRows = computed(() => currentData.value.slice(1))

function toCellKey(row: number, col: number) {
  return `${row},${col}`
}

function isCellHighlighted(value: unknown) {
  if (!props.locateTarget?.originalText || value == null) return false
  const text = String(value)
  return text.includes(props.locateTarget.originalText)
}

function registerCell(el: unknown, row: number, col: number, value: unknown) {
  if (!props.locateTarget?.originalText || value == null) return
  const text = String(value)
  if (text.includes(props.locateTarget.originalText)) {
    highlightCells.value.add(toCellKey(row, col))
  }
}

function buildHighlightMap() {
  highlightCells.value.clear()
  const search = props.locateTarget?.originalText
  if (!search) return
  const data = currentData.value
  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < data[r].length; c++) {
      const cell = data[r][c]
      if (cell != null && String(cell).includes(search)) {
        highlightCells.value.add(toCellKey(r, c))
      }
    }
  }
}

function scrollToFirstHighlight() {
  if (!highlightCells.value.size || !tableAreaRef.value) return
  const el = tableAreaRef.value.querySelector('.cell-highlight')
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

function switchSheet(name: string) {
  activeSheet.value = name
  buildHighlightMap()
  nextTick(scrollToFirstHighlight)
}

async function loadFile() {
  if (!props.fileId || !props.taskId) {
    sheetNames.value = []
    sheets.value = {}
    activeSheet.value = ''
    return
  }

  loading.value = true
  try {
    const res = await request.get(
      `/tasks/${props.taskId}/files/${props.fileId}/raw`,
      { responseType: 'arraybuffer' }
    )
    const workbook = XLSX.read(new Uint8Array(res.data), { type: 'array' })
    sheetNames.value = workbook.SheetNames
    const parsed: Record<string, string[][]> = {}
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name]
      parsed[name] = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' })
    }
    sheets.value = parsed
    activeSheet.value = workbook.SheetNames[0] || ''
    buildHighlightMap()
    nextTick(scrollToFirstHighlight)
  } catch (e) {
    console.error('[ExcelPreview] 加载文件失败:', e)
    sheetNames.value = []
    sheets.value = {}
    activeSheet.value = ''
  } finally {
    loading.value = false
  }
}

watch(() => props.fileId, loadFile, { immediate: true })

watch(() => props.locateTarget, () => {
  buildHighlightMap()
  nextTick(scrollToFirstHighlight)
}, { deep: true })
</script>

<style scoped>
.excel-preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: var(--corp-bg-panel);
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.preview-header {
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--corp-border-light);
  background: var(--corp-bg-sunken);
}

.preview-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--corp-text-primary);
  letter-spacing: 0.02em;
}

.preview-filename {
  font-size: 12px;
  color: var(--corp-text-secondary);
  background: var(--color-gray-50);
  padding: 3px 10px;
  border-radius: 12px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid var(--corp-border-light);
}

.preview-loading,
.preview-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--corp-text-secondary);
  font-size: 13px;
}

.empty-hint {
  font-size: 12px;
  color: var(--corp-text-secondary);
  opacity: 0.7;
}

.sheet-tabs {
  display: flex;
  gap: 6px;
  padding: 8px 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--corp-border-light);
  background: var(--corp-bg-sunken);
  overflow-x: auto;
}

.table-area {
  flex: 1;
  overflow: auto;
  padding: 0;
}

.excel-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  line-height: 1.5;
}

.excel-table thead {
  position: sticky;
  top: 0;
  z-index: 1;
}

.excel-table th {
  background: #f9fafb;
  font-weight: 600;
  color: #374151;
  padding: 8px 12px;
  text-align: left;
  border-bottom: 2px solid #e5e7eb;
  border-right: 1px solid #e5e7eb;
  white-space: nowrap;
}

.excel-table td {
  padding: 6px 12px;
  border-bottom: 1px solid #f3f4f6;
  border-right: 1px solid #f3f4f6;
  color: #4b5563;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.excel-table tbody tr:nth-child(even) {
  background: #fafbfc;
}

.excel-table tbody tr:hover td {
  background: #f0f4ff;
}

.row-number-header,
.row-number {
  width: 40px;
  min-width: 40px;
  text-align: center;
  color: #9ca3af;
  font-size: 11px;
  background: #f9fafb;
  border-right: 2px solid #e5e7eb;
}

.cell-highlight {
  background: rgba(239, 68, 68, 0.15) !important;
  outline: 2px solid #EF4444;
  outline-offset: -2px;
  font-weight: 600;
  color: #dc2626;
}
</style>
