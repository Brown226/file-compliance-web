<template>
  <el-dialog
    :model-value="modelValue"
    title="收藏与搜索"
    width="640px"
    class="agent-library-dialog"
    :append-to-body="true"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="lib-panel">
      <!-- 双 tab：收藏列表 / 全局搜索 -->
      <div class="lib-tabs">
        <button
          class="lib-tab"
          :class="{ active: tab === 'saves' }"
          @click="switchTab('saves')"
        >收藏（{{ saves.length }}）</button>
        <button
          class="lib-tab"
          :class="{ active: tab === 'search' }"
          @click="switchTab('search')"
        >全局搜索</button>
      </div>

      <!-- 收藏列表 -->
      <div v-if="tab === 'saves'" class="lib-body">
        <div v-if="savesLoading" class="lib-empty dim-text">加载中…</div>
        <!-- P1 错误态与空态分离：加载失败不再伪装成「暂无收藏」 -->
        <div v-else-if="savesFailed" class="lib-empty dim-text">
          收藏加载失败
          <button class="retry-btn" @click="loadSaves">重试</button>
        </div>
        <div v-else-if="saves.length === 0" class="lib-empty dim-text">
          暂无收藏。对话消息上的「收藏」按钮可将内容存入此处。
        </div>
        <div v-else class="lib-list">
          <div v-for="item in saves" :key="item.id" class="lib-item">
            <div class="lib-item-head">
              <span class="lib-item-type">{{ typeLabel(item.type) }}</span>
              <span class="lib-item-title">{{ item.title }}</span>
              <span class="lib-item-time">{{ formatTime(item.createdAt) }}</span>
            </div>
            <div class="lib-item-content">{{ item.content }}</div>
            <div class="lib-item-actions">
              <button class="lib-btn" title="复制内容" @click="copyItem(item)">复制</button>
              <button class="lib-btn danger" title="删除收藏" @click="deleteItem(item.id)">删除</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 全局搜索 -->
      <div v-else class="lib-body">
        <div class="lib-search-row">
          <input
            v-model="searchQuery"
            class="lib-search-input"
            placeholder="搜索会话消息内容（标题/问题/答案）…"
            @keyup.enter="doSearch"
          />
          <button class="lib-btn primary" :disabled="searching" @click="doSearch">
            {{ searching ? '搜索中…' : '搜索' }}
          </button>
        </div>
        <div v-if="searchHits.length === 0 && !searching" class="lib-empty dim-text">
          输入关键词后回车，可跨会话搜索历史消息。
        </div>
        <div v-else class="lib-list">
          <div v-for="hit in searchHits" :key="hit.id" class="lib-item">
            <div class="lib-item-head">
              <span class="lib-item-type">{{ hit.role === 'assistant' ? '回答' : '提问' }}</span>
              <span class="lib-item-title">{{ hit.sessionTitle || '未命名会话' }}</span>
              <span class="lib-item-time">{{ formatTime(hit.createdAt) }}</span>
            </div>
            <div class="lib-item-content">{{ hit.content }}</div>
            <div class="lib-item-actions">
              <button class="lib-btn" title="复制内容" @click="copyText(hit.content)">复制</button>
              <button class="lib-btn" title="跳转到该消息" @click="jumpToHit(hit)">跳转</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  listAgentSavesApi,
  deleteAgentSaveApi,
  searchAgentMessagesApi,
  type SavedItem,
  type SearchHit,
} from '@/api/agent'

const props = defineProps<{
  modelValue: boolean
  currentSessionId?: string | null
}>()
const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  'jump-to-session': [sessionId: string, messageId?: string]
}>()

const tab = ref<'saves' | 'search'>('saves')
const saves = ref<SavedItem[]>([])
const savesLoading = ref(false)
/** P1：收藏加载失败标记——失败显示「加载失败+重试」而非空态「暂无收藏」 */
const savesFailed = ref(false)
const searchQuery = ref('')
const searchHits = ref<SearchHit[]>([])
const searching = ref(false)

function switchTab(t: 'saves' | 'search') {
  tab.value = t
  if (t === 'saves' && saves.value.length === 0 && !savesLoading.value) {
    loadSaves()
  }
}

async function loadSaves() {
  savesLoading.value = true
  try {
    const res = await listAgentSavesApi()
    saves.value = res?.data ?? res ?? []
    savesFailed.value = false
  } catch (e: any) {
    ElMessage.error(`加载收藏失败：${e?.message || '未知错误'}`)
    savesFailed.value = true
  } finally {
    savesLoading.value = false
  }
}

async function deleteItem(id: string) {
  try {
    await deleteAgentSaveApi(id)
    saves.value = saves.value.filter((s) => s.id !== id)
  } catch (e: any) {
    ElMessage.error(`删除失败：${e?.message || '未知错误'}`)
  }
}

async function doSearch() {
  const q = searchQuery.value.trim()
  if (!q) return
  searching.value = true
  try {
    const res = await searchAgentMessagesApi(q)
    searchHits.value = res?.data ?? res ?? []
  } catch (e: any) {
    ElMessage.error(`搜索失败：${e?.message || '未知错误'}`)
    searchHits.value = []
  } finally {
    searching.value = false
  }
}

function jumpToHit(hit: SearchHit) {
  emit('jump-to-session', hit.sessionId, hit.id)
  emit('update:modelValue', false)
}

async function copyItem(item: SavedItem) {
  await copyText(item.content)
}
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* 剪贴板不可用静默失败 */
  }
}

function typeLabel(t: string): string {
  return ({ qa: '问答', review: '审查', report: '报告', document: '文档' } as Record<string, string>)[t] || t || '其他'
}
function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 打开时自动加载收藏
watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      if (tab.value === 'saves' && saves.value.length === 0) loadSaves()
    }
  },
)
</script>

<style scoped>
.lib-panel { display: flex; flex-direction: column; gap: 10px; min-height: 320px; }
.lib-tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--border, var(--corp-border-light)); }
.lib-tab {
  padding: 6px 14px;
  border: none;
  background: none;
  color: var(--text-muted, var(--corp-text-secondary));
  cursor: pointer;
  font-size: 13px;
  border-bottom: 2px solid transparent;
}
.lib-tab.active { color: var(--text, var(--color-gray-800)); border-bottom-color: var(--accent, var(--color-action)); font-weight: 500; }
.lib-body { flex: 1; overflow: auto; max-height: 400px; }
.lib-empty { padding: 24px; text-align: center; font-size: 12px; }
.dim-text { color: var(--text-dim, var(--corp-text-tertiary)); }
.lib-list { display: flex; flex-direction: column; gap: 8px; }
.lib-item { border: 1px solid var(--border, var(--corp-border-light)); border-radius: 6px; padding: 8px 10px; }
.lib-item-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.lib-item-type {
  flex-shrink: 0;
  font-size: 12px;
  padding: 1px 6px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--accent, var(--color-action)) 12%, transparent);
  color: var(--accent, var(--color-action));
}
.lib-item-title { font-size: 12px; font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lib-item-time { font-size: 12px; color: var(--text-dim, var(--corp-text-tertiary)); flex-shrink: 0; }
.lib-item-content {
  font-size: 12px;
  color: var(--text-muted, var(--corp-text-secondary));
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  max-height: 3em;
  white-space: pre-wrap;
  word-break: break-all;
}
.lib-item-actions { display: flex; gap: 6px; margin-top: 6px; }
.lib-btn {
  font-size: 12px;
  padding: 2px 10px;
  border: 1px solid var(--border, var(--corp-border-light));
  border-radius: 4px;
  background: none;
  color: var(--text-muted, var(--corp-text-secondary));
  cursor: pointer;
}
.lib-btn:hover { color: var(--text, var(--color-gray-800)); border-color: var(--accent, var(--color-action)); }
.lib-btn.danger:hover { color: var(--color-danger); border-color: var(--color-danger); }
.lib-btn.primary { background: var(--accent, var(--color-action)); color: var(--corp-text-inverse); border-color: var(--accent, var(--color-action)); }
.lib-btn.primary:disabled { opacity: 0.6; cursor: not-allowed; }
.lib-search-row { display: flex; gap: 8px; }
.lib-search-input {
  flex: 1;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border, var(--corp-border-light));
  border-radius: 4px;
  font-size: 12px;
  background: var(--bg, var(--bg-surface));
  color: var(--text, var(--color-gray-800));
  outline: none;
}
.lib-search-input:focus { border-color: var(--accent, var(--color-action)); }
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
