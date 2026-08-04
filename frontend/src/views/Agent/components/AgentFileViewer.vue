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
      <!-- 文本 / markdown -->
      <div v-if="data.kind === 'text'" class="fv-text-body markdown-body" v-html="rendered" />
      <!-- 图片 -->
      <div v-else-if="data.kind === 'image'" class="fv-image-body">
        <!-- eslint-disable-next-line vue/no-v-html -->
        <img :src="dataSrc" :alt="data.fileName" />
      </div>
      <!-- PDF -->
      <iframe v-else-if="data.kind === 'pdf'" class="fv-pdf" :src="dataSrc" title="PDF 预览" />
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

const props = defineProps<{
  filePath: string
}>()

const { renderMarkdown } = useMarkdown()
const data = ref<AgentFileReadResult | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const wrapped = ref(false)

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
</style>
