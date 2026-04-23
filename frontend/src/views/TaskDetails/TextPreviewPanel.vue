<template>
  <div class="text-preview-panel">
    <div class="preview-header">
      <span class="preview-title">原文预览</span>
      <span class="preview-filename" v-if="fileName">{{ fileName }}</span>
      <div class="header-actions">
        <el-tooltip content="切换渲染模式" placement="bottom">
          <el-button
            :type="renderMode === 'rendered' ? 'primary' : 'default'"
            size="small"
            @click="toggleRenderMode"
            circle
          >
            <el-icon><MagicStick v-if="renderMode === 'source'" /><Document v-else /></el-icon>
          </el-button>
        </el-tooltip>
      </div>
    </div>

    <div v-if="loading" class="preview-loading">
      <el-icon class="is-loading" :size="24"><Loading /></el-icon>
      <span>正在加载文本内容...</span>
    </div>

    <div v-else-if="!extractedText" class="preview-empty">
      <el-icon :size="32" color="#94a3b8"><Document /></el-icon>
      <p>暂无文本内容可预览</p>
      <p class="empty-hint">请先选择一个文件查看原文</p>
    </div>

    <div v-else class="preview-content" ref="contentRef">
      <!-- 渲染模式：Markdown 格式化展示 -->
      <div
        v-show="renderMode === 'rendered'"
        class="markdown-body"
        ref="markdownRef"
        v-html="renderedHtml"
      />

      <!-- 源码模式：纯文本展示 -->
      <div
        v-show="renderMode === 'source'"
        class="source-body"
        ref="sourceRef"
      >
        <template v-for="(chunk, chunkIdx) in displayedChunks" :key="chunkIdx">
          <div
            :id="`chunk-${chunkIdx}`"
            class="text-chunk"
            :class="{ 'chunk-highlighted': activeChunkIndex === chunkIdx }"
          >
            <span class="chunk-index" v-if="displayedChunks.length > 1">{{ chunkIdx + 1 }}</span>
            <span
              v-for="(segment, segIdx) in chunk.segments"
              :key="segIdx"
              :class="['text-segment', { 'highlight-segment': segment.highlight }]"
              :id="segment.highlight ? `highlight-${chunkIdx}-${segIdx}` : undefined"
            >{{ segment.text }}</span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { Loading, Document, MagicStick } from '@element-plus/icons-vue'
import { getTaskFileContentApi } from '@/api/task'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

interface TextPosition {
  chunkIndex: number
  charOffset: number
  totalChunks: number
}

const props = defineProps<{
  taskId: string
  fileId: string | null
  /** 当前需要定位高亮的问题 */
  locateTarget?: {
    originalText: string
    textPosition: TextPosition | null
  } | null
}>()

const loading = ref(false)
const extractedText = ref<string | null>(null)
const fileName = ref('')
const fileType = ref('')
const contentRef = ref<HTMLElement | null>(null)
const markdownRef = ref<HTMLElement | null>(null)
const sourceRef = ref<HTMLElement | null>(null)
const activeChunkIndex = ref<number | null>(null)
const renderMode = ref<'rendered' | 'source'>('rendered')

let highlightTimer: ReturnType<typeof setTimeout> | null = null

// markdown-it 实例
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true,
  highlight: (str: string, lang: string): string => {
    // 代码高亮（简单实现）
    if (lang && hljs && hljs.getLanguage(lang)) {
      try {
        return `<pre class="code-block"><code class="hljs language-${lang}">${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`
      } catch (_) { /* ignore */ }
    }
    return `<pre class="code-block"><code class="hljs">${str.replace(/[&<>"']/g, (m: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m] || m))}</code></pre>`
  },
})

// 尝试加载 highlight.js（可选）
let hljs: any = null
try {
  hljs = (window as any).hljs
} catch (_) { /* ignore */ }

// LLM 分片大小，与后端 LlmService 保持一致
const CHUNK_SIZE = 4000

interface TextSegment {
  text: string
  highlight: boolean
}

interface TextChunk {
  segments: TextSegment[]
}

/**
 * 将文本转换为分片数据，同时在目标文本处插入高亮标记
 * 高亮通过在文本中插入 <mark> 标签实现，markdown-it 会保留 HTML
 */
const prepareHighlightedText = (text: string, searchText: string, _targetChunk?: number): string => {
  if (!searchText) return text

  const totalChunks = Math.ceil(text.length / CHUNK_SIZE) || 1
  const result: string[] = []
  let foundAny = false

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, text.length)
    const chunkText = text.substring(start, end)

    // 在当前分片中查找目标文本
    let lastEnd = 0
    let pos = chunkText.indexOf(searchText)

    if (pos !== -1) {
      foundAny = true

      // 逐个替换找到的文本
      while (pos !== -1) {
        if (pos > lastEnd) {
          result.push(chunkText.substring(lastEnd, pos))
        }
        result.push(`<mark class="md-highlight">${chunkText.substring(pos, pos + searchText.length)}</mark>`)
        lastEnd = pos + searchText.length
        pos = chunkText.indexOf(searchText, lastEnd)
      }

      // 剩余部分
      if (lastEnd < chunkText.length) {
        result.push(chunkText.substring(lastEnd))
      }
    } else {
      // 当前分片没有找到，直接添加
      result.push(chunkText)
    }
  }

  return foundAny ? result.join('') : text
}

/** Markdown 渲染后的 HTML */
const renderedHtml = computed(() => {
  const text = extractedText.value
  if (!text) return ''

  const searchText = props.locateTarget?.originalText || ''
  let processedText = text

  // 如果有定位目标，在文本中高亮标记
  if (searchText) {
    const targetChunk = props.locateTarget?.textPosition?.chunkIndex ?? -1
    processedText = prepareHighlightedText(text, searchText, targetChunk)
  }

  // 渲染 Markdown，保留 HTML 标记
  const html = md.render(processedText)
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['mark'],
    ADD_ATTR: ['class'],
  })
})

/** 源码模式的分片数据 */
const displayedChunks = computed<TextChunk[]>(() => {
  const text = extractedText.value
  if (!text) return []

  const totalChunks = Math.ceil(text.length / CHUNK_SIZE) || 1
  const chunks: TextChunk[] = []

  const searchText = props.locateTarget?.originalText || ''
  const targetChunk = props.locateTarget?.textPosition?.chunkIndex ?? -1

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, text.length)
    const chunkText = text.substring(start, end)
    const segments: TextSegment[] = []

    if (searchText) {
      // 优先使用 textPosition 精确定位
      if (i === targetChunk && props.locateTarget?.textPosition?.charOffset != null) {
        const offset = props.locateTarget.textPosition.charOffset
        const searchFrom = Math.max(0, offset - 50)
        const idx = chunkText.indexOf(searchText, searchFrom)
        if (idx !== -1) {
          if (idx > 0) segments.push({ text: chunkText.substring(0, idx), highlight: false })
          segments.push({ text: searchText, highlight: true })
          if (idx + searchText.length < chunkText.length) {
            segments.push({ text: chunkText.substring(idx + searchText.length), highlight: false })
          }
          chunks.push({ segments })
          continue
        }
      }

      // 回退：在当前分片中搜索
      let lastEnd = 0
      let found = false
      let pos = chunkText.indexOf(searchText)
      while (pos !== -1) {
        found = true
        if (pos > lastEnd) segments.push({ text: chunkText.substring(lastEnd, pos), highlight: false })
        segments.push({ text: searchText, highlight: true })
        lastEnd = pos + searchText.length
        pos = chunkText.indexOf(searchText, lastEnd)
      }
      if (found) {
        if (lastEnd < chunkText.length) segments.push({ text: chunkText.substring(lastEnd), highlight: false })
        chunks.push({ segments })
      } else {
        chunks.push({ segments: [{ text: chunkText, highlight: false }] })
      }
    } else {
      chunks.push({ segments: [{ text: chunkText, highlight: false }] })
    }
  }

  return chunks
})

/** 切换渲染模式 */
const toggleRenderMode = () => {
  renderMode.value = renderMode.value === 'rendered' ? 'source' : 'rendered'
  // 切换后重新滚动到高亮位置
  nextTick(() => scrollToHighlight())
}

// 滚动到高亮位置
const scrollToHighlight = () => {
  const chunkIdx = props.locateTarget?.textPosition?.chunkIndex ?? 0

  if (renderMode.value === 'rendered' && markdownRef.value) {
    // Markdown 渲染模式：查找 .md-highlight 元素
    const highlightEl = markdownRef.value.querySelector('.md-highlight')
    if (highlightEl) {
      highlightEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
  }

  if (renderMode.value === 'source' && sourceRef.value) {
    // 源码模式：查找 .highlight-segment 元素
    const highlightEl = document.getElementById(`highlight-${chunkIdx}-1`)
      || document.getElementById(`highlight-${chunkIdx}-0`)
      || sourceRef.value.querySelector('.highlight-segment')
    if (highlightEl) {
      highlightEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      activeChunkIndex.value = chunkIdx
    }
  }
}

// 监听 locateTarget 变化，滚动到高亮位置
watch(() => props.locateTarget, async (target) => {
  if (!target?.originalText) return

  await nextTick()
  scrollToHighlight()

  // 5秒后取消分片高亮（仅源码模式有效）
  if (highlightTimer) clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => {
    activeChunkIndex.value = null
  }, 5000)
}, { deep: true })

// 监听 fileId 变化，加载文本内容
watch(() => props.fileId, async (fileId) => {
  if (!fileId || !props.taskId) {
    extractedText.value = null
    return
  }

  loading.value = true
  try {
    const res = await getTaskFileContentApi(props.taskId, fileId)
    extractedText.value = res.data?.extractedText || null
    fileName.value = res.data?.fileName || ''
    fileType.value = res.data?.fileType || ''
  } catch (e) {
    console.error('[TextPreview] 加载文件内容失败:', e)
    extractedText.value = null
  } finally {
    loading.value = false
  }
}, { immediate: true })

onUnmounted(() => {
  if (highlightTimer) clearTimeout(highlightTimer)
})
</script>

<style scoped>
.text-preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: var(--corp-bg-panel);
  overflow: hidden;
  min-width: 0;
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

.header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
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

.preview-content {
  flex: 1;
  overflow-y: auto;
}

/* ===== Markdown 渲染样式 ===== */
.markdown-body {
  padding: 24px 28px;
  font-size: 14.5px;
  line-height: 1.85;
  color: #374151;
  max-width: 900px;
}

/* 标题层级 */
.markdown-body :deep(h1) {
  font-size: 1.85em;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 16px 0;
  padding-bottom: 10px;
  border-bottom: 2px solid #e5e7eb;
  line-height: 1.3;
}

.markdown-body :deep(h2) {
  font-size: 1.5em;
  font-weight: 650;
  color: #1f2937;
  margin: 28px 0 12px 0;
  padding-bottom: 8px;
  border-bottom: 1px solid #e5e7eb;
  line-height: 1.35;
}

.markdown-body :deep(h3) {
  font-size: 1.2em;
  font-weight: 600;
  color: #374151;
  margin: 20px 0 10px 0;
}

.markdown-body :deep(h4) {
  font-size: 1.05em;
  font-weight: 600;
  color: #4b5563;
  margin: 16px 0 8px 0;
}

.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  font-size: 0.95em;
  font-weight: 600;
  color: #6b7280;
  margin: 12px 0 6px 0;
}

/* 段落 */
.markdown-body :deep(p) {
  margin: 0 0 14px 0;
  line-height: 1.85;
}

/* 列表 - 优雅样式 */
.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 8px 0 14px 0;
  padding-left: 1.6em;
}

.markdown-body :deep(li) {
  margin: 6px 0;
  line-height: 1.75;
  position: relative;
}

.markdown-body :deep(ul > li) {
  list-style: none;
}

.markdown-body :deep(ul > li::before) {
  content: '';
  position: absolute;
  left: -1.2em;
  top: 0.7em;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--corp-primary);
  opacity: 0.7;
}

.markdown-body :deep(ol) {
  counter-reset: list-counter;
  list-style: none;
  padding-left: 1.8em;
}

.markdown-body :deep(ol > li) {
  counter-increment: list-counter;
}

.markdown-body :deep(ol > li::before) {
  content: counter(list-counter);
  position: absolute;
  left: -1.8em;
  width: 18px;
  height: 18px;
  background: var(--corp-primary);
  color: #fff;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  line-height: 18px;
}

.markdown-body :deep(li > ul),
.markdown-body :deep(li > ol) {
  margin: 4px 0;
}

/* 代码块 - 深色主题 */
.markdown-body :deep(pre),
.markdown-body :deep(.code-block) {
  background: #1e1e2e;
  border-radius: 10px;
  padding: 16px 18px;
  margin: 14px 0;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.65;
  border: 1px solid #2d2d3f;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.markdown-body :deep(code) {
  font-family: 'JetBrains Mono', 'Fira Code', 'Menlo', 'Consolas', 'Courier New', monospace;
  font-size: 0.9em;
}

/* 行内代码 */
.markdown-body :deep(p code),
.markdown-body :deep(li code) {
  background: #f3f4f6;
  color: #be123c;
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 0.88em;
  border: 1px solid #e5e7eb;
}

/* 表格 - 现代卡片风格 */
.markdown-body :deep(table) {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  margin: 16px 0;
  font-size: 13.5px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.markdown-body :deep(th) {
  background: #f9fafb;
  font-weight: 650;
  color: #374151;
  padding: 12px 16px;
  text-align: left;
  border-bottom: 2px solid #e5e7eb;
  font-size: 13px;
}

.markdown-body :deep(td) {
  padding: 11px 16px;
  border-bottom: 1px solid #f3f4f6;
  color: #4b5563;
}

.markdown-body :deep(tr:last-child td) {
  border-bottom: none;
}

.markdown-body :deep(tr:hover td) {
  background: #fafafa;
}

.markdown-body :deep(th:first-child) { border-radius: 10px 0 0 0; }
.markdown-body :deep(th:last-child) { border-radius: 0 10px 0 0; }

/* 引用块 - 优雅渐变边框 */
.markdown-body :deep(blockquote) {
  margin: 14px 0;
  padding: 14px 18px;
  border-left: 4px solid;
  border-image: linear-gradient(180deg, var(--corp-primary) 0%, #818cf8 100%) 1;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  color: #64748b;
  border-radius: 0 10px 10px 0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.markdown-body :deep(blockquote p) {
  margin: 0;
  line-height: 1.7;
  font-style: italic;
}

.markdown-body :deep(blockquote p + p) {
  margin-top: 8px;
}

/* 分隔线 */
.markdown-body :deep(hr) {
  border: none;
  height: 1px;
  background: linear-gradient(90deg, transparent, #e5e7eb 20%, #e5e7eb 80%, transparent);
  margin: 24px 0;
}

/* 链接 */
.markdown-body :deep(a) {
  color: var(--corp-primary);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color 0.2s ease;
}

.markdown-body :deep(a:hover) {
  border-bottom-color: var(--corp-primary);
}

/* 图片 */
.markdown-body :deep(img) {
  max-width: 100%;
  border-radius: 10px;
  margin: 12px 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

/* 高亮标记 */
.markdown-body :deep(.md-highlight) {
  background: linear-gradient(120deg, rgba(239, 68, 68, 0.15) 0%, rgba(239, 68, 68, 0.25) 100%);
  color: #dc2626;
  border-bottom: 2px solid #ef4444;
  padding: 1px 3px;
  border-radius: 4px;
  font-weight: 600;
  animation: md-highlight-pulse 1.5s ease-in-out;
}

@keyframes md-highlight-pulse {
  0% { background: rgba(239, 68, 68, 0.1); transform: scale(1); }
  50% { background: rgba(239, 68, 68, 0.35); transform: scale(1.01); }
  100% { background: rgba(239, 68, 68, 0.15); transform: scale(1); }
}

/* ===== 源码模式样式 ===== */
.source-body {
  padding: 20px 24px;
  font-family: 'JetBrains Mono', 'Fira Code', 'Menlo', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.8;
  color: #4b5563;
  white-space: pre-wrap;
  word-break: break-all;
  background: #fafbfc;
}

.text-chunk {
  position: relative;
  padding: 12px 16px;
  margin-bottom: 10px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  background: #fff;
  transition: all 0.3s ease;
}

.text-chunk + .text-chunk {
  border-top: 1px dashed #e5e7eb;
  margin-top: 10px;
}

.chunk-index {
  position: absolute;
  top: 6px;
  right: 10px;
  font-size: 10px;
  color: #9ca3af;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.chunk-highlighted {
  background-color: #eff6ff;
  border-color: #bfdbfe;
  box-shadow: 0 1px 4px rgba(59, 130, 246, 0.1);
}

.highlight-segment {
  background: linear-gradient(120deg, rgba(239, 68, 68, 0.15) 0%, rgba(239, 68, 68, 0.25) 100%);
  color: #dc2626;
  border-bottom: 2px solid #ef4444;
  padding: 1px 3px;
  border-radius: 4px;
  font-weight: 600;
  animation: highlight-pulse 1.5s ease-in-out;
}

@keyframes highlight-pulse {
  0% { background: rgba(239, 68, 68, 0.1); }
  50% { background: rgba(239, 68, 68, 0.35); }
  100% { background: rgba(239, 68, 68, 0.15); }
}
</style>
