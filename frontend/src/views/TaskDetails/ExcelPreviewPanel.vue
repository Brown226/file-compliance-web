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
      <el-icon :size="32" color="var(--color-gray-400)"><Grid /></el-icon>
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
  fileUrl?: string
  locateTarget?: { originalText: string; locateCandidates?: string[]; locateMeta?: any; locateHint?: string } | null
}>()

const emit = defineEmits<{
  locateResult: [{ success: boolean; mode: 'direct' | 'fallback'; hint?: string }]
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

const normalizeForLocate = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[\s\u3000]/g, '')
    .replace(/[，。！？；：、“”"'`‘’（）()\[\]【】《》〈〉,.;:!?\-_/\\|]/g, '')

const includesLoose = (haystack: string, needle: string): boolean => {
  const n = normalizeForLocate(needle)
  if (!n) return false
  return normalizeForLocate(haystack).includes(n)
}

const getLocateTerms = (): string[] => {
  const target = props.locateTarget
  if (!target) return []
  const list = Array.isArray(target.locateCandidates) ? target.locateCandidates : []
  const quote = target.locateMeta?.quote?.text ? [target.locateMeta.quote.text] : []
  const context = [
    target.locateMeta?.context?.prefix || '',
    target.locateMeta?.context?.suffix || '',
  ].filter(Boolean)
  const terms = [...quote, ...list, target.originalText, ...context]
    .map(s => String(s || '').trim())
    .filter(Boolean)
  return [...new Set(terms)]
}

function isCellHighlighted(value: unknown) {
  const locateTerms = getLocateTerms()
  if (!locateTerms.length || value == null) return false
  const text = String(value)
  return locateTerms.some(term => text.includes(term) || includesLoose(text, term))
}

function registerCell(el: unknown, row: number, col: number, value: unknown) {
  const locateTerms = getLocateTerms()
  if (!locateTerms.length || value == null) return
  const text = String(value)
  if (locateTerms.some(term => text.includes(term) || includesLoose(text, term))) {
    highlightCells.value.add(toCellKey(row, col))
  }
}

function buildHighlightMap() {
  highlightCells.value.clear()
  const locateTerms = getLocateTerms()
  if (!locateTerms.length) return
  const data = currentData.value
  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < data[r].length; c++) {
      const cell = data[r][c]
      if (cell != null && locateTerms.some(term => includesLoose(String(cell), term))) {
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
  if (!props.fileId && !props.fileUrl) {
    sheetNames.value = []
    sheets.value = {}
    activeSheet.value = ''
    return
  }

  loading.value = true
  try {
    let rawData: ArrayBuffer
    if (props.fileUrl) {
      // 直接 URL 加载（Agent 等外部入口传入 blob/data URL）
      const resp = await fetch(props.fileUrl)
      rawData = await resp.arrayBuffer()
    } else {
      const res = await request.get(
        `/tasks/${props.taskId}/files/${props.fileId}/raw`,
        { responseType: 'arraybuffer' }
      )
      rawData = res.data as ArrayBuffer
    }
    const workbook = XLSX.read(new Uint8Array(rawData), { type: 'array' })
    sheetNames.value = workbook.SheetNames
    const parsed: Record<string, string[][]> = {}
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name]
      parsed[name] = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' })
    }
    sheets.value = parsed
    activeSheet.value = workbook.SheetNames[0] || ''
    if (props.locateTarget?.originalText) {
      buildHighlightMap()
      nextTick(() => {
        scrollToFirstHighlight()
        const found = highlightCells.value.size > 0
        emit('locateResult', {
          success: found,
          mode: found ? 'direct' : 'fallback',
          hint: found ? undefined : (props.locateTarget?.locateHint || '未能在表格单元格中精确匹配原文，请按提示页段信息辅助定位。'),
        })
      })
    }
  } catch (e) {
    console.error('[ExcelPreview] 加载文件失败:', e)
    sheetNames.value = []
    sheets.value = {}
    activeSheet.value = ''
  } finally {
    loading.value = false
  }
}

watch(() => [props.fileId, props.fileUrl], loadFile, { immediate: true })

watch(() => props.locateTarget, (target) => {
  buildHighlightMap()
  nextTick(() => {
    scrollToFirstHighlight()
    if (!target?.originalText?.trim()) return
    const found = highlightCells.value.size > 0
    emit('locateResult', {
      success: found,
      mode: found ? 'direct' : 'fallback',
      hint: found ? undefined : (target.locateHint || '未能在表格单元格中精确匹配原文，请按提示页段信息辅助定位。'),
    })
  })
})
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
  background: var(--color-gray-50);
  font-weight: 600;
  color: var(--color-gray-700);
  padding: 8px 12px;
  text-align: left;
  border-bottom: 2px solid var(--corp-border-light);
  border-right: 1px solid var(--corp-border-light);
  white-space: nowrap;
}

.excel-table td {
  padding: 6px 12px;
  border-bottom: 1px solid var(--bg-surface-active);
  border-right: 1px solid var(--bg-surface-active);
  color: var(--color-gray-600);
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.excel-table tbody tr:nth-child(even) {
  background: var(--color-gray-50);
}

.excel-table tbody tr:hover td {
  background: var(--color-info-bg); /* #f0f4ff 对齐 --color-info-bg */
}

.row-number-header,
.row-number {
  width: 40px;
  min-width: 40px;
  text-align: center;
  color: var(--color-gray-400);
  font-size: 12px;
  background: var(--color-gray-50);
  border-right: 2px solid var(--corp-border-light);
}

.cell-highlight {
  background: color-mix(in srgb, var(--color-danger) 15%, transparent) !important;
  outline: 2px solid var(--corp-danger);
  outline-offset: -2px;
  font-weight: 600;
  color: var(--color-danger-600);
}
</style>
