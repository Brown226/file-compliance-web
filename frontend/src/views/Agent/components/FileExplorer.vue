<template>
  <div class="file-explorer">
    <!-- 路径栏：根目录 + 返回上级 + 当前路径 -->
    <div class="explorer-pathbar">
      <el-select
        v-model="currentRoot"
        size="small"
        placeholder="选择根目录"
        class="root-select"
        @change="handleRootChange"
      >
        <el-option v-for="r in roots" :key="r.path" :label="r.name" :value="r.path" />
      </el-select>
      <button class="path-btn" :disabled="!canGoUp" title="返回上级" @click="goUp">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6" /></svg>
      </button>
    </div>
    <div class="current-path" :title="currentPath">{{ currentPath || '（未选择目录）' }}</div>

    <!-- 目录条目列表 -->
    <div class="explorer-body">
      <div v-if="loading" class="explorer-empty">
        <span class="dim-text">加载中…</span>
      </div>
      <!-- P1 错误态与空态分离：浏览失败不再伪装成「（空目录）」 -->
      <div v-else-if="loadFailed" class="explorer-empty">
        <span class="dim-text">目录加载失败</span>
        <button class="retry-btn" @click="browse(currentPath || currentRoot)">重试</button>
      </div>
      <div v-else-if="entries.length === 0" class="explorer-empty">
        <span class="dim-text">（空目录）</span>
      </div>
      <div v-else class="entry-list">
        <div
          v-for="entry in entries"
          :key="entry.path"
          class="entry-item"
          :class="entry.type === 'file' ? 'is-file' : 'is-dir'"
          @click="handleEntryClick(entry)"
          :title="entry.name"
        >
          <span class="entry-icon">
            <svg v-if="entry.type === 'dir'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>
            <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
          </span>
          <span class="entry-name">{{ entry.name }}</span>
          <span v-if="entry.type === 'file'" class="entry-meta">{{ formatSize(entry.size) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { browseDirectoriesApi, type DirectoryEntry } from '@/api/agent'

const emit = defineEmits<{
  /** 点击文件：交给外层打开预览（AgentFileViewer） */
  'select-file': [filePath: string, fileName: string]
}>()

const roots = ref<Array<{ name: string; path: string }>>([])
const currentRoot = ref('')
const currentPath = ref('')
const entries = ref<DirectoryEntry[]>([])
const loading = ref(false)
/** P1：浏览失败标记——失败显示「加载失败+重试」而非空态「（空目录）」 */
const loadFailed = ref(false)

const canGoUp = computed(() => {
  if (!currentPath.value || roots.value.length === 0) return false
  // 当前路径的根目录存在时才可返回上级
  return currentPath.value !== roots.value.find(r => r.path === currentPath.value)?.path
})

async function loadRoots() {
  try {
    const res = await browseDirectoriesApi()
    roots.value = res.data?.roots ?? []
    if (roots.value.length > 0) {
      currentRoot.value = roots.value[0].path
      await browse(roots.value[0].path)
    }
    loadFailed.value = false
  } catch (e: any) {
    ElMessage.error(`加载目录失败: ${e?.message || e}`)
    loadFailed.value = true
  }
}

async function browse(dirPath: string) {
  loading.value = true
  try {
    const res = await browseDirectoriesApi(dirPath)
    currentPath.value = res.data?.root ?? ''
    entries.value = res.data?.entries ?? []
    loadFailed.value = false
  } catch (e: any) {
    ElMessage.error(`浏览失败: ${e?.message || e}`)
    loadFailed.value = true
  } finally {
    loading.value = false
  }
}

function handleRootChange(rootPath: string) {
  if (rootPath) browse(rootPath)
}

function goUp() {
  if (!currentPath.value) return
  // 找当前路径的父目录；父目录不在白名单根目录内则回退到该根目录
  const idx = currentPath.value.lastIndexOf('/')
  const parent = idx > 0 ? currentPath.value.slice(0, idx) : currentPath.value
  // Windows 路径兼容
  const backIdx = currentPath.value.lastIndexOf('\\')
  const parentWin = backIdx > 0 ? currentPath.value.slice(0, backIdx) : currentPath.value
  const target = parentWin.length > parent.length ? parentWin : parent
  if (target && target !== currentPath.value) {
    browse(target)
  }
}

function handleEntryClick(entry: DirectoryEntry) {
  if (entry.type === 'dir') {
    browse(entry.path)
  } else {
    emit('select-file', entry.path, entry.name)
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

onMounted(loadRoots)
</script>

<style scoped>
.file-explorer {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-size: 12px;
}

.explorer-pathbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.root-select {
  flex: 1;
  min-width: 0;
}
.path-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
}
.path-btn:hover:not(:disabled) {
  background: var(--bg-selected);
  color: var(--accent);
}
.path-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.current-path {
  padding: 4px 10px;
  color: var(--text-dim);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.explorer-body {
  flex: 1;
  overflow-y: auto;
}
.explorer-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 12px;
  color: var(--text-dim);
}
.dim-text { color: var(--text-dim); }

.entry-list {
  display: flex;
  flex-direction: column;
}
.entry-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  cursor: pointer;
  color: var(--text);
  overflow: hidden;
  white-space: nowrap;
  transition: background 0.1s;
}
.entry-item:hover {
  background: var(--bg-hover);
}
.entry-item.is-dir {
  color: var(--text);
  font-weight: 500;
}
.entry-icon {
  display: flex;
  align-items: center;
  color: var(--text-dim);
  flex-shrink: 0;
}
.entry-item.is-dir .entry-icon {
  color: var(--accent);
}
.entry-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.entry-meta {
  font-size: 12px;
  color: var(--text-dim);
  flex-shrink: 0;
}
.retry-btn {
  margin-left: 8px;
  padding: 4px 14px;
  font-size: 12px;
  border: 1px solid var(--corp-border-light);
  border-radius: 4px;
  background: none;
  cursor: pointer;
  color: var(--corp-text-secondary);
}
.retry-btn:hover { border-color: var(--color-action); color: var(--color-action); }

</style>
