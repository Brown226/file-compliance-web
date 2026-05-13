<template>
  <div class="file-preview-panel">
    <!-- 根据文件类型路由到对应预览组件 -->
    <DocxPreviewPanel
      v-if="isDocx"
      :taskId="taskId"
      :fileId="fileId"
      :locateTarget="locateTarget"
    />
    <PdfPreviewPanel
      v-else-if="isPdf"
      :taskId="taskId"
      :fileId="fileId"
      :locateTarget="locateTarget"
    />
    <ExcelPreviewPanel
      v-else-if="isExcel"
      :taskId="taskId"
      :fileId="fileId"
      :locateTarget="locateTarget"
    />
    <PptxPreviewPanel
      v-else-if="isPptx"
      :taskId="taskId"
      :fileId="fileId"
      :locateTarget="locateTarget"
    />
    <!-- 通用文本预览（兜底） -->
    <TextPreviewPanel
      v-else
      :taskId="taskId"
      :fileId="fileId"
      :locateTarget="locateTarget"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import DocxPreviewPanel from './DocxPreviewPanel.vue'
import PdfPreviewPanel from './PdfPreviewPanel.vue'
import ExcelPreviewPanel from './ExcelPreviewPanel.vue'
import PptxPreviewPanel from './PptxPreviewPanel.vue'
import TextPreviewPanel from './TextPreviewPanel.vue'

const props = defineProps<{
  taskId: string
  fileId: string | null
  fileType?: string
  fileName?: string
  locateTarget?: { originalText: string; textPosition?: any; cadHandleId?: string } | null
}>()

const ext = computed(() => {
  const ft = (props.fileType || '').toLowerCase()
  if (ft) return ft
  const name = props.fileName || ''
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.substring(dot + 1).toLowerCase() : ''
})

const isDocx = computed(() => ['docx', 'doc'].includes(ext.value))
const isPdf = computed(() => ext.value === 'pdf')
const isExcel = computed(() => ['xlsx', 'xls', 'csv'].includes(ext.value))
const isPptx = computed(() => ['pptx', 'ppt'].includes(ext.value))
</script>

<style scoped>
.file-preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  height: 100%;
}
</style>
