<template>
  <div class="side-panel">
    <div class="panel-tabs">
      <!-- 文件树 tab（任务 8：浏览授权目录） -->
      <button
        class="panel-tab"
        :class="{ active: activeTab === '__explorer__' }"
        @click="activeTab = '__explorer__'"
      >
        <span class="file-tab-icon">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>
        </span>
        <span class="file-tab-label">文件树</span>
      </button>
      <!-- 文件 tab（查看器，对齐参考 TabBar：图标 + 文件名 + 关闭按钮） -->
      <button
        v-for="tab in fileTabs"
        :key="tab.id"
        class="panel-tab file-tab"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
        @auxclick.middle="closeFileTab(tab.id)"
        :title="tab.filePath"
      >
        <span class="file-tab-icon">
          <svg v-if="isImageExt(tab.fileName)" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>
          <svg v-else-if="isPdfExt(tab.fileName)" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
          <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
        </span>
        <span class="file-tab-label">{{ tab.fileName }}</span>
        <span class="file-tab-close" title="关闭" @click.stop="closeFileTab(tab.id)">
          <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="2" y1="2" x2="8" y2="8" /><line x1="8" y1="2" x2="2" y2="8" /></svg>
        </span>
      </button>

    </div>

    <div class="tab-body">
      <!-- 文件树（任务 8）：点文件 → 打开文件查看器 -->
      <FileExplorer
        v-if="activeTab === '__explorer__'"
        @select-file="handleExplorerSelect"
      />
      <!-- 文件查看器 -->
      <AgentFileViewer
        v-else-if="activeFileTab"
        :key="activeFileTab.id"
        :file-path="activeFileTab.filePath"
        :locate="locate"
      />
      <!-- 未打开文件（初始） -->
      <div v-else class="tab-empty">
        <span class="dim-text">打开一个文件以预览</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import AgentFileViewer from './AgentFileViewer.vue'
import FileExplorer from './FileExplorer.vue'

const props = defineProps<{
  currentSessionId?: string | null
  // 当前会话已上传文件（供右栏文件 tab 展示）
  uploadedFiles?: Array<{ name: string; size: number; path?: string }>
  // 主动打开文件（由父组件/会话消息触发）
  openFilePath?: string | null
  // P0-⑨ 知识引用溯源：来源锚点定位目标（透传给 AgentFileViewer）
  locate?: { filePath: string; page?: number; section?: string; highlight?: string } | null
}>()

const emit = defineEmits<{
  'close-file': [filePath: string]
}>()

interface FileTab {
  id: string
  fileName: string
  filePath: string
}

// 激活的文件 tab（右栏 = 纯文件查看器，无业务 tab）
const activeTab = ref<string>('')
const fileTabs = ref<FileTab[]>([])

const activeFileTab = computed(() =>
  fileTabs.value.find(t => t.id === activeTab.value) ?? null,
)

function isImageExt(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(name)
}
function isPdfExt(name: string): boolean {
  return /\.pdf$/i.test(name)
}

function openFile(filePath: string, fileName?: string) {
  if (!filePath) return
  const name = fileName || filePath.split(/[\\/]/).pop() || filePath
  const id = `file:${filePath}`
  const existing = fileTabs.value.find(t => t.id === id)
  if (!existing) {
    fileTabs.value.push({ id, fileName: name, filePath })
  }
  activeTab.value = id
}

function closeFileTab(id: string) {
  const idx = fileTabs.value.findIndex(t => t.id === id)
  if (idx === -1) return
  const removed = fileTabs.value[idx]
  fileTabs.value.splice(idx, 1)
  emit('close-file', removed.filePath)
  // 关闭当前激活文件后回退到最近一个 tab（无文件则回到空态）
  if (activeTab.value === id) {
    activeTab.value = fileTabs.value.length > 0
      ? fileTabs.value[fileTabs.value.length - 1].id
      : ''
  }
}

// 任务 8：文件树点击文件 → 打开文件查看器（并切换到该文件 tab）
function handleExplorerSelect(filePath: string, fileName: string) {
  openFile(filePath, fileName)
}

// 父组件触发的文件打开
watch(
  () => props.openFilePath,
  (path) => {
    if (path) openFile(path)
  },
)

// 上传文件变化：把有 path 的追加到文件 tab（不重复）
watch(
  () => props.uploadedFiles,
  (files) => {
    if (!files || files.length === 0) return
    for (const f of files) {
      if (f.path) openFile(f.path, f.name)
    }
  },
  { deep: true },
)

// 切换会话：清空文件 tab（文件属于旧会话）
watch(
  () => props.currentSessionId,
  () => {
    fileTabs.value = []
    activeTab.value = ''
  },
)
</script>

<style scoped>
.side-panel {
  height: 100%;
  background: var(--bg);
  display: flex;
  flex-direction: column;
}

/* 对齐参考项目 TabBar：36px 高横向 tab，激活白底 + 文字加粗 */
.panel-tabs {
  display: flex;
  align-items: flex-end;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  height: 36px;
  overflow-x: auto;
}
.panel-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border: none;
  border-right: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 0.1s, color 0.1s;
}
.panel-tab.active {
  background: var(--bg);
  color: var(--text);
  font-weight: 500;
}
.panel-tab:hover:not(.active) {
  background: var(--bg-hover);
  color: var(--text);
}

/* 文件 tab：更紧凑（参考 TabBar：图标+文件名+关闭，max-width 180） */
.file-tab {
  padding: 0 6px 0 12px;
  max-width: 180px;
  min-width: 80px;
}
.file-tab-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  color: var(--text-dim);
}
.file-tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}
.file-tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  color: var(--text-dim);
  flex-shrink: 0;
  cursor: pointer;
}
.file-tab-close:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.tab-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.tab-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  font-size: 12px;
  padding: 16px;
}
.dim-text { color: var(--text-dim); }
</style>
