<template>
  <div class="agent-file-viewer">
    <!-- 文件头工具栏（对齐参考 FileViewer 的 toolbar：路径 + 元信息 + 操作） -->
    <div v-if="data" class="file-viewer-toolbar">
      <span class="fv-path" :title="data.filePath">{{ displayPath }}</span>
      <span class="fv-meta">{{ metaText }}</span>
      <div class="fv-actions">
        <button
          v-if="data.kind === 'text'"
          class="fv-icon-btn"
          :title="wrapped ? '取消换行' : '自动换行'"
          :class="{ active: wrapped }"
          @click="wrapped = !wrapped"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 6h18" /><path d="M3 12h15a3 3 0 1 1 0 6h-4" /><path d="m16 16-2 2 2 2" /><path d="M3 18h7" />
          </svg>
        </button>
        <button class="fv-icon-btn" title="在新窗口打开" @click="openExternal">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 加载态 -->
    <div v-if="loading" class="fv-center">
      <span class="fv-loading-spinner" />
      <span class="fv-dim-text">加载中…</span>
    </div>

    <!-- 错误态 -->
    <div v-else-if="error" class="fv-center">
      <span class="fv-error-text">{{ error }}</span>
    </div>

    <!-- 内容区 -->
    <div v-else-if="data" class="fv-content" :class="{ 'is-wrapped': wrapped }">
      <!-- P0-⑨ 定位提示条（点击来源卡片触发锚点定位时显示） -->
      <div v-if="locateNotice" class="fv-locate-notice" :class="{ 'is-miss': locateMiss }">
        <span>{{ locateNotice }}</span>
        <button class="fv-locate-close" title="关闭" @click="locateNotice = ''">
          <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="2" y1="2" x2="8" y2="8" /><line x1="8" y1="2" x2="2" y2="8" /></svg>
        </button>
      </div>
      <!-- 文本 / markdown -->
      <div v-if="data.kind === 'text'" class="fv-text-body markdown-body" v-html="rendered" />
      <!-- 图片 -->
      <div v-else-if="data.kind === 'image'" class="fv-image-body">
        <!-- eslint-disable-next-line vue/no-v-html -->
        <img :src="dataSrc" :alt="data.fileName" />
      </div>
      <!-- PDF -->
      <iframe v-else-if="data.kind === 'pdf'" class="fv-pdf" :src="dataSrc" title="PDF 预览" />
      <!-- docx：mammoth 渲染 HTML -->
      <div v-else-if="data.kind === 'docx'" class="fv-office-body" v-html="docxHtml" />
      <!-- xlsx：表格渲染 -->
      <div v-else-if="data.kind === 'xlsx'" class="fv-office-body">
        <div v-if="xlsxLoading" class="fv-center"><span class="fv-dim-text">加载中…</span></div>
        <div v-else-if="xlsxError" class="fv-center"><span class="fv-error-text">{{ xlsxError }}</span></div>
        <template v-else>
          <div v-if="sheetNames.length > 1" class="fv-sheet-tabs">
            <button
              v-for="name in sheetNames"
              :key="name"
              class="fv-sheet-tab"
              :class="{ active: activeSheet === name }"
              @click="activeSheet = name"
            >{{ name }}</button>
          </div>
          <div class="fv-xlsx-table-wrap">
            <table class="fv-xlsx-table">
              <thead>
                <tr>
                  <th class="fv-xlsx-rownum">#</th>
                  <th v-for="(h, hi) in currentHeaders" :key="hi">{{ h }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, ri) in currentRows" :key="ri">
                  <td class="fv-xlsx-rownum">{{ ri + 1 }}</td>
                  <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>
    </div>

    <!-- 空态 -->
    <div v-else class="fv-center">
      <span class="fv-dim-text">未打开文件</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { readAgentFileApi, type AgentFileReadResult } from '@/api/agent'
import { useMarkdown } from '@/composables/useMarkdown'
// docx / xlsx 预览（参考传统审查 TaskDetails 的 DocxPreviewPanel / ExcelPreviewPanel 方案）
import mammoth from 'mammoth'
import DOMPurify from 'dompurify'
import * as XLSX from 'xlsx'

const props = defineProps<{
  filePath: string
  // P0-⑨ 知识引用溯源：来源锚点定位目标（点击来源卡片时由父组件传入）
  // P2-⑬ 行级批注：highlight 指定原文文本关键字；highlightLines 指定 [start, end] 行号区间
  locate?: {
    filePath: string
    page?: number
    section?: string
    highlight?: string
    highlightLines?: [number, number]
  } | null
}>()

const { renderMarkdown } = useMarkdown()
const data = ref<AgentFileReadResult | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const wrapped = ref(false)
// P0-⑨ 定位提示条状态
const locateNotice = ref('')
const locateMiss = ref(false)
let flashTimer: ReturnType<typeof setTimeout> | null = null

const displayPath = computed(() => {
  const p = props.filePath
  if (!p) return ''
  // 取 uploads/agent_temp 之后的相对路径，缩短展示
  const idx = p.indexOf('agent_temp')
  return idx >= 0 ? p.slice(idx + 'agent_temp'.length + 1) : p.split(/[\\/]/).slice(-2).join('/')
})

const metaText = computed(() => {
  if (!data.value) return ''
  const { ext, size, kind } = data.value
  const sizeStr = formatSize(size)
  const kindLabel = kind === 'text' ? 'text' : kind === 'image' ? 'image' : kind === 'pdf' ? 'pdf' : 'binary'
  return `${ext || 'file'} · ${sizeStr} · ${kindLabel}`
})

const rendered = computed(() => {
  if (data.value?.kind !== 'text') return ''
  return renderMarkdown(data.value.content || '')
})

const dataSrc = computed(() => {
  if (!data.value?.base64 || !data.value.mime) return ''
  return `data:${data.value.mime};base64,${data.value.base64}`
})

// ===== docx / xlsx 预览（2026-08-04 新增，参考传统审查 TaskDetails 方案）=====
const docxHtml = ref('')
const xlsxLoading = ref(false)
const xlsxError = ref('')
const sheetNames = ref<string[]>([])
const activeSheet = ref('')
const xlsxSheets = ref<Record<string, string[][]>>({})

const currentHeaders = computed<string[]>(() => {
  const rows = xlsxSheets.value[activeSheet.value] || []
  return rows.length > 0 ? rows[0] : []
})
const currentRows = computed<string[][]>(() => {
  const rows = xlsxSheets.value[activeSheet.value] || []
  return rows.length > 1 ? rows.slice(1) : []
})

/** 解析 docx：mammoth 转 HTML */
async function parseDocx(base64: string) {
  docxHtml.value = ''
  try {
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer })
    // 安全修复：mammoth 输出直接 v-html 存在 XSS 注入面（docx 内嵌 HTML 可执行脚本），
    // 经 DOMPurify 白名单清洗后再渲染
    docxHtml.value = DOMPurify.sanitize(result.value)
  } catch (e: any) {
    console.error('[AgentFileViewer] docx 渲染失败:', e)
    ElMessage.error(`Word 渲染失败：${e?.message || '未知错误'}`)
  }
}

/** 解析 xlsx：SheetJS 读表格 */
async function parseXlsx(base64: string) {
  xlsxLoading.value = true
  xlsxError.value = ''
  sheetNames.value = []
  activeSheet.value = ''
  xlsxSheets.value = {}
  try {
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const wb = XLSX.read(bytes.buffer, { type: 'array' })
    const names = wb.SheetNames || []
    sheetNames.value = names
    const sheets: Record<string, string[][]> = {}
    for (const name of names) {
      const ws = wb.Sheets[name]
      sheets[name] = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' })
    }
    xlsxSheets.value = sheets
    if (names.length > 0) activeSheet.value = names[0]
  } catch (e: any) {
    xlsxError.value = e?.message || 'Excel 解析失败'
    console.error('[AgentFileViewer] xlsx 解析失败:', e)
  } finally {
    xlsxLoading.value = false
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1048576).toFixed(1)}MB`
}

async function load() {
  if (!props.filePath) return
  loading.value = true
  error.value = null
  data.value = null
  wrapped.value = false
  try {
    const res = await readAgentFileApi(props.filePath)
    data.value = res.data
    // 2026-08-04：docx/xlsx 预览解析（mammoth / xlsx 库）
    const kind = res.data?.kind
    const b64 = res.data?.base64
    if (kind === 'docx' && b64) await parseDocx(b64)
    else if (kind === 'xlsx' && b64) await parseXlsx(b64)
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || '读取文件失败'
    ElMessage.error(error.value)
  } finally {
    loading.value = false
  }
}

function openExternal() {
  if (!data.value?.base64 || !data.value.mime) return
  const win = window.open('', '_blank', 'noopener')
  if (!win) return
  win.document.write(`<iframe src="data:${data.value.mime};base64,${data.value.base64}" style="width:100%;height:100%;border:none"></iframe>`)
  win.document.close()
}

/**
 * P0-⑨ 知识引用溯源：在文本预览中定位到指定页码
 *
 * doc-parser 分块会在文本中保留页码标记（如 "p3" / "第3页" / "【第3页】" 等，
 * 与后端 rag.service.ts parseChunkLocator 的匹配模式一致）。策略：
 * 1. 遍历渲染后的 DOM 文本节点，找包含页码标记的块元素，scrollIntoView + 短暂高亮
 * 2. 找不到标记 → 显示提示条（不静默失败）
 */
function locateInText(page: number) {
  locateMiss.value = false
  const container = document.querySelector('.fv-content')
  if (!container) return
  const markerRegex = new RegExp(
    `(?:\\[|【|\\(|（)?(?:p|page|第)\\s*${page}\\s*(?:页|page)?(?:\\]|】|\\)|）)?`,
    'i',
  )
  const blocks = container.querySelectorAll<HTMLElement>('.fv-text-body p, .fv-text-body h1, .fv-text-body h2, .fv-text-body h3, .fv-text-body h4, .fv-text-body h5, .fv-text-body h6, .fv-text-body div')
  let target: HTMLElement | null = null
  for (const el of blocks) {
    const txt = (el as HTMLElement).textContent || ''
    if (markerRegex.test(txt)) {
      target = el
      break
    }
  }
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    target.classList.add('fv-flash-target')
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => target?.classList.remove('fv-flash-target'), 1500)
    locateNotice.value = `已定位到第 ${page} 页`
  } else {
    locateMiss.value = true
    locateNotice.value = `未找到第 ${page} 页的页码标记`
  }
}

/**
 * P2-⑬ 行级批注：在文本预览中按原文关键字定位并高亮
 *
 * 策略：遍历渲染后的 DOM 文本节点，找包含目标文本的块元素，
 * scrollIntoView + 临时高亮类；若找到了具体文本节点，用 <mark> 包裹高亮。
 * 找不到 → 显示提示条（不静默失败）。
 */
function locateByText(keyword: string) {
  locateMiss.value = false
  const container = document.querySelector('.fv-content')
  if (!container) return
  const blocks = container.querySelectorAll<HTMLElement>('.fv-text-body p, .fv-text-body h1, .fv-text-body h2, .fv-text-body h3, .fv-text-body h4, .fv-text-body h5, .fv-text-body h6, .fv-text-body div, .fv-text-body li')
  const needle = keyword.trim()
  if (!needle) return
  let target: HTMLElement | null = null
  for (const el of blocks) {
    const txt = (el as HTMLElement).textContent || ''
    if (txt.includes(needle)) {
      target = el
      break
    }
  }
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // 用 <mark> 高亮命中文本（首次命中即可）
    if (target.dataset.hlDone !== '1') {
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
      let node: Node | null = null
      while ((node = walker.nextNode())) {
        const text = node.textContent || ''
        const idx = text.indexOf(needle)
        if (idx >= 0) {
          const span = document.createElement('mark')
          span.className = 'fv-hl-mark'
          span.textContent = text.slice(idx, idx + needle.length)
          const rest = document.createTextNode(text.slice(idx + needle.length))
          node.textContent = text.slice(0, idx)
          node.parentNode?.insertBefore(span, node.nextSibling)
          node.parentNode?.insertBefore(rest, span.nextSibling)
          target.dataset.hlDone = '1'
          break
        }
      }
    }
    target.classList.add('fv-flash-target')
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      target?.classList.remove('fv-flash-target')
      target?.querySelectorAll('.fv-hl-mark').forEach(m => m.classList.add('fv-hl-done'))
    }, 2500)
    locateNotice.value = `已定位到「${needle.slice(0, 20)}${needle.length > 20 ? '…' : ''}」`
  } else {
    locateMiss.value = true
    locateNotice.value = `未找到文本「${needle.slice(0, 30)}${needle.length > 30 ? '…' : ''}」`
  }
}

/**
 * P2-⑬ 行级批注：按行号区间 [start, end] 定位并高亮
 *
 * 策略：读取原始文本按行切分，把目标行号范围内的行作为独立块
 * 高亮（行背景 + 侧边竖线），并滚动到起始行。纯文本可靠；PDF 退化到页码提示。
 */
function locateByLines(start: number, end: number) {
  locateMiss.value = false
  const raw = data.value?.content
  if (typeof raw !== 'string' || !raw) {
    locateMiss.value = true
    locateNotice.value = '当前文件无文本内容，无法按行号定位'
    return
  }
  const lines = raw.split('\n')
  const s = Math.max(1, start)
  const e = Math.min(lines.length, Math.max(s, end))
  if (s > lines.length) {
    locateMiss.value = true
    locateNotice.value = `文件共 ${lines.length} 行，行号 ${s} 超出范围`
    return
  }
  const container = document.querySelector('.fv-content')
  const blocks = container?.querySelectorAll<HTMLElement>('.fv-text-body p, .fv-text-body h1, .fv-text-body h2, .fv-text-body h3, .fv-text-body h4, .fv-text-body h5, .fv-text-body h6, .fv-text-body div, .fv-text-body li')
  if (!container || !blocks) return

  // 给每个块标注起始行号（近似：块文本第一个非空行的累计行号）
  let lineCursor = 1
  let target: HTMLElement | null = null
  let targetStartLine = 0
  for (const el of blocks) {
    const txt = (el as HTMLElement).textContent || ''
    if (!txt.trim()) continue
    const elLines = txt.split('\n').length
    const elEndLine = lineCursor + elLines - 1
    // 命中：块内任意一行落在 [s, e] 区间
    if (elEndLine >= s && lineCursor <= e) {
      target = el
      targetStartLine = lineCursor
      break
    }
    lineCursor = elEndLine + 1
  }

  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target.classList.add('fv-flash-target', 'fv-lines-highlight')
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      target?.classList.remove('fv-flash-target', 'fv-lines-highlight')
    }, 3000)
    locateNotice.value = `已定位到第 ${s}${e > s ? `–${e}` : ''} 行`
  } else {
    locateMiss.value = true
    locateNotice.value = `未定位到第 ${s} 行（文件共 ${lines.length} 行）`
  }
}

// P0-⑨：监听来源锚点定位目标
watch(
  () => props.locate,
  (target) => {
    if (!target || target.filePath !== props.filePath) return
    // 文件未加载时先等待加载完成再定位
    if (!data.value) {
      const unwatch = watch(
        () => data.value,
        (d) => {
          if (d?.kind === 'text' && (target.page || target.highlight || target.highlightLines)) {
            if (target.highlightLines) locateByLines(target.highlightLines[0], target.highlightLines[1])
            else if (target.highlight) locateByText(target.highlight)
            else locateInText(target.page as number)
            unwatch()
          }
        },
      )
      return
    }
    if (data.value.kind === 'text') {
      if (target.highlightLines) {
        locateByLines(target.highlightLines[0], target.highlightLines[1])
      } else if (target.highlight) {
        locateByText(target.highlight)
      } else if (target.page) {
        locateInText(target.page)
      }
    } else if (data.value.kind === 'pdf' && target.page) {
      // PDF 用 iframe 预览，无法精确跳页；提示页码供参考
      locateMiss.value = false
      locateNotice.value = `PDF 预览：请跳转到第 ${target.page} 页`
    }
  },
)

watch(() => props.filePath, load, { immediate: true })
</script>

<style scoped>
.agent-file-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
}

/* 文件头工具栏（对齐参考 FileViewer toolbar：11px、var(--bg) 底、border-bottom） */
.file-viewer-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-dim);
  background: var(--bg);
  flex-shrink: 0;
}
.fv-path {
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  color: var(--text-muted);
}
.fv-meta {
  flex-shrink: 0;
  color: var(--text-dim);
}
.fv-actions {
  margin-left: auto;
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.fv-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: transparent;
  border: none;
  border-radius: 5px;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.fv-icon-btn:hover { background: var(--bg-hover); color: var(--text); }
.fv-icon-btn.active { background: var(--bg-selected); color: var(--text); }

.fv-content {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
.fv-text-body {
  padding: 16px 20px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text);
  white-space: normal;
}
.fv-text-body.is-wrapped {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono);
}
.fv-image-body {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background-color: var(--bg-panel);
  background-image: linear-gradient(45deg, var(--bg) 25%, transparent 25%), linear-gradient(-45deg, var(--bg) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--bg) 75%), linear-gradient(-45deg, transparent 75%, var(--bg) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}
.fv-image-body img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
.fv-pdf {
  width: 100%;
  height: 100%;
  border: none;
  background: var(--bg);
}

.fv-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-dim);
  font-size: 12px;
}

/* ===== P0-⑨ 来源锚点定位 ===== */
.fv-locate-notice {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 8px 12px 0;
  padding: 5px 10px;
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  font-size: 11px;
}
.fv-locate-notice.is-miss {
  background: var(--warning, #e6a23c);
}
.fv-locate-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
}
.fv-locate-close:hover { background: rgba(255, 255, 255, 0.2); }
.fv-flash-target {
  animation: fv-flash 1.5s ease-out;
}
@keyframes fv-flash {
  0% { background-color: rgba(var(--accent-rgb, 64, 158, 255), 0.25); }
  100% { background-color: transparent; }
}
/* P2-⑬ 行级批注：原文命中高亮 */
.fv-hl-mark {
  background-color: rgba(255, 213, 79, 0.7);
  border-radius: 2px;
  padding: 0 1px;
  box-shadow: 0 0 0 1px rgba(255, 200, 0, 0.4);
}
.fv-hl-mark.fv-hl-done {
  background-color: rgba(255, 213, 79, 0.35);
}
/* P2-⑬ 行级批注：行号定位高亮（背景 + 左侧竖线，3s 后自动清除） */
.fv-lines-highlight {
  background-color: rgba(var(--accent-rgb, 64, 158, 255), 0.12);
  box-shadow: inset 3px 0 0 var(--accent, #409eff);
  border-radius: 2px;
}
.fv-dim-text { color: var(--text-dim); }
.fv-error-text { color: var(--danger); }
.fv-loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: agent-file-spin 0.9s linear infinite;
}
@keyframes agent-file-spin { to { transform: rotate(360deg); } }

/* ===== docx / xlsx 预览样式（2026-08-04）===== */
.fv-office-body {
  flex: 1;
  overflow: auto;
  padding: 16px 24px;
  font-size: 14px;
  line-height: 1.8;
  color: var(--text);
}
.fv-office-body :deep(h1) { font-size: 1.7em; font-weight: 700; margin: 16px 0 10px; }
.fv-office-body :deep(h2) { font-size: 1.4em; font-weight: 650; margin: 14px 0 8px; }
.fv-office-body :deep(h3) { font-size: 1.15em; font-weight: 600; margin: 12px 0 6px; }
.fv-office-body :deep(p) { margin: 0 0 10px; }
.fv-office-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 10px 0;
  font-size: 13px;
}
.fv-office-body :deep(th),
.fv-office-body :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 10px;
  text-align: left;
}
.fv-office-body :deep(th) { background: var(--bg-subtle); font-weight: 600; }
.fv-office-body :deep(img) { max-width: 100%; height: auto; }
.fv-office-body :deep(ul),
.fv-office-body :deep(ol) { padding-left: 1.5em; margin: 8px 0; }
.fv-sheet-tabs { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
.fv-sheet-tab {
  padding: 3px 12px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
}
.fv-sheet-tab.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.fv-xlsx-table-wrap { overflow: auto; max-height: 100%; }
.fv-xlsx-table { border-collapse: collapse; font-size: 12px; width: 100%; }
.fv-xlsx-table th,
.fv-xlsx-table td { border: 1px solid var(--border); padding: 4px 8px; text-align: left; white-space: nowrap; }
.fv-xlsx-table th { background: var(--bg-subtle); font-weight: 600; position: sticky; top: 0; }
.fv-xlsx-rownum { color: var(--text-dim); background: var(--bg-subtle); text-align: center; width: 40px; }
</style>
