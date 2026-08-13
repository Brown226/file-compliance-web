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
      <el-icon :size="32" color="var(--color-gray-400)"><Document /></el-icon>
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

interface LocateMeta {
  version: 2
  mode: 'text' | 'dwg'
  confidence: 'exact' | 'trimmed' | 'normalized' | 'fallback'
  absolute?: { start: number; end: number }
  quote?: { text: string; normalizedText?: string }
  context?: { prefix: string; suffix: string }
  chunk?: { index: number; start: number; end: number; total: number }
  hint?: { fileId?: string; pageHint?: number; lineHint?: number; cadHandleId?: string }
}

const props = defineProps<{
  taskId: string
  fileId: string | null
  locateTarget?: { originalText: string; locateCandidates?: string[]; textPosition?: TextPosition | null; locateMeta?: LocateMeta | null; cadHandleId?: string; locateHint?: string } | null
}>()

const emit = defineEmits<{
  locateResult: [{ success: boolean; mode: 'direct' | 'fallback'; hint?: string }]
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

interface LocateRange {
  start: number
  end: number
  mode: 'absolute' | 'quote' | 'context' | 'fuzzy'
}

const getLocateTerms = (): string[] => {
  const target = props.locateTarget
  if (!target) return []
  const list = Array.isArray(target.locateCandidates) ? target.locateCandidates : []
  const terms = [...list, target.originalText]
    .map(s => String(s || '').trim())
    .filter(Boolean)
  return [...new Set(terms)]
}

const getPrimaryLocateTerm = (): string => getLocateTerms()[0] || ''

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

const resolveLocateRange = (text: string, target?: { originalText: string; locateCandidates?: string[]; locateMeta?: LocateMeta | null } | null): LocateRange | null => {
  if (!text || !target) return null

  const absolute = target.locateMeta?.absolute
  if (
    absolute
    && Number.isFinite(absolute.start)
    && Number.isFinite(absolute.end)
    && absolute.start >= 0
    && absolute.end > absolute.start
    && absolute.end <= text.length
  ) {
    return { start: absolute.start, end: absolute.end, mode: 'absolute' }
  }

  const quote = target.locateMeta?.quote?.text?.trim()
  if (quote) {
    const idx = text.indexOf(quote)
    if (idx !== -1) return { start: idx, end: idx + quote.length, mode: 'quote' }

    const prefix = target.locateMeta?.context?.prefix || ''
    const suffix = target.locateMeta?.context?.suffix || ''
    let bestStart = -1
    let bestScore = -1
    let from = 0
    while (true) {
      const hit = text.indexOf(quote, from)
      if (hit === -1) break
      const left = text.slice(Math.max(0, hit - prefix.length), hit)
      const right = text.slice(hit + quote.length, Math.min(text.length, hit + quote.length + suffix.length))
      const score = (prefix && left.endsWith(prefix) ? 1 : 0) + (suffix && right.startsWith(suffix) ? 1 : 0)
      if (score > bestScore) {
        bestScore = score
        bestStart = hit
      }
      from = hit + 1
    }
    if (bestStart !== -1) return { start: bestStart, end: bestStart + quote.length, mode: 'context' }
  }

  const locateTerms = [...(target.locateCandidates || []), target.originalText].filter(Boolean)
  for (const term of locateTerms) {
    const idx = text.indexOf(term)
    if (idx !== -1) return { start: idx, end: idx + term.length, mode: 'fuzzy' }
  }

  return null
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

/** Markdown 渲染后的 HTML（不依赖 locateTarget，避免每次定位触发全文 markdown 重渲染） */
const renderedHtml = computed(() => {
  const text = extractedText.value
  if (!text) return ''

  const html = md.render(text)
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

  const locateTerms = getLocateTerms()
  const searchText = getPrimaryLocateTerm()
  const targetChunk = props.locateTarget?.textPosition?.chunkIndex ?? -1
  const locateRange = resolveLocateRange(text, props.locateTarget)

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, text.length)
    const chunkText = text.substring(start, end)
    const segments: TextSegment[] = []

    if (locateRange) {
      const overlapStart = Math.max(start, locateRange.start)
      const overlapEnd = Math.min(end, locateRange.end)
      if (overlapStart < overlapEnd) {
        const localStart = overlapStart - start
        const localEnd = overlapEnd - start
        if (localStart > 0) segments.push({ text: chunkText.substring(0, localStart), highlight: false })
        segments.push({ text: chunkText.substring(localStart, localEnd), highlight: true })
        if (localEnd < chunkText.length) segments.push({ text: chunkText.substring(localEnd), highlight: false })
        chunks.push({ segments })
        continue
      }
    }

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

        // 精确匹配失败时，基于 charOffset 做锚点高亮，避免静默失败
        const anchorLen = Math.max(20, Math.min(searchText.length || 20, 80))
        const anchorStart = Math.max(0, Math.min(offset, Math.max(0, chunkText.length - 1)))
        const anchorEnd = Math.min(chunkText.length, anchorStart + anchorLen)
        if (anchorStart > 0) segments.push({ text: chunkText.substring(0, anchorStart), highlight: false })
        segments.push({ text: chunkText.substring(anchorStart, anchorEnd), highlight: true })
        if (anchorEnd < chunkText.length) segments.push({ text: chunkText.substring(anchorEnd), highlight: false })
        chunks.push({ segments })
        continue
      }

      // 回退：在当前分片中搜索（支持多候选词 + 宽松匹配）
      let lastEnd = 0
      let found = false
      let hitTerm = ''
      let hitPos = -1

      for (const term of locateTerms) {
        const pos = chunkText.indexOf(term)
        if (pos !== -1) {
          hitTerm = term
          hitPos = pos
          break
        }
      }

      if (hitPos !== -1 && hitTerm) {
        found = true
        let pos = hitPos
        while (pos !== -1) {
          if (pos > lastEnd) segments.push({ text: chunkText.substring(lastEnd, pos), highlight: false })
          segments.push({ text: hitTerm, highlight: true })
          lastEnd = pos + hitTerm.length
          pos = chunkText.indexOf(hitTerm, lastEnd)
        }
      }

      if (!found) {
        for (const term of locateTerms) {
          if (includesLoose(chunkText, term)) {
            found = true
            break
          }
        }
      }
      if (!found && searchText && includesLoose(chunkText, searchText)) {
        found = true
      }
      if (found) {
        if (lastEnd < chunkText.length && lastEnd > 0) {
          segments.push({ text: chunkText.substring(lastEnd), highlight: false })
        }
        if (lastEnd === 0) {
          segments.push({ text: chunkText, highlight: true })
        }
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

/** 在渲染后的 DOM 中查找并高亮定位目标文本（避免全文 markdown 重渲染） */
const applyHighlightToRendered = (): boolean => {
  if (!props.locateTarget || !markdownRef.value) return false

  // 清除旧高亮
  markdownRef.value.querySelectorAll('.md-highlight').forEach(el => {
    const parent = el.parentNode
    if (parent) {
      parent.replaceChild(document.createTextNode(el.textContent || ''), el)
      parent.normalize()
    }
  })

  const locateTerms = getLocateTerms()
  const searchText = getPrimaryLocateTerm()
  if (!searchText && !locateTerms.length) return false

  const walker = document.createTreeWalker(markdownRef.value, NodeFilter.SHOW_TEXT)
  let found = false
  while (walker.nextNode()) {
    const node = walker.currentNode as Text

    let hitTerm = ''
    let idx = -1
    for (const term of locateTerms) {
      const i = node.data.indexOf(term)
      if (i !== -1) {
        hitTerm = term
        idx = i
        break
      }
    }

    if (idx !== -1 && hitTerm) {
      const range = document.createRange()
      range.setStart(node, idx)
      range.setEnd(node, idx + hitTerm.length)
      const mark = document.createElement('mark')
      mark.className = 'md-highlight'
      range.surroundContents(mark)

      if (!found) {
        requestAnimationFrame(() => {
          mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
        })
        found = true
      }
      continue
    }

    if (!found && locateTerms.some(term => includesLoose(node.data, term)) && node.data.trim()) {
      const range = document.createRange()
      range.setStart(node, 0)
      range.setEnd(node, node.data.length)
      const mark = document.createElement('mark')
      mark.className = 'md-highlight'
      range.surroundContents(mark)
      requestAnimationFrame(() => {
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
      found = true
    }
  }

  if (!found && (props.locateTarget?.locateMeta?.absolute || props.locateTarget?.textPosition?.chunkIndex != null)) {
    // 渲染模式无法精确命中时，回退到源码模式做分片锚点高亮
    renderMode.value = 'source'
    requestAnimationFrame(() => {
      scrollToHighlight()
    })
    return true
  }

  return found
}

/** 切换渲染模式 */
const toggleRenderMode = () => {
  renderMode.value = renderMode.value === 'rendered' ? 'source' : 'rendered'
  // 切换后重新滚动到高亮位置
  nextTick(() => scrollToHighlight())
}

// 滚动到高亮位置
const scrollToHighlight = (): boolean => {
  if (renderMode.value === 'rendered' && markdownRef.value) {
    // Markdown 渲染模式：用 DOM 操作插入高亮并滚动
    const found = applyHighlightToRendered()
    return found
  }

  const chunkIdx = props.locateTarget?.locateMeta?.chunk?.index ?? props.locateTarget?.textPosition?.chunkIndex ?? 0
  if (renderMode.value === 'source' && sourceRef.value) {
    // 源码模式：查找 .highlight-segment 元素
    const highlightEl = document.getElementById(`highlight-${chunkIdx}-1`)
      || document.getElementById(`highlight-${chunkIdx}-0`)
      || sourceRef.value.querySelector('.highlight-segment')
    if (highlightEl) {
      highlightEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      activeChunkIndex.value = chunkIdx
      return true
    }
  }

  return false
}

// 监听 locateTarget 变化，滚动到高亮位置
watch(() => props.locateTarget, async (target) => {
  if (!target) return

  // 如果文本尚未加载，跳过 — fileId watch 会在加载完成后重试
  if (!extractedText.value) return

  await nextTick()
  const found = scrollToHighlight()
  emit('locateResult', {
    success: found,
    mode: found ? 'direct' : 'fallback',
    hint: found ? undefined : (target.locateHint || '未能在文本预览中精确匹配原文，请按提示页段信息辅助定位。'),
  })

  // 5秒后取消分片高亮（仅源码模式有效）
  if (highlightTimer) clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => {
    activeChunkIndex.value = null
  }, 5000)
})

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
    // 内容加载完成后，检查是否有待定位的原文
    // 必须 emit 结果，因为 locateTarget watch 可能在文本加载前就被触发了
    await nextTick()
    if (props.locateTarget) {
      const found = scrollToHighlight()
      emit('locateResult', {
        success: found,
        mode: found ? 'direct' : 'fallback',
        hint: found ? undefined : (props.locateTarget.locateHint || '未能在文本预览中精确匹配原文，请按提示页段信息辅助定位。'),
      })
    }
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
  overflow: auto;
}

/* ===== Markdown 渲染样式 ===== */
.markdown-body {
  padding: 24px 28px;
  font-size: 14.5px;
  line-height: 1.85;
  color: var(--color-gray-700);
  max-width: 900px;
}

/* 标题层级 */
.markdown-body :deep(h1) {
  font-size: 1.85em;
  font-weight: 700;
  color: var(--color-gray-800);
  margin: 0 0 16px 0;
  padding-bottom: 10px;
  border-bottom: 2px solid var(--corp-border-light);
  line-height: 1.3;
}

.markdown-body :deep(h2) {
  font-size: 1.5em;
  font-weight: 650;
  color: var(--color-gray-800);
  margin: 28px 0 12px 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--corp-border-light);
  line-height: 1.35;
}

.markdown-body :deep(h3) {
  font-size: 1.2em;
  font-weight: 600;
  color: var(--color-gray-700);
  margin: 20px 0 10px 0;
}

.markdown-body :deep(h4) {
  font-size: 1.05em;
  font-weight: 600;
  color: var(--color-gray-600);
  margin: 16px 0 8px 0;
}

.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  font-size: 0.95em;
  font-weight: 600;
  color: var(--corp-text-secondary);
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
  color: var(--corp-text-inverse);
  border-radius: 50%;
  font-size: 12px;
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
  background: var(--color-gray-800); /* 代码块深色背景（原 #1e1e2e） */
  border-radius: 10px;
  padding: 16px 18px;
  margin: 14px 0;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.65;
  border: 1px solid var(--color-gray-700); /* 原 #2d2d3f */
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.markdown-body :deep(code) {
  font-family: 'JetBrains Mono', 'Fira Code', 'Menlo', 'Consolas', 'Courier New', monospace;
  font-size: 0.9em;
}

/* 行内代码 */
.markdown-body :deep(p code),
.markdown-body :deep(li code) {
  background: var(--bg-surface-active);
  color: #be123c; /* 行内代码专用玫瑰红，无对应令牌 */
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 0.88em;
  border: 1px solid var(--corp-border-light);
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
  border: 1px solid var(--corp-border-light);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.markdown-body :deep(th) {
  background: var(--color-gray-50);
  font-weight: 650;
  color: var(--color-gray-700);
  padding: 12px 16px;
  text-align: left;
  border-bottom: 2px solid var(--corp-border-light);
  font-size: 13px;
}

.markdown-body :deep(td) {
  padding: 11px 16px;
  border-bottom: 1px solid var(--bg-surface-active);
  color: var(--color-gray-600);
}

.markdown-body :deep(tr:last-child td) {
  border-bottom: none;
}

.markdown-body :deep(tr:hover td) {
  background: var(--bg-surface-hover);
}

.markdown-body :deep(th:first-child) { border-radius: 10px 0 0 0; }
.markdown-body :deep(th:last-child) { border-radius: 0 10px 0 0; }

/* 引用块 - 优雅渐变边框 */
.markdown-body :deep(blockquote) {
  margin: 14px 0;
  padding: 14px 18px;
  border-left: 4px solid;
  border-image: linear-gradient(180deg, var(--corp-primary) 0%, #818cf8 100%) 1; /* #818cf8 渐变专用色，无对应令牌 */
  background: linear-gradient(135deg, var(--color-gray-50) 0%, var(--bg-surface-active) 100%); /* 原 #f8fafc/#f1f5f9 */
  color: var(--corp-text-secondary); /* 原 #64748b */
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
  background: linear-gradient(90deg, transparent, var(--corp-border-light) 20%, var(--corp-border-light) 80%, transparent);
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
  background: linear-gradient(120deg, color-mix(in srgb, var(--color-danger) 15%, transparent) 0%, color-mix(in srgb, var(--color-danger) 25%, transparent) 100%);
  color: var(--color-danger-600);
  border-bottom: 2px solid var(--corp-danger);
  padding: 1px 3px;
  border-radius: 4px;
  font-weight: 600;
  animation: md-highlight-pulse 1.5s ease-in-out;
}

@keyframes md-highlight-pulse {
  0% { background: color-mix(in srgb, var(--color-danger) 10%, transparent); transform: scale(1); }
  50% { background: color-mix(in srgb, var(--color-danger) 35%, transparent); transform: scale(1.01); }
  100% { background: color-mix(in srgb, var(--color-danger) 15%, transparent); transform: scale(1); }
}

/* ===== 源码模式样式 ===== */
.source-body {
  padding: 20px 24px;
  font-family: 'JetBrains Mono', 'Fira Code', 'Menlo', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.8;
  color: var(--color-gray-600);
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--color-gray-50); /* 原 #fafbfc */
}

.text-chunk {
  position: relative;
  padding: 12px 16px;
  margin-bottom: 10px;
  border-radius: 8px;
  border: 1px solid var(--corp-border-light);
  background: var(--bg-surface);
  transition: all 0.3s ease;
}

.text-chunk + .text-chunk {
  border-top: 1px dashed var(--corp-border-light);
  margin-top: 10px;
}

.chunk-index {
  position: absolute;
  top: 6px;
  right: 10px;
  font-size: 12px;
  color: var(--color-gray-400);
  font-weight: 600;
  letter-spacing: 0.03em;
}

.chunk-highlighted {
  background-color: var(--color-primary-50);
  border-color: var(--color-primary-200);
  box-shadow: 0 1px 4px rgba(59, 130, 246, 0.1);
}

.highlight-segment {
  background: linear-gradient(120deg, color-mix(in srgb, var(--color-danger) 15%, transparent) 0%, color-mix(in srgb, var(--color-danger) 25%, transparent) 100%);
  color: var(--color-danger-600);
  border-bottom: 2px solid var(--corp-danger);
  padding: 1px 3px;
  border-radius: 4px;
  font-weight: 600;
  animation: highlight-pulse 1.5s ease-in-out;
}

@keyframes highlight-pulse {
  0% { background: color-mix(in srgb, var(--color-danger) 10%, transparent); }
  50% { background: color-mix(in srgb, var(--color-danger) 35%, transparent); }
  100% { background: color-mix(in srgb, var(--color-danger) 15%, transparent); }
}
</style>
