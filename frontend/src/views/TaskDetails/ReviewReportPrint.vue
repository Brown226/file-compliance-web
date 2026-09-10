<template>
  <div class="report-print-page">
    <!-- 工具栏（仅屏幕显示，打印时隐藏） -->
    <div class="toolbar no-print">
      <el-button type="primary" :icon="Printer" @click="handlePrint">打印 / 另存为 PDF</el-button>
      <el-button :icon="Refresh" @click="loadReport">重新加载</el-button>
      <el-button :icon="Back" @click="closeWindow">关闭</el-button>
      <span v-if="errorMsg" class="error-text">{{ errorMsg }}</span>
    </div>

    <!-- 报告纸张（A4） -->
    <div class="report-sheet">
      <div v-if="!markdown && !errorMsg" class="loading-state">报告加载中…</div>
      <div v-else-if="errorMsg" class="error-state">{{ errorMsg }}</div>
      <div v-else class="markdown-content" v-html="renderedHtml"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 审查报告打印视图（「审查摘要」→ 导出 PDF）
 *
 * 独立路由页（不在主布局内），A4 排版 + @media print 控制分页与边距，
 * 用户点「打印」后在浏览器对话框选择「另存为 PDF」即可得到 PDF 报告。
 *
 * 内容传递：优先读 sessionStorage（报告可能很长，URL 参数会超限），
 * 取不到时回落调用后端接口重新生成。
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Printer, Refresh, Back } from '@element-plus/icons-vue'
import { useMarkdown } from '@/composables/useMarkdown'
import { regenerateTaskReportApi } from '@/api/task'

const route = useRoute()
const { renderMarkdown } = useMarkdown()

const markdown = ref('')
const errorMsg = ref('')
const renderedHtml = computed(() => renderMarkdown(markdown.value))

async function loadReport() {
  errorMsg.value = ''
  const taskId = (route.query.taskId as string) || ''
  if (!taskId) {
    errorMsg.value = '缺少 taskId 参数'
    return
  }
  // 1) 优先从 sessionStorage 取（由 ReviewReportPanel 写入，避免长文本走 URL）
  try {
    const cached = sessionStorage.getItem(`review-report:${taskId}`)
    if (cached) {
      markdown.value = cached
      return
    }
  } catch {
    /* sessionStorage 不可用则继续走后端 */
  }
  // 2) 回落：向后端取任务详情里的报告
  try {
    const res: any = await regenerateTaskReportApi(taskId)
    const md = res?.data?.reportMarkdown || ''
    if (!md) {
      errorMsg.value = '该任务暂无报告内容'
      return
    }
    markdown.value = md
  } catch (e: any) {
    errorMsg.value = '加载报告失败：' + (e?.message || e)
  }
}

function handlePrint() {
  window.print()
}

function closeWindow() {
  window.close()
}

onMounted(loadReport)
</script>

<style scoped>
.report-print-page {
  min-height: 100vh;
  background: #eef1f5;
  padding: 20px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.toolbar {
  width: 210mm;
  max-width: 100%;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.error-text { color: #dc2626; font-size: 13px; }

/* A4 纸张 */
.report-sheet {
  width: 210mm;
  max-width: 100%;
  min-height: 297mm;
  background: #fff;
  padding: 20mm 18mm;
  box-sizing: border-box;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
}
.loading-state, .error-state {
  padding: 60px 0; text-align: center; color: #6b7280; font-size: 14px;
}
.error-state { color: #dc2626; }

/* ---- 报告正文排版（含打印） ---- */
.markdown-content { font-size: 14px; line-height: 1.85; color: #1f2937; word-break: break-word; }
.markdown-content :deep(h1) {
  font-size: 22px; text-align: center; margin: 0 0 20px; font-weight: 700;
  padding-bottom: 12px; border-bottom: 2px solid #1f2937;
}
.markdown-content :deep(h2) {
  font-size: 17px; margin: 22px 0 10px; font-weight: 600;
  padding-left: 10px; border-left: 4px solid #2563eb;
}
.markdown-content :deep(h3) { font-size: 15px; margin: 16px 0 8px; font-weight: 600; }
.markdown-content :deep(p) { margin: 8px 0; }
.markdown-content :deep(ul), .markdown-content :deep(ol) { margin: 8px 0; padding-left: 24px; }
.markdown-content :deep(li) { margin: 4px 0; }
.markdown-content :deep(table) { border-collapse: collapse; margin: 12px 0; width: 100%; font-size: 13px; }
.markdown-content :deep(th), .markdown-content :deep(td) {
  border: 1px solid #9ca3af; padding: 6px 10px; text-align: left;
}
.markdown-content :deep(th) { background: #f3f4f6; font-weight: 600; }
.markdown-content :deep(blockquote) {
  margin: 10px 0; padding: 8px 12px; border-left: 3px solid #2563eb; background: #f9fafb; color: #4b5563;
}
.markdown-content :deep(code) {
  background: #f3f4f6; padding: 1px 5px; border-radius: 3px; font-size: 12px;
  font-family: Consolas, monospace;
}
.markdown-content :deep(pre) {
  background: #f6f8fa; padding: 10px; border-radius: 5px; border: 1px solid #e5e7eb;
  overflow-x: auto; page-break-inside: avoid;
}
.markdown-content :deep(pre code) { background: none; padding: 0; }
.markdown-content :deep(hr) { border: none; border-top: 1px solid #d1d5db; margin: 16px 0; }

/* ---- 打印样式：A4 纵向、隐藏工具栏、避免标题/表格被分页切断 ---- */
@media print {
  .no-print { display: none !important; }
  .report-print-page {
    background: #fff; padding: 0; display: block;
  }
  .report-sheet {
    width: auto; min-height: 0; padding: 0; box-shadow: none; margin: 0;
  }
  .markdown-content { font-size: 12pt; }
  .markdown-content :deep(h1),
  .markdown-content :deep(h2),
  .markdown-content :deep(h3) { page-break-after: avoid; }
  .markdown-content :deep(table),
  .markdown-content :deep(pre),
  .markdown-content :deep(blockquote) { page-break-inside: avoid; }
  @page { size: A4 portrait; margin: 18mm 16mm; }
}
</style>
