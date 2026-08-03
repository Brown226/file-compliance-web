<template>
  <div class="agent-layout" @dragover.prevent="onDragOver" @dragleave.prevent="onDragLeave" @drop.prevent="onDrop">
    <!-- 左侧：会话列表（可拖拽宽度） -->
    <aside
      ref="sidebarContainerRef"
      class="sidebar-container"
      :class="[sidebarOpen ? 'sidebar-open' : 'sidebar-closed', sidebarIsResizing ? 'sidebar-resizing' : '']"
    >
      <AgentSessionList
        ref="sessionListRef"
        :current-session-id="sessionId"
        @select="handleSelectSession"
        @new-chat="handleNewChat"
      />
    </aside>

    <!-- 左侧拖拽分隔条 -->
    <div
      v-if="sidebarOpen"
      ref="sidebarSeparatorRef"
      class="panel-resize-handle"
      :class="{ 'is-resizing': sidebarIsResizing }"
      v-bind="sidebarSeparatorProps"
    />

    <!-- 中间：对话区域 -->
    <main class="center-column">
      <!-- 顶部工具栏（36px） -->
      <header class="top-toolbar">
        <div class="toolbar-left">
          <button class="toolbar-icon-btn" :title="sidebarOpen ? '收起侧边栏' : '展开侧边栏'" @click="sidebarOpen = !sidebarOpen">
            <el-icon :size="15"><Fold v-if="sidebarOpen" /><Expand v-else /></el-icon>
          </button>
          <button class="toolbar-icon-btn" :title="rightPanelOpen ? '收起追踪面板' : '展开追踪面板'" @click="rightPanelOpen = !rightPanelOpen">
            <el-icon :size="15"><Grid /></el-icon>
          </button>
          <div class="toolbar-title">
            <span class="title-text">Agent 审查助手</span>
            <span v-if="sessionId" class="session-badge">会话已绑定</span>
          </div>
        </div>
        <div class="toolbar-right">
          <!-- token 统计 -->
          <div v-if="stats" class="token-stats">
            <span class="stat-item" title="输入 token">
              <span class="stat-label">↑</span>{{ formatToken(stats.tokens.input) }}
            </span>
            <span class="stat-item" title="输出 token">
              <span class="stat-label">↓</span>{{ formatToken(stats.tokens.output) }}
            </span>
            <span v-if="stats.tokens.total" class="stat-item stat-total" :class="contextUsageClass" title="总 token">
              <span class="stat-label">Σ</span>{{ formatToken(stats.tokens.total) }}
            </span>
          </div>
          <!-- 自动命名按钮 -->
          <button
            class="toolbar-icon-btn auto-name-btn"
            :disabled="autoNameStatus === 'loading' || !sessionId || messages.length === 0"
            :title="'自动生成会话标题'"
            @click="handleAutoName"
          >
            <el-icon :size="15" v-if="autoNameStatus === 'loading'" class="is-loading"><Loading /></el-icon>
            <el-icon :size="15" v-else-if="autoNameStatus === 'success'"><Check /></el-icon>
            <el-icon :size="15" v-else><MagicStick /></el-icon>
          </button>
          <button class="toolbar-icon-btn" :disabled="isLoading || messages.length === 0" title="清空对话" @click="clearConversation">
            <el-icon :size="15"><Delete /></el-icon>
          </button>
        </div>
      </header>

      <!-- 聊天内容区 -->
      <div class="chat-content">
        <!-- 消息列表 -->
        <div ref="messagesContainer" class="messages-container">
          <div v-if="messages.length === 0" class="empty-state">
            <div class="empty-icon">
              <el-icon :size="40"><ChatLineRound /></el-icon>
            </div>
            <p class="empty-title">开始新的审查</p>
            <p class="empty-desc">上传待审文件，或直接描述你想要审查的内容</p>
            <div class="empty-hints">
              <span>试试：帮我审查这份合同的付款条款</span>
              <span>试试：检查这份规章是否符合 GB/T 标准</span>
            </div>
          </div>

          <div
            v-for="(message, idx) in messages"
            :key="message.id"
            class="message-row"
            :class="message.role"
          >
            <div class="avatar" :class="message.role">
              <span>{{ message.role === 'user' ? '我' : 'AI' }}</span>
            </div>
            <div class="bubble-wrap">
              <div class="bubble" :class="message.role">
                <!-- thinking / reasoning 折叠块（assistant） -->
                <template v-if="message.role === 'assistant'">
                  <div
                    v-for="(think, ti) in getThinkingParts(message)"
                    :key="'think-' + ti"
                    class="thinking-block"
                  >
                    <button class="thinking-toggle" @click="toggleThinking(message.id + '-t' + ti)">
                      <el-icon :size="12"><ArrowRight v-if="!thinkingOpen[message.id + '-t' + ti]" /><ArrowDown v-else /></el-icon>
                      <span>思考过程</span>
                    </button>
                    <div v-if="thinkingOpen[message.id + '-t' + ti]" class="thinking-text">{{ think.text }}</div>
                  </div>
                </template>

                <!-- 工具调用 chip（assistant） -->
                <template v-if="message.role === 'assistant'">
                  <div
                    v-for="part in getToolCallParts(message)"
                    :key="(part as any).toolCallId || (part as any).id"
                    class="tool-call-wrap"
                  >
                    <ToolCallChip :part="part as any" />
                  </div>
                </template>

                <!-- 结构化审查结果 -->
                <template v-if="message.role === 'assistant' && hasIssues(message)">
                  <div
                    v-if="extractIssuesFromMessage(message).beforeText"
                    class="markdown-body markdown-content"
                    v-html="renderMarkdown(extractIssuesFromMessage(message).beforeText)"
                  />
                  <AgentIssueList :issues="extractIssuesFromMessage(message).issues" />
                  <div
                    v-if="extractIssuesFromMessage(message).afterText"
                    class="markdown-body markdown-content"
                    v-html="renderMarkdown(extractIssuesFromMessage(message).afterText)"
                  />
                </template>

                <!-- 普通文本 -->
                <template v-else>
                  <div
                    v-if="message.role === 'assistant'"
                    class="markdown-body markdown-content"
                    v-html="renderMarkdown(getMessageText(message))"
                  />
                  <div v-else class="text-content">{{ getMessageText(message) }}</div>
                </template>

                <!-- 报告下载 -->
                <template v-if="message.role === 'assistant' && extractReportLinks(message).length > 0">
                  <div class="report-actions">
                    <template v-for="(link, i) in extractReportLinks(message)" :key="i">
                      <el-button v-if="link.kind === 'md'" type="primary" size="small" :icon="Download" @click="downloadMd(link.url, link.fileName)">
                        下载 {{ link.fileName }}
                      </el-button>
                      <el-button v-else-if="link.kind === 'pdf'" type="success" size="small" :icon="Printer" @click="openPrintPage(link.url)">
                        打印为 PDF
                      </el-button>
                    </template>
                  </div>
                </template>
              </div>

              <!-- 重新生成按钮 -->
              <div
                v-if="message.role === 'assistant' && idx === messages.length - 1 && !isLoading && messages.length > 0"
                class="message-actions"
              >
                <el-button text size="small" :icon="RefreshRight" @click="handleRegenerate">重新生成</el-button>
              </div>
            </div>
          </div>

          <!-- 打字指示器 -->
          <div v-if="showTypingIndicator" class="message-row assistant">
            <div class="avatar assistant"><span>AI</span></div>
            <div class="bubble assistant typing">
              <span class="dot" />
              <span class="dot" />
              <span class="dot" />
            </div>
          </div>
        </div>

        <!-- 已上传文件 -->
        <div v-if="uploadedFiles.length > 0" class="uploaded-files">
          <div v-for="(f, i) in uploadedFiles" :key="i" class="file-chip">
            <el-icon :size="14"><Document /></el-icon>
            <span class="file-name">{{ f.name }}</span>
            <span class="file-size">{{ formatSize(f.size) }}</span>
            <button class="file-remove" title="移除" @click="uploadedFiles.splice(i, 1)">
              <el-icon :size="12"><Close /></el-icon>
            </button>
          </div>
        </div>

        <!-- 输入栏 -->
        <footer class="input-area">
          <el-upload
            :http-request="customUpload"
            :show-file-list="false"
            :disabled="uploading"
            multiple
            class="upload-btn"
          >
            <el-button :loading="uploading" :icon="Upload" text size="small">上传文件</el-button>
          </el-upload>

          <div class="input-row">
            <el-input
              v-model="inputValue"
              class="input-box"
              type="textarea"
              :autosize="{ minRows: 1, maxRows: 4 }"
              placeholder="输入问题或审查要求…（Enter 发送，Shift+Enter 换行）"
              resize="none"
              @keydown.enter.exact.prevent="handleSend"
              @keydown.shift.enter.exact="() => {}"
            />
            <el-button
              v-if="!isLoading"
              class="send-btn"
              type="primary"
              :icon="Promotion"
              :disabled="!inputValue.trim()"
              @click="handleSend"
            />
            <el-button
              v-else
              class="stop-btn"
              type="danger"
              :icon="VideoPause"
              @click="handleStop"
            >
              停止
            </el-button>
          </div>
        </footer>

        <!-- 拖拽上传遮罩 -->
        <div v-if="isDragOver" class="drop-zone-overlay">
          <div class="drop-zone-icon">
            <el-icon :size="28"><Upload /></el-icon>
          </div>
        </div>
      </div>
    </main>

    <!-- 右侧拖拽分隔条 -->
    <div
      v-if="rightPanelOpen"
      ref="rightSeparatorRef"
      class="panel-resize-handle"
      :class="{ 'is-resizing': rightIsResizing }"
      v-bind="rightSeparatorProps"
    />

    <!-- 右侧：执行追踪面板（可拖拽宽度） -->
    <aside
      ref="rightContainerRef"
      class="right-panel-container"
      :class="[rightPanelOpen ? 'right-panel-open' : 'right-panel-closed', rightIsResizing ? 'right-panel-resizing' : '']"
    >
      <AgentSidePanel :current-session-id="sessionId" />
    </aside>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import {
  ChatLineRound,
  Delete,
  Document,
  Upload,
  Promotion,
  VideoPause,
  RefreshRight,
  Download,
  Printer,
  Close,
  Fold,
  Expand,
  Grid,
  Loading,
  Check,
  MagicStick,
  ArrowRight,
  ArrowDown,
} from '@element-plus/icons-vue'
import type { UIMessage } from 'ai'
import { useAgentChat } from '@/composables/useAgentChat'
import { useMarkdown } from '@/composables/useMarkdown'
import { useResizablePanel } from '@/composables/useResizablePanel'
import { useUserStore } from '@/stores/user'
import { getSessionStatsApi, autoNameSessionApi, type SessionStats } from '@/api/agent'
import ToolCallChip from './components/ToolCallChip.vue'
import AgentIssueList from './components/AgentIssueList.vue'
import AgentSessionList from './components/AgentSessionList.vue'
import AgentSidePanel from './components/AgentSidePanel.vue'
import './agent-theme.css'

const userStore = useUserStore()
const { renderMarkdown } = useMarkdown()
const { messages, sendMessage, stop, regenerate, isLoading, sessionId, loadHistory, clearSession } = useAgentChat()

const sessionListRef = ref<InstanceType<typeof AgentSessionList> | null>(null)

// ===== 可拖拽面板 =====
const sidebarContainerRef = ref<HTMLElement | null>(null)
const rightContainerRef = ref<HTMLElement | null>(null)
const sidebarOpen = ref(true)
const rightPanelOpen = ref(true)

const sidebarPanel = useResizablePanel({
  cssVariable: '--sidebar-width',
  defaultWidth: 260,
  minWidth: 200,
  maxWidth: 480,
  storageKey: 'agent-sidebar-width',
  growthDirection: 'right',
  containerRef: sidebarContainerRef,
})
const rightPanel = useResizablePanel({
  cssVariable: '--right-panel-width',
  defaultWidth: 320,
  minWidth: 300,
  maxWidth: 900,
  storageKey: 'agent-right-panel-width',
  growthDirection: 'left',
  containerRef: rightContainerRef,
})
// 注意：separatorProps 里的事件是 onPointerdown 形式，Vue 模板 v-bind 需要小写
// 这里手动映射为 v-bind 兼容的 props
const sidebarSeparatorProps = computed(() => remapSeparatorProps(sidebarPanel.separatorProps, sidebarPanel.isResizing.value))
const rightSeparatorProps = computed(() => remapSeparatorProps(rightPanel.separatorProps, rightPanel.isResizing.value))
const sidebarIsResizing = sidebarPanel.isResizing
const rightIsResizing = rightPanel.isResizing

function remapSeparatorProps(p: any, resizing: boolean): any {
  return {
    role: p.role,
    'aria-orientation': p['aria-orientation'],
    'aria-label': p['aria-label'],
    'aria-valuemin': p['aria-valuemin'],
    'aria-valuemax': p['aria-valuemax'],
    'aria-valuenow': p['aria-valuenow'],
    'aria-valuetext': p['aria-valuetext'],
    tabindex: p.tabindex,
    onPointerdown: p.onPointerdown,
    onPointermove: p.onPointermove,
    onPointerup: p.onPointerup,
    onPointercancel: p.onPointercancel,
    onLostpointercapture: p.onLostpointercapture,
    onKeydown: p.onKeydown,
    onDblclick: p.onDblclick,
    class: resizing ? 'is-resizing' : '',
  }
}

// ===== thinking 折叠状态 =====
const thinkingOpen = reactive<Record<string, boolean>>({})
function toggleThinking(key: string) {
  thinkingOpen[key] = !thinkingOpen[key]
}
function getThinkingParts(message: UIMessage): Array<{ text: string }> {
  // ai-sdk v4 的 thinking part 类型可能是 'reasoning' 或 'thinking'
  return message.parts
    .filter((p: any) => p?.type === 'reasoning' || p?.type === 'thinking')
    .map((p: any) => ({ text: p.text || p.reasoning || p.reasoningTextDetail || '' }))
}

// ===== token 统计 + 自动命名 =====
const stats = ref<SessionStats | null>(null)
const autoNameStatus = ref<'idle' | 'loading' | 'success' | 'error'>('idle')

const contextUsageClass = computed(() => {
  if (!stats.value?.contextUsage?.percent) return ''
  const p = stats.value.contextUsage.percent
  if (p > 90) return 'stat-danger'
  if (p > 70) return 'stat-warning'
  return ''
})

async function refreshStats() {
  if (!sessionId.value) { stats.value = null; return }
  try {
    const res = await getSessionStatsApi(sessionId.value)
    stats.value = res.data
  } catch { /* 静默失败 */ }
}

async function handleAutoName() {
  if (!sessionId.value || autoNameStatus.value === 'loading') return
  autoNameStatus.value = 'loading'
  try {
    await autoNameSessionApi(sessionId.value)
    autoNameStatus.value = 'success'
    ElMessage.success('会话标题已更新')
    sessionListRef.value?.refresh?.()
    setTimeout(() => { autoNameStatus.value = 'idle' }, 2000)
  } catch (e) {
    autoNameStatus.value = 'error'
    ElMessage.error('自动命名失败：' + (e as Error).message)
    setTimeout(() => { autoNameStatus.value = 'idle' }, 2000)
  }
}

function formatToken(n: number | null | undefined): string {
  if (!n) return '0'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

// ===== 会话切换 =====
async function handleSelectSession(sid: string) {
  try {
    await loadHistory(sid)
    uploadedFiles.value = []
    refreshStats()
    ElMessage.success('已切换到历史会话')
  } catch (e) {
    ElMessage.error('加载会话历史失败：' + (e as Error).message)
  }
}

function handleNewChat() {
  clearSession()
  uploadedFiles.value = []
  stats.value = null
}

const inputValue = ref('')
const messagesContainer = ref<HTMLDivElement | null>(null)
const uploading = ref(false)
const uploadedFiles = ref<Array<{ name: string; size: number; path?: string }>>([])

function getMessageText(message: UIMessage): string {
  return message.parts.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('')
}

function getToolCallParts(message: UIMessage): any[] {
  return message.parts.filter((p: any) => typeof p?.type === 'string' && p.type.startsWith('tool-'))
}

function extractIssuesFromMessage(message: UIMessage): { issues: any[]; beforeText: string; afterText: string } {
  if (message.role !== 'assistant') return { issues: [], beforeText: '', afterText: '' }
  const text = getMessageText(message)
  if (!text) return { issues: [], beforeText: '', afterText: '' }
  const jsonBlockRegex = /```json\s*\n([\s\S]*?)\n```/g
  const matches: { content: string; index: number; endIndex: number }[] = []
  let m: RegExpExecArray | null
  while ((m = jsonBlockRegex.exec(text)) !== null) {
    matches.push({ content: m[1], index: m.index, endIndex: m.index + m[0].length })
  }
  for (const match of matches) {
    try {
      const parsed = JSON.parse(match.content)
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = parsed[0]
        if (first && typeof first === 'object' && ('issueType' in first || 'originalText' in first || 'severity' in first)) {
          return { issues: parsed, beforeText: text.slice(0, match.index).trim(), afterText: text.slice(match.endIndex).trim() }
        }
      }
    } catch { /* ignore */ }
  }
  return { issues: [], beforeText: text, afterText: '' }
}

function hasIssues(message: UIMessage): boolean {
  return extractIssuesFromMessage(message).issues.length > 0
}

interface ReportLink { kind: 'md' | 'pdf'; url: string; fileName?: string }
function extractReportLinks(message: UIMessage): ReportLink[] {
  if (message.role !== 'assistant') return []
  const text = getMessageText(message)
  if (!text) return []
  const links: ReportLink[] = []
  const jsonBlockRegex = /```json\s*\n([\s\S]*?)\n```/g
  let m: RegExpExecArray | null
  while ((m = jsonBlockRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1])
      const objs = Array.isArray(parsed) ? parsed : [parsed]
      for (const obj of objs) {
        if (obj && typeof obj === 'object') {
          if (obj.pdfPrintUrl) links.push({ kind: 'pdf', url: obj.pdfPrintUrl, fileName: obj.fileName })
          else if (obj.downloadUrl) links.push({ kind: 'md', url: obj.downloadUrl, fileName: obj.fileName })
        }
      }
    } catch { /* ignore */ }
  }
  return links
}

function downloadMd(url: string, fileName?: string) {
  const a = document.createElement('a'); a.href = url; a.download = fileName || ''; document.body.appendChild(a); a.click(); document.body.removeChild(a)
}
function openPrintPage(printUrl: string) { window.open(printUrl, '_blank', 'noopener,noreferrer') }

const showTypingIndicator = computed(() => {
  if (!isLoading.value) return false
  const last = messages.value[messages.value.length - 1]
  if (!last || last.role !== 'assistant') return true
  return getMessageText(last).length === 0
})

async function handleSend() {
  const text = inputValue.value.trim()
  if (!text || isLoading.value) return
  inputValue.value = ''
  let finalText = text
  if (uploadedFiles.value.length > 0) {
    const filesInfo = uploadedFiles.value.map(f => f.path ? `${f.name}（路径：${f.path}）` : f.name).join('、')
    finalText = `[已上传文件：${filesInfo}]\n\n${text}`
  }
  await sendMessage({ text: finalText })
  // 发送后刷新会话列表（修复原有 bug：新会话不立即出现）
  sessionListRef.value?.refresh?.()
}

function handleStop() { stop() }
function handleRegenerate() { if (!isLoading.value) regenerate() }

async function customUpload(options: { file: File }) {
  const file = options.file
  uploading.value = true
  try {
    const formData = new FormData(); formData.append('file', file)
    if (sessionId.value) formData.append('sessionId', sessionId.value)
    const res = await fetch('/api/agent/upload', { method: 'POST', headers: { Authorization: `Bearer ${userStore.token}` }, body: formData })
    if (!res.ok) { const errText = await res.text().catch(() => ''); throw new Error(errText || `上传失败 (${res.status})`) }
    const data = await res.json()
    if (data?.data?.sessionId) sessionId.value = data.data.sessionId
    uploadedFiles.value.push({ name: file.name, size: file.size, path: data?.data?.filePath })
    ElMessage.success(`${file.name} 上传成功`)
  } catch (e) {
    ElMessage.error((e as Error)?.message || '上传失败')
  } finally { uploading.value = false }
}

function clearConversation() { clearSession(); uploadedFiles.value = []; stats.value = null }
function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / 1048576).toFixed(1) + 'MB'
}

// ===== 拖拽上传 =====
const isDragOver = ref(false)
let dragCounter = 0
function onDragOver() { /* dragover 需要 preventDefault 才能触发 drop */ }
function onDragLeave(e: DragEvent) {
  // 只有离开整个容器才隐藏遮罩
  if (e.relatedTarget === null) {
    dragCounter = 0
    isDragOver.value = false
  }
}
function onDrop(e: DragEvent) {
  dragCounter = 0
  isDragOver.value = false
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return
  for (const file of Array.from(files)) {
    customUpload({ file })
  }
}

// 消息变化时自动滚动到底部 + 完成后刷新统计
watch(messages, () => {
  nextTick(() => {
    const el = messagesContainer.value
    if (el) el.scrollTop = el.scrollHeight
  })
}, { flush: 'post', deep: false })

// 流式结束时刷新 token 统计
watch(isLoading, (now, prev) => {
  if (prev && !now) {
    refreshStats()
    sessionListRef.value?.refresh?.()
  }
})

// 会话变化时刷新统计
watch(sessionId, () => { refreshStats() })
</script>

<style scoped>
/* ===== 主布局 ===== */
.agent-layout {
  display: flex;
  height: 100%;
  width: 100%;
  background: var(--bg);
  position: relative;
  overflow: hidden;
}

/* ===== 中间列 ===== */
.center-column {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

/* ===== 顶部工具栏 ===== */
.top-toolbar {
  height: var(--toolbar-height, 36px);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  gap: 8px;
}
.toolbar-left, .toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}
.toolbar-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 5px;
  padding: 0;
  transition: background 0.12s, color 0.12s;
}
.toolbar-icon-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}
.toolbar-icon-btn:disabled {
  color: var(--text-dim);
  cursor: not-allowed;
  opacity: 0.6;
}
.toolbar-icon-btn.is-loading .el-icon {
  animation: agent-spin 0.9s linear infinite;
}
.toolbar-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 4px;
}
.title-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.session-badge {
  padding: 1px 6px;
  font-size: 10px;
  color: var(--success);
  background: color-mix(in srgb, var(--success) 12%, var(--bg));
  border-radius: 8px;
  font-weight: 500;
}

/* token 统计 */
.token-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 6px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-muted);
}
.stat-item {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.stat-label {
  color: var(--text-dim);
  font-size: 10px;
}
.stat-total { color: var(--text); font-weight: 600; }
.stat-warning { color: var(--warning); }
.stat-danger { color: var(--danger); }

/* ===== 聊天内容区 ===== */
.chat-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* ===== 消息列表 ===== */
.messages-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px 8px;
  background: var(--bg);
}

/* ===== 空状态 ===== */
.empty-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding-bottom: 80px;
}
.empty-icon {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--accent) 8%, var(--bg));
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
}
.empty-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}
.empty-desc {
  margin: 4px 0 14px;
  font-size: 13px;
  color: var(--text-muted);
}
.empty-hints {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.empty-hints span {
  font-size: 12px;
  color: var(--text-dim);
  padding: 6px 12px;
  background: var(--bg-subtle);
  border-radius: 6px;
  border: 1px dashed var(--border);
}

/* ===== 消息行 ===== */
.message-row {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
  align-items: flex-start;
}
.message-row.user {
  flex-direction: row-reverse;
}
.avatar {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
}
.avatar.user {
  background: var(--accent);
}
.avatar.assistant {
  background: color-mix(in srgb, var(--text) 80%, #555);
}

.bubble-wrap {
  max-width: calc(100% - 50px);
  min-width: 0;
}
.message-row.user .bubble-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.bubble {
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.65;
  word-break: break-word;
}
.bubble.user {
  background: var(--user-bg);
  color: var(--text);
  border-bottom-right-radius: 4px;
}
.bubble.assistant {
  background: var(--assistant-bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-top-left-radius: 4px;
}
.text-content {
  white-space: pre-wrap;
}

/* ===== thinking 折叠块 ===== */
.thinking-block {
  margin-bottom: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-subtle);
}
.thinking-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  border: none;
  background: transparent;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  text-align: left;
}
.thinking-toggle:hover { color: var(--text); }
.thinking-text {
  padding: 6px 12px 10px;
  font-size: 12.5px;
  color: var(--text-muted);
  white-space: pre-wrap;
  border-top: 1px solid var(--border);
}

/* ===== Markdown 内容（主体样式在 agent-theme.css）===== */
.markdown-content { font-size: 14px; line-height: 1.7; }

/* ===== 消息操作 ===== */
.message-actions {
  margin-top: 4px;
  padding-left: 4px;
}

/* ===== 报告操作 ===== */
.report-actions {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* ===== 工具 chip ===== */
.tool-call-wrap {
  margin-bottom: 8px;
}
.tool-call-wrap:last-child {
  margin-bottom: 10px;
}

/* ===== 打字指示器 ===== */
.bubble.typing {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 14px 18px;
  background: var(--bg-subtle);
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-dim);
  animation: agent-typing-bounce 1.3s infinite ease-in-out;
}
.dot:nth-child(2) { animation-delay: 0.15s; }
.dot:nth-child(3) { animation-delay: 0.3s; }

/* ===== 已上传文件 ===== */
.uploaded-files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 20px;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
  flex-shrink: 0;
}
.file-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px 3px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text);
  transition: border-color 0.15s;
}
.file-chip:hover { border-color: var(--text-dim); }
.file-chip .el-icon { color: var(--accent); flex-shrink: 0; }
.file-name { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-size { color: var(--text-dim); font-size: 11px; }
.file-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 1px;
  border-radius: 3px;
}
.file-remove:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, var(--bg)); }

/* ===== 输入区 ===== */
.input-area {
  padding: 10px 20px 14px;
  border-top: 1px solid var(--border);
  background: var(--bg);
  flex-shrink: 0;
}
.upload-btn {
  margin-bottom: 6px;
}
.input-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.input-box {
  flex: 1;
}
.input-box :deep(.el-textarea__inner) {
  border-radius: 10px;
  padding: 9px 13px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  font-size: 14px;
  line-height: 1.5;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.input-box :deep(.el-textarea__inner:focus) {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent);
  background: var(--bg);
}
.send-btn {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  flex-shrink: 0;
  background: var(--accent);
  border-color: var(--accent);
}
.send-btn:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
.send-btn :deep(.el-icon) { margin: 0; }
.stop-btn {
  flex-shrink: 0;
  border-radius: 10px;
  background: var(--danger);
  border-color: var(--danger);
}
</style>
