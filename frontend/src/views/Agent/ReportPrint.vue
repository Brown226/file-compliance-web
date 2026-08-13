<template>
  <div class="report-print-page">
    <!-- 工具栏（仅屏幕显示，打印时隐藏） -->
    <div class="toolbar no-print">
      <el-button type="primary" :icon="Printer" :loading="loading" @click="handlePrint">
        打印 / 另存为 PDF
      </el-button>
      <el-button :icon="Refresh" @click="loadReport">重新加载</el-button>
      <span v-if="errorMsg" class="error-text">{{ errorMsg }}</span>
    </div>

    <!-- 报告渲染区（A4 纵向） -->
    <div class="report-sheet">
      <div v-if="loading" class="loading-state">报告加载中…</div>
      <div v-else-if="errorMsg" class="error-state">{{ errorMsg }}</div>
      <div v-else class="markdown-content" v-html="renderedHtml"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Printer, Refresh } from '@element-plus/icons-vue'
import { useMarkdown } from '@/composables/useMarkdown'

const route = useRoute()
const { renderMarkdown } = useMarkdown()

const loading = ref(true)
const errorMsg = ref('')
const renderedHtml = ref('')

async function loadReport() {
  loading.value = true
  errorMsg.value = ''
  renderedHtml.value = ''
  try {
    const src = route.query.src as string | undefined
    if (!src) {
      errorMsg.value = '缺少报告 URL 参数（src）'
      return
    }
    // /uploads/agent_temp/** 已加 JWT 鉴权：token 由父页面经外层 query 传入（window.open 追加），
    // 这里取出并拼到 src 上，否则静态服务返回 401
    const token = new URLSearchParams(window.location.search).get('token')
    const fetchUrl = token ? `${src}${src.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : src
    const res = await fetch(fetchUrl)
    if (!res.ok) {
      throw new Error(`加载失败 (${res.status})`)
    }
    const text = await res.text()
    renderedHtml.value = renderMarkdown(text)
  } catch (e) {
    errorMsg.value = (e as Error).message || '加载报告失败'
  } finally {
    loading.value = false
  }
}

function handlePrint() {
  window.print()
}

onMounted(loadReport)
</script>

<style scoped>
.report-print-page {
  min-height: 100vh;
  background: var(--corp-border-light);
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.toolbar {
  width: 210mm;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.error-text {
  color: var(--color-danger-600);
  font-size: 13px;
}

.report-sheet {
  width: 210mm;
  min-height: 297mm;
  background: var(--bg-surface);
  padding: 20mm 18mm;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  font-family: "Microsoft YaHei", "PingFang SC", "SimSun", sans-serif;
  font-size: 12pt;
  line-height: 1.75;
  color: var(--color-gray-800);
}

.loading-state,
.error-state {
  text-align: center;
  padding: 80px 0;
  color: var(--corp-text-secondary);
}

/* Markdown 内容打印友好样式 */
.markdown-content :deep(h1) {
  font-size: 22pt;
  text-align: center;
  border-bottom: 2px solid var(--color-gray-800);
  padding-bottom: 10px;
  margin: 0 0 24px;
}

.markdown-content :deep(h2) {
  font-size: 16pt;
  margin-top: 28px;
  margin-bottom: 12px;
  border-left: 4px solid var(--color-gray-800);
  padding-left: 10px;
}

.markdown-content :deep(h3) {
  font-size: 13pt;
  margin-top: 20px;
  margin-bottom: 8px;
  color: var(--corp-text-primary);
}

.markdown-content :deep(p) {
  margin: 6px 0;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 6px 0;
  padding-left: 24px;
}

.markdown-content :deep(li) {
  margin: 3px 0;
}

.markdown-content :deep(pre) {
  background: var(--bg-body);
  padding: 8px 12px;
  border-radius: 4px;
  font-family: "Consolas", "Microsoft YaHei", monospace;
  font-size: 10.5pt;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 6px 0;
}

.markdown-content :deep(code) {
  font-family: "Consolas", monospace;
}

.markdown-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 10px 0;
  font-size: 11pt;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid var(--corp-border);
  padding: 6px 10px;
  text-align: left;
}

.markdown-content :deep(th) {
  background: var(--color-gray-100);
  font-weight: 600;
}

.markdown-content :deep(hr) {
  border: none;
  border-top: 1px solid var(--corp-border);
  margin: 16px 0;
}

.markdown-content :deep(blockquote) {
  border-left: 3px solid var(--corp-text-tertiary);
  padding-left: 12px;
  color: var(--color-gray-600);
  margin: 8px 0;
}

.markdown-content :deep(strong) {
  font-weight: 600;
}

/* ===== 打印样式 ===== */
@media print {
  .no-print {
    display: none !important;
  }

  .report-print-page {
    background: var(--bg-surface);
    padding: 0;
  }

  .report-sheet {
    width: auto;
    min-height: auto;
    box-shadow: none;
    padding: 0;
    margin: 0;
  }

  @page {
    size: A4 portrait;
    margin: 18mm 16mm;
  }
}
</style>
