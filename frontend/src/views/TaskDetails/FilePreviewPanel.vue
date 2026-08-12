<template>
  <div class="file-preview-panel">
    <!-- 根据文件类型路由到对应预览组件 -->
    <DocxPreviewPanel
      v-if="isDocx"
      :taskId="taskId"
      :fileId="fileId"
      :fileType="ext"
      :locateTarget="locateTarget"
      @locateResult="forwardLocateResult"
    />
    <PdfPreviewPanel
      v-else-if="isPdf"
      :taskId="taskId"
      :fileId="fileId"
      :locateTarget="locateTarget"
      @locateResult="forwardLocateResult"
    />
    <ExcelPreviewPanel
      v-else-if="isExcel"
      :taskId="taskId"
      :fileId="fileId"
      :locateTarget="locateTarget"
      @locateResult="forwardLocateResult"
    />
    <PptxPreviewPanel
      v-else-if="isPptx"
      :taskId="taskId"
      :fileId="fileId"
      :locateTarget="locateTarget"
      @locateResult="forwardLocateResult"
    />
    <!-- 通用文本预览（兜底） -->
    <TextPreviewPanel
      v-else
      :taskId="taskId"
      :fileId="fileId"
      :locateTarget="locateTarget"
      @locateResult="forwardLocateResult"
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
  locateTarget?: { originalText: string; locateCandidates?: string[]; textPosition?: any; locateMeta?: any; cadHandleId?: string; locateHint?: string; triggerId?: string } | null
}>()

const emit = defineEmits<{
  locateResult: [{ success: boolean; mode: 'direct' | 'fallback'; hint?: string }]
}>()

const forwardLocateResult = (payload: { success: boolean; mode: 'direct' | 'fallback'; hint?: string }) => {
  emit('locateResult', payload)
}

const ext = computed(() => {
  const ft = (props.fileType || '').toLowerCase()
  if (ft) return ft
  const name = props.fileName || ''
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.substring(dot + 1).toLowerCase() : ''
})

const isDocx = computed(() => ['docx', 'doc', 'docm'].includes(ext.value))
const isPdf = computed(() => ext.value === 'pdf')
const isExcel = computed(() => ['xlsx', 'xls', 'csv', 'xlsm', 'xlsb'].includes(ext.value))
const isPptx = computed(() => ['pptx', 'ppt', 'pptm', 'ppsx', 'ppsm'].includes(ext.value))
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
