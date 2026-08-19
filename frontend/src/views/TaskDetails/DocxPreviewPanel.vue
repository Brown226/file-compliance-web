<template>
  <div class="docx-preview-panel">
    <div v-if="loading" class="preview-loading">
      <el-icon class="is-loading" :size="24"><Loading /></el-icon>
      <span>正在渲染 Word 文档...</span>
    </div>
    <div v-else-if="error" class="preview-error">
      <el-icon :size="24" color="var(--corp-danger)"><WarningFilled /></el-icon>
      <span>{{ error }}</span>
    </div>
    <!-- docx-preview 渲染容器（常驻 DOM，loading 时也可见，保证宽度测量准确） -->
    <div class="docx-content" ref="contentRef"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue'
import { Loading, WarningFilled } from '@element-plus/icons-vue'
import request from '@/utils/request'
import { renderAsync } from 'docx-preview'
// 注意：docx-preview 0.4.x 无独立 css 文件，样式由 renderAsync 动态注入
import MarkdownIt from 'markdown-it'

const mdRenderer = new MarkdownIt({ html: false, linkify: true, breaks: true })

const reportDebug = (_event: string, _data: Record<string, any>) => {
  // debug log disabled — backend /api/debug/log not implemented
}

const props = defineProps<{
  taskId: string
  fileId: string | null
  fileType?: string
  fileUrl?: string
  locateTarget?: { originalText: string; locateCandidates?: string[]; locateMeta?: any; locateHint?: string } | null
}>()

const emit = defineEmits<{
  locateResult: [{ success: boolean; mode: 'direct' | 'fallback'; hint?: string }]
}>()

const loading = ref(false)
const error = ref('')
const contentRef = ref<HTMLElement | null>(null)
const lastLocateTriggerId = ref('')
const HIGHLIGHT_CLASS = 'docx-highlight-yellow'

const loadDocx = async () => {
  if (!props.fileId && !props.fileUrl) return

  // .doc 旧格式：后端 anydoc 直接转换为 Markdown 再渲染（无需 LibreOffice）
  // .docx/.docm：docx-preview 保真渲染（页眉页脚/表格样式/批注）
  const isOldDoc = props.fileType === 'doc'

  loading.value = true
  error.value = ''
  if (contentRef.value) contentRef.value.innerHTML = ''

  try {
    if (isOldDoc) {
      // .doc → 后端转换为 Markdown（tasks 服务转发 doc-parser /api/convert）
      const resp = await request.get(
        `/tasks/${props.taskId}/files/${props.fileId}/convert-doc`,
        { responseType: 'text', timeout: 120000 }
      )
      const markdown = typeof resp === 'string' ? resp : (resp?.data ?? '')
      await nextTick()
      if (contentRef.value) {
        contentRef.value.innerHTML = mdRenderer.render(markdown || '')
      }
    } else {
      let arrayBuffer: ArrayBuffer
      if (props.fileUrl) {
        const resp = await fetch(props.fileUrl)
        arrayBuffer = await resp.arrayBuffer()
      } else {
        const resp = await request.get(
          `/tasks/${props.taskId}/files/${props.fileId}/raw`,
          { responseType: 'arraybuffer' }
        )
        arrayBuffer = resp.data
      }

      if (arrayBuffer.byteLength < 512) {
        try {
          const text = new TextDecoder().decode(arrayBuffer)
          const json = JSON.parse(text)
          if (json && json.code && json.code !== 200) {
            throw new Error(json.message || '文件加载失败')
          }
        } catch (e: any) {
          if (e.message !== 'Unexpected token' && !e.message.includes('Unexpected')) {
            throw e
          }
        }
      }

      // docx-preview 保真渲染（直接渲染 DOM，支持 .docx/.docm）
      await nextTick()
      if (!contentRef.value) throw new Error('预览容器未就绪')
      await renderAsync(arrayBuffer, contentRef.value, null, {
        className: 'docx',
        inWrapper: true,
        breakPages: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        ignoreFonts: false,
      })
    }

    // 内容加载完成后，检查是否有待定位的原文（locateTarget 可能在加载期间被设置）
    await nextTick()
    if (props.locateTarget?.originalText) {
      const found = highlightAndScroll()
      emit('locateResult', {
        success: found,
        mode: found ? 'direct' : 'fallback',
        hint: found ? undefined : (props.locateTarget.locateHint || '未能在 Word 渲染文本中精确匹配原文，请按提示页段信息辅助定位。'),
      })
    }
  } catch (e: any) {
    error.value = e?.message || 'Word 文档渲染失败'
    console.error('[DocxPreview] 错误:', e)
  } finally {
    loading.value = false
  }
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

const highlightAndScroll = (): boolean => {
  if (!contentRef.value) {
    reportDebug('highlight-skip', { reason: 'missing-content-ref' })
    return false
  }

  const currentTriggerId = props.locateTarget?.triggerId || ''
  if (currentTriggerId && currentTriggerId === lastLocateTriggerId.value) {
    reportDebug('highlight-skip', { reason: 'duplicate-trigger', triggerId: currentTriggerId })
    return true
  }

  const startedAt = performance.now()

  // 清除旧高亮
  const oldHighlights = contentRef.value.querySelectorAll(`.${HIGHLIGHT_CLASS}`)
  oldHighlights.forEach(el => {
    const parent = el.parentNode
    if (parent) {
      parent.replaceChild(document.createTextNode(el.textContent || ''), el)
      parent.normalize()
    }
  })

  const locateTerms = getLocateTerms()
  if (!locateTerms.length) {
    reportDebug('highlight-skip', { reason: 'no-locate-terms', elapsedMs: Number((performance.now() - startedAt).toFixed(2)) })
    return false
  }

  // 在 DOM 中查找并高亮文本
  const walker = document.createTreeWalker(contentRef.value, NodeFilter.SHOW_TEXT)
  let found = false
  let visitedNodes = 0
  let hitCount = 0
  while (walker.nextNode()) {
    visitedNodes++
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
      mark.className = HIGHLIGHT_CLASS
      range.surroundContents(mark)
      hitCount++

      if (!found) {
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
        found = true
        if (currentTriggerId) lastLocateTriggerId.value = currentTriggerId
        break
      }
    }

    if (!found && locateTerms.some(term => includesLoose(node.data, term)) && node.data.trim()) {
      const range = document.createRange()
      range.setStart(node, 0)
      range.setEnd(node, node.data.length)
      const mark = document.createElement('mark')
      mark.className = HIGHLIGHT_CLASS
      range.surroundContents(mark)
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
      hitCount++
      found = true
      if (currentTriggerId) lastLocateTriggerId.value = currentTriggerId
      break
    }
  }

  reportDebug('highlight-finish', {
    found,
    visitedNodes,
    hitCount,
    locateTermsCount: locateTerms.length,
    oldHighlights: oldHighlights.length,
    elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
  })

  return found
}

onMounted(() => loadDocx())
watch(() => props.fileId, () => loadDocx())
watch(() => props.locateTarget, () => {
  nextTick(() => {
    const target = props.locateTarget
    if (!target?.originalText?.trim()) return
    reportDebug('locate-trigger', {
      originalTextLength: target.originalText.length,
      locateCandidatesCount: Array.isArray(target.locateCandidates) ? target.locateCandidates.length : 0,
      hasLocateMeta: !!target.locateMeta,
    })
    const found = highlightAndScroll()
    emit('locateResult', {
      success: found,
      mode: found ? 'direct' : 'fallback',
      hint: found ? undefined : (target.locateHint || '未能在 Word 渲染文本中精确匹配原文，请按提示页段信息辅助定位。'),
    })
  })
})
</script>

<style scoped>
.docx-preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  min-width: 0;
}

.preview-loading,
.preview-error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--corp-text-secondary);
  font-size: 13px;
}

.docx-content {
  flex: 1;
  overflow: auto;
  padding: 24px 32px;
  font-size: 14px;
  line-height: 1.8;
  color: var(--color-gray-700);
  background: #f5f6f7;
}

/* docx-preview 默认会给 .docx-wrapper 加一层灰色背景，
   这里统一改为浅色背景 + 白色文档页，避免“下面叠一层灰色” */
.docx-content :deep(.docx-wrapper) {
  background: transparent !important;
  padding: 16px 0 !important;
}

.docx-content :deep(.docx-wrapper > .docx) {
  background: #fff !important;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  margin: 0 auto 16px !important;
}

.docx-content :deep(h1) { font-size: 1.8em; font-weight: 700; margin: 20px 0 12px; color: var(--color-gray-800); }
.docx-content :deep(h2) { font-size: 1.5em; font-weight: 650; margin: 18px 0 10px; color: var(--color-gray-800); }
.docx-content :deep(h3) { font-size: 1.2em; font-weight: 600; margin: 16px 0 8px; color: var(--color-gray-700); }
.docx-content :deep(p) { margin: 0 0 10px; }
.docx-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 13px;
}
.docx-content :deep(th),
.docx-content :deep(td) {
  border: 1px solid var(--corp-border-light);
  padding: 8px 12px;
  text-align: left;
}
.docx-content :deep(th) { background: var(--color-gray-50); font-weight: 600; }
.docx-content :deep(img) { max-width: 100%; height: auto; }
.docx-content :deep(ul),
.docx-content :deep(ol) { padding-left: 1.5em; margin: 8px 0; }
.docx-content :deep(blockquote) {
  border-left: 3px solid var(--corp-primary);
  padding-left: 12px;
  margin: 12px 0;
  color: var(--corp-text-secondary);
}

/* 高亮标记 */
.docx-content :deep(.docx-highlight-yellow) {
  background: color-mix(in srgb, var(--severity-minor) 35%, transparent);
  border-bottom: 2px solid var(--severity-minor);
  padding: 1px 2px;
  border-radius: 3px;
  scroll-margin: 100px;
}
</style>
