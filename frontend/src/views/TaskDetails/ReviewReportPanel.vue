<template>
  <div class="review-report-panel">
    <!-- 工具栏 -->
    <div class="report-toolbar">
      <div class="toolbar-left">
        <el-icon :size="16"><DocumentIcon /></el-icon>
        <span class="toolbar-title">审查报告</span>
        <el-tag v-if="isFallback" size="small" type="info" effect="plain" round>统计拼装版</el-tag>
        <el-tag v-else size="small" type="success" effect="plain" round>AI 生成</el-tag>
      </div>
      <div class="toolbar-right">
        <el-button size="small" :icon="Printer" :loading="printing" @click="openPrintView">
          导出 PDF
        </el-button>
        <el-button size="small" :icon="CopyDocument" @click="copyMarkdown">复制 Markdown</el-button>
        <el-button size="small" :icon="Refresh" :loading="regenerating" @click="regenerate">
          重新生成
        </el-button>
      </div>
    </div>

    <!-- 报告正文 -->
    <div class="report-body">
      <div v-if="!markdown" class="report-empty">
        <el-empty description="该任务暂无审查报告">
          <el-button type="primary" :loading="regenerating" @click="regenerate">
            立即生成报告
          </el-button>
        </el-empty>
      </div>
      <div v-else class="markdown-body report-markdown" v-html="renderedHtml"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 审查报告面板（「审查摘要」页主体）
 *
 * 取代原先的统计卡片聚合视图 —— 用户反馈「审查摘要没什么用」。
 * 直接呈现 AI 撰写的 Markdown 审查报告（AI 不可用时回落统计拼装版），
 * 并提供一键导出 PDF（打印视图）与重新生成。
 */
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Printer, Refresh, CopyDocument, Document as DocumentIcon } from '@element-plus/icons-vue'
import { useMarkdown } from '@/composables/useMarkdown'
import { regenerateTaskReportApi } from '@/api/task'

const props = defineProps<{
  taskId: string
  reportMarkdown?: string | null
}>()

const emit = defineEmits<{ 'update:reportMarkdown': [value: string] }>()

const { renderMarkdown } = useMarkdown()
const printing = ref(false)
const regenerating = ref(false)

/** 本地副本：重新生成后立即刷新，无需等父组件回传 */
const localMarkdown = ref(props.reportMarkdown || '')

const markdown = computed(() => localMarkdown.value || props.reportMarkdown || '')
const renderedHtml = computed(() => renderMarkdown(markdown.value))

/**
 * 粗略判断是否为「统计拼装版」：拼装版由 review-report.builder 生成，
 * 有固定的一级标题「# 文件合规审查报告」与「## 二、问题摘要」编号结构。
 * 仅用于展示来源标签，判错无副作用。
 */
const isFallback = computed(() =>
  /^#\s+文件合规审查报告[\s\S]*##\s*二、问题摘要/.test(markdown.value.trim()),
)

async function regenerate() {
  if (regenerating.value) return
  regenerating.value = true
  try {
    const res: any = await regenerateTaskReportApi(props.taskId)
    const md = res?.data?.reportMarkdown || ''
    if (md) {
      localMarkdown.value = md
      emit('update:reportMarkdown', md)
      ElMessage.success('报告已重新生成')
    } else {
      ElMessage.warning('报告生成为空，请稍后重试')
    }
  } catch (e: any) {
    ElMessage.error('生成报告失败：' + (e?.message || e))
  } finally {
    regenerating.value = false
  }
}

async function copyMarkdown() {
  try {
    await navigator.clipboard.writeText(markdown.value)
    ElMessage.success('已复制 Markdown 原文')
  } catch {
    ElMessage.error('复制失败，请手动选择复制')
  }
}

/**
 * 导出 PDF：打开打印视图（新窗口 → A4 排版 → 浏览器「另存为 PDF」）。
 * 采用打印方案而非前端 PDF 库：无需新增依赖、中文排版由浏览器保证、
 * 分页/页眉页脚可用 @media print 精细控制。
 */
function openPrintView() {
  if (!markdown.value) {
    ElMessage.warning('暂无可导出的报告内容')
    return
  }
  printing.value = true
  // 报告正文可能较大，用 sessionStorage 传递避免 URL 长度限制（URL 参数方案会超限）
  try {
    sessionStorage.setItem(`review-report:${props.taskId}`, markdown.value)
  } catch {
    // sessionStorage 不可用（隐私模式/超限）时回落 URL 参数方案由打印页处理
  }
  const url = `/review-report/print?taskId=${encodeURIComponent(props.taskId)}`
  const win = window.open(url, '_blank')
  if (!win) ElMessage.warning('打印窗口被浏览器拦截，请允许弹出窗口后重试')
  printing.value = false
}
</script>

<style scoped>
.review-report-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-panel, #fff);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 8px;
  overflow: hidden;
}
.report-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border, #e5e7eb);
  background: var(--bg-panel, #fafafa);
  flex-wrap: wrap;
}
.toolbar-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.toolbar-title { font-size: 14px; font-weight: 600; color: var(--text, #1f2937); }
.toolbar-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.report-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px;
}
.report-empty { padding: 40px 0; }

/* 报告正文排版（markdown-it 输出，需自备基础样式） */
.report-markdown { font-size: 14px; line-height: 1.8; color: var(--text, #1f2937); word-break: break-word; }
.report-markdown :deep(h1) {
  font-size: 22px; margin: 0 0 16px; font-weight: 700;
  padding-bottom: 10px; border-bottom: 2px solid var(--border, #e5e7eb);
}
.report-markdown :deep(h2) {
  font-size: 18px; margin: 24px 0 12px; font-weight: 600;
  padding-left: 10px; border-left: 3px solid var(--accent, #2563eb);
}
.report-markdown :deep(h3) { font-size: 15px; margin: 18px 0 8px; font-weight: 600; }
.report-markdown :deep(h4) { font-size: 14px; margin: 14px 0 6px; font-weight: 600; }
.report-markdown :deep(p) { margin: 8px 0; }
.report-markdown :deep(ul), .report-markdown :deep(ol) { margin: 8px 0; padding-left: 24px; }
.report-markdown :deep(li) { margin: 4px 0; }
.report-markdown :deep(table) {
  border-collapse: collapse; margin: 12px 0; width: 100%; font-size: 13px;
}
.report-markdown :deep(th), .report-markdown :deep(td) {
  border: 1px solid var(--border, #e5e7eb); padding: 7px 10px; text-align: left;
}
.report-markdown :deep(th) { background: var(--bg-selected, #f3f4f6); font-weight: 600; }
.report-markdown :deep(blockquote) {
  margin: 10px 0; padding: 8px 12px; border-left: 3px solid var(--accent, #2563eb);
  background: var(--bg-hover, #f9fafb); color: var(--text-muted, #4b5563);
}
.report-markdown :deep(code) {
  background: var(--bg-selected, #f3f4f6); padding: 1px 5px; border-radius: 3px;
  font-size: 12px; font-family: var(--font-mono, Consolas, monospace);
}
.report-markdown :deep(pre) {
  background: var(--bg-selected, #f6f8fa); padding: 12px; border-radius: 6px;
  overflow-x: auto; border: 1px solid var(--border, #e5e7eb);
}
.report-markdown :deep(pre code) { background: none; padding: 0; }
.report-markdown :deep(hr) { border: none; border-top: 1px solid var(--border, #e5e7eb); margin: 18px 0; }
</style>
