<template>
  <div class="agent-layout">
    <!-- 左侧：会话列表（Task 17.1）-->
    <aside class="layout-left">
      <AgentSessionList
        ref="sessionListRef"
        :current-session-id="sessionId"
        @select="handleSelectSession"
        @new-chat="handleNewChat"
      />
    </aside>

    <!-- 中间：对话区域 -->
    <main class="layout-center">
      <div class="agent-chat">
    <!-- 顶部标题栏 -->
    <header class="chat-header">
      <div class="header-title">
        <el-icon :size="20" color="#3B82F6"><ChatDotRound /></el-icon>
        <h3>Agent 审查助手</h3>
        <span v-if="sessionId" class="session-tag">会话已绑定</span>
      </div>
      <el-button text :icon="Delete" :disabled="isLoading" @click="clearConversation">
        清空对话
      </el-button>
    </header>

    <!-- 消息列表 -->
    <div ref="messagesContainer" class="messages-container">
      <div v-if="messages.length === 0" class="empty-state">
        <el-icon :size="52" color="#C0C4CC"><ChatLineRound /></el-icon>
        <p class="empty-title">Agent 审查助手</p>
        <p class="empty-desc">上传待审文件，或直接输入问题开始对话</p>
      </div>

      <div
        v-for="(message, idx) in messages"
        :key="message.id"
        class="message-row"
        :class="message.role"
      >
        <div class="avatar">
          <el-avatar
            :size="32"
            :class="message.role === 'user' ? 'avatar-user' : 'avatar-assistant'"
          >
            {{ message.role === 'user' ? '我' : 'AI' }}
          </el-avatar>
        </div>
        <div class="bubble-wrap">
          <div class="bubble" :class="message.role">
            <!-- Task 15：工具调用 chip（按顺序渲染 tool-* parts）-->
            <template v-if="message.role === 'assistant'">
              <div
                v-for="part in getToolCallParts(message)"
                :key="(part as any).toolCallId || (part as any).id"
                class="tool-call-wrap"
              >
                <ToolCallChip :part="part as any" />
              </div>
            </template>

            <!-- Task 16：结构化审查结果卡片（检测 ReviewIssue[] JSON 代码块）-->
            <template v-if="message.role === 'assistant' && hasIssues(message)">
              <div
                v-if="extractIssuesFromMessage(message).beforeText"
                class="markdown-content"
                v-html="renderMarkdown(extractIssuesFromMessage(message).beforeText)"
              ></div>
              <AgentIssueList :issues="extractIssuesFromMessage(message).issues" />
              <div
                v-if="extractIssuesFromMessage(message).afterText"
                class="markdown-content"
                v-html="renderMarkdown(extractIssuesFromMessage(message).afterText)"
              ></div>
            </template>

            <!-- 普通文本内容（无结构化结果时） -->
            <template v-else>
              <div
                v-if="message.role === 'assistant'"
                class="markdown-content"
                v-html="renderMarkdown(getMessageText(message))"
              ></div>
              <div v-else class="text-content">{{ getMessageText(message) }}</div>
            </template>
          </div>
          <div
            v-if="
              message.role === 'assistant' &&
              idx === messages.length - 1 &&
              !isLoading &&
              messages.length > 0
            "
            class="message-actions"
          >
            <el-button text size="small" :icon="RefreshRight" @click="handleRegenerate">
              重新生成
            </el-button>
          </div>
        </div>
      </div>

      <!-- 打字指示器 -->
      <div v-if="showTypingIndicator" class="message-row assistant">
        <div class="avatar">
          <el-avatar :size="32" class="avatar-assistant">AI</el-avatar>
        </div>
        <div class="bubble assistant typing">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      </div>
    </div>

    <!-- 已上传文件 -->
    <div v-if="uploadedFiles.length > 0" class="uploaded-files">
      <div v-for="(f, i) in uploadedFiles" :key="i" class="file-chip">
        <el-icon><Document /></el-icon>
        <span class="file-name">{{ f.name }}</span>
        <span class="file-size">{{ formatSize(f.size) }}</span>
      </div>
    </div>

    <!-- 输入区 -->
    <footer class="input-area">
      <el-upload
        :http-request="customUpload"
        :show-file-list="false"
        :disabled="uploading"
        multiple
      >
        <el-button :loading="uploading" :icon="Upload">上传文件</el-button>
      </el-upload>

      <el-input
        v-model="inputValue"
        class="input-box"
        type="textarea"
        :autosize="{ minRows: 1, maxRows: 6 }"
        placeholder="输入消息，Ctrl + Enter 发送"
        resize="none"
        @keydown.ctrl.enter.prevent="handleSend"
      />

      <el-button
        v-if="!isLoading"
        type="primary"
        :icon="Promotion"
        :disabled="!inputValue.trim()"
        @click="handleSend"
      >
        发送
      </el-button>
      <el-button v-else type="danger" :icon="VideoPause" @click="handleStop">
        停止
      </el-button>
    </footer>
  </div>
    </main>

    <!-- 右侧：执行追踪/文件面板（Task 17.2）-->
    <aside class="layout-right">
      <AgentSidePanel :current-session-id="sessionId" />
    </aside>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import {
  ChatDotRound,
  ChatLineRound,
  Delete,
  Document,
  Upload,
  Promotion,
  VideoPause,
  RefreshRight,
} from '@element-plus/icons-vue'
import type { UIMessage } from 'ai'
import { useAgentChat } from '@/composables/useAgentChat'
import { useMarkdown } from '@/composables/useMarkdown'
import { useUserStore } from '@/stores/user'
import ToolCallChip from './components/ToolCallChip.vue'
import AgentIssueList from './components/AgentIssueList.vue'
import AgentSessionList from './components/AgentSessionList.vue'
import AgentSidePanel from './components/AgentSidePanel.vue'

const userStore = useUserStore()
const { renderMarkdown } = useMarkdown()
const { messages, sendMessage, stop, regenerate, isLoading, sessionId, loadHistory, clearSession } = useAgentChat()

// Task 17：三栏布局 — 会话列表 ref + 切换/新建会话处理
const sessionListRef = ref<InstanceType<typeof AgentSessionList> | null>(null)

async function handleSelectSession(sid: string) {
  // 加载历史会话消息并切换
  try {
    await loadHistory(sid)
    uploadedFiles.value = [] // 清空已上传文件展示（历史会话的临时文件已不在）
    ElMessage.success('已切换到历史会话')
  } catch (e) {
    ElMessage.error('加载会话历史失败：' + (e as Error).message)
  }
}

function handleNewChat() {
  // 清空当前对话状态，开始新会话
  clearSession()
  uploadedFiles.value = []
}

const inputValue = ref('')
const messagesContainer = ref<HTMLDivElement | null>(null)
const uploading = ref(false)
// Task 7.6：保留 filePath，发送消息时附带文件路径信息（前端补充方案）
const uploadedFiles = ref<Array<{ name: string; size: number; path?: string }>>([])

/** 从 UIMessage 的 parts 中提取所有文本片段并拼接 */
function getMessageText(message: UIMessage): string {
  return message.parts
    .filter(p => p.type === 'text')
    .map(p => (p as { text: string }).text)
    .join('')
}

/**
 * Task 15：提取 message.parts 中的工具调用部分
 * Vercel AI SDK v7 的 tool-* part 类型：'tool-input-streaming' / 'tool-input-available' / 'tool-output-available' / 'tool-output-error'
 * 统一通过 type 前缀 'tool-' 匹配
 */
function getToolCallParts(message: UIMessage): any[] {
  return message.parts.filter((p: any) => typeof p?.type === 'string' && p.type.startsWith('tool-'))
}

/**
 * Task 16：从 assistant 消息文本中提取 ReviewIssue[] JSON
 *
 * 检测策略：
 * 1. 扫描 ```json 代码块
 * 2. 尝试 JSON.parse，判断是否为数组
 * 3. 数组首项含 issueType/originalText/severity 等字段之一 → 视为审查结果
 *
 * 返回：{ issues, beforeText, afterText } — issues 为空数组时表示无结构化结果
 */
function extractIssuesFromMessage(message: UIMessage): {
  issues: any[]
  beforeText: string
  afterText: string
} {
  if (message.role !== 'assistant') {
    return { issues: [], beforeText: '', afterText: '' }
  }

  const text = getMessageText(message)
  if (!text) return { issues: [], beforeText: '', afterText: '' }

  // 匹配所有 ```json ... ``` 代码块
  const jsonBlockRegex = /```json\s*\n([\s\S]*?)\n```/g
  const matches: { content: string; index: number; endIndex: number }[] = []
  let m: RegExpExecArray | null
  while ((m = jsonBlockRegex.exec(text)) !== null) {
    matches.push({
      content: m[1],
      index: m.index,
      endIndex: m.index + m[0].length,
    })
  }

  // 找到第一个能解析为 ReviewIssue[] 的 JSON 块
  for (const match of matches) {
    try {
      const parsed = JSON.parse(match.content)
      if (Array.isArray(parsed) && parsed.length > 0) {
        // 检测首项是否像 ReviewIssue（含 issueType 或 originalText 字段）
        const first = parsed[0]
        if (first && typeof first === 'object' && ('issueType' in first || 'originalText' in first || 'severity' in first)) {
          return {
            issues: parsed,
            beforeText: text.slice(0, match.index).trim(),
            afterText: text.slice(match.endIndex).trim(),
          }
        }
      }
    } catch {
      // JSON 解析失败，继续尝试下一个块
    }
  }

  return { issues: [], beforeText: text, afterText: '' }
}

/** 判断消息是否含结构化审查结果 */
function hasIssues(message: UIMessage): boolean {
  return extractIssuesFromMessage(message).issues.length > 0
}

/** 打字指示器：加载中且（无最后助手消息或其文本为空） */
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
  // Task 7.6：发送消息时，如果有已上传文件，在消息内容前附带文件信息
  // 作为后端 systemPrompt 注入的补充，提升用户体验（用户可见 Agent 收到了哪些文件）
  let finalText = text
  if (uploadedFiles.value.length > 0) {
    const filesInfo = uploadedFiles.value
      .map(f => (f.path ? `${f.name}（路径：${f.path}）` : f.name))
      .join('、')
    finalText = `[已上传文件：${filesInfo}]\n\n${text}`
  }
  await sendMessage({ text: finalText })
}

function handleStop() {
  stop()
}

function handleRegenerate() {
  if (!isLoading.value) regenerate()
}

/** el-upload 自定义请求：用 fetch 直接调 /api/agent/upload */
async function customUpload(options: { file: File }) {
  const file = options.file
  uploading.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)
    if (sessionId.value) {
      formData.append('sessionId', sessionId.value)
    }
    const res = await fetch('/api/agent/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userStore.token}`,
      },
      body: formData,
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(errText || `上传失败 (${res.status})`)
    }
    const data = await res.json()
    // Task 7.6：修正 sessionId 取值路径（路由返回 { success, data: { sessionId } }）
    if (data?.data?.sessionId) {
      sessionId.value = data.data.sessionId
    }
    // Task 7.6：保留 filePath，发送消息时附带文件路径信息
    uploadedFiles.value.push({
      name: file.name,
      size: file.size,
      path: data?.data?.filePath,
    })
    ElMessage.success(`${file.name} 上传成功`)
  } catch (e) {
    ElMessage.error((e as Error)?.message || '上传失败')
  } finally {
    uploading.value = false
  }
}

function clearConversation() {
  clearSession()
  uploadedFiles.value = []
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

// 消息变化时自动滚动到底部（流式更新也会触发）
watch(
  messages,
  () => {
    nextTick(() => {
      const el = messagesContainer.value
      if (el) el.scrollTop = el.scrollHeight
    })
  },
  { flush: 'post' },
)
</script>

<style scoped>
/* ===== Task 17：三栏布局 ===== */
.agent-layout {
  display: flex;
  height: 100%;
  width: 100%;
  background: #f3f4f6;
  gap: 0;
}

.layout-left {
  width: 260px;
  flex-shrink: 0;
  height: 100%;
}

.layout-center {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 8px;
}

.layout-right {
  width: 320px;
  flex-shrink: 0;
  height: 100%;
}

.agent-chat {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  overflow: hidden;
}

/* ===== 顶部标题栏 ===== */
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #ebeef5;
  background: #ffffff;
  flex-shrink: 0;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-title h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
}

.session-tag {
  margin-left: 4px;
  padding: 1px 8px;
  font-size: 11px;
  color: #047857;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  border-radius: 10px;
}

/* ===== 消息列表 ===== */
.messages-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  background: #fafafa;
}

.empty-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #9ca3af;
}

.empty-title {
  margin: 8px 0 0;
  font-size: 16px;
  font-weight: 600;
  color: #6b7280;
}

.empty-desc {
  margin: 0;
  font-size: 13px;
  color: #9ca3af;
}

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
}

.avatar-user {
  background: #3b82f6;
  color: #ffffff;
  font-weight: 600;
  font-size: 12px;
}

.avatar-assistant {
  background: #111827;
  color: #ffffff;
  font-weight: 600;
  font-size: 12px;
}

.bubble-wrap {
  max-width: 72%;
  display: flex;
  flex-direction: column;
}

.message-row.user .bubble-wrap {
  align-items: flex-end;
}

.bubble {
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}

.bubble.user {
  background: #e6f0ff;
  color: #1f2937;
}

.bubble.assistant {
  background: #ffffff;
  color: #1f2937;
  border: 1px solid #ebeef5;
}

.text-content {
  white-space: pre-wrap;
}

/* Markdown 内容样式 */
.markdown-content :deep(p) {
  margin: 0 0 8px;
}

.markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-content :deep(pre) {
  background: #1f2937;
  color: #e5e7eb;
  padding: 10px 12px;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 13px;
}

.markdown-content :deep(code) {
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 13px;
}

.markdown-content :deep(:not(pre) > code) {
  background: #f3f4f6;
  padding: 1px 5px;
  border-radius: 4px;
  color: #db2777;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 0 0 8px;
  padding-left: 22px;
}

.markdown-content :deep(li) {
  margin: 2px 0;
}

.markdown-content :deep(a) {
  color: #2563eb;
  text-decoration: none;
}

.markdown-content :deep(a:hover) {
  text-decoration: underline;
}

.markdown-content :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 13px;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid #e5e7eb;
  padding: 6px 10px;
}

.markdown-content :deep(th) {
  background: #f9fafb;
}

.message-actions {
  margin-top: 4px;
}

/* ===== Task 15：工具调用 chip ===== */
.tool-call-wrap {
  margin-bottom: 6px;
}

.tool-call-wrap:last-child {
  margin-bottom: 8px;
}

/* ===== 打字指示器 ===== */
.bubble.typing {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 14px 16px;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #9ca3af;
  animation: typing-bounce 1.2s infinite ease-in-out;
}

.dot:nth-child(2) {
  animation-delay: 0.2s;
}

.dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing-bounce {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.5;
  }
  30% {
    transform: translateY(-5px);
    opacity: 1;
  }
}

/* ===== 已上传文件 ===== */
.uploaded-files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 16px;
  border-top: 1px solid #ebeef5;
  background: #ffffff;
  flex-shrink: 0;
}

.file-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 12px;
  color: #4b5563;
}

.file-chip .el-icon {
  color: #3b82f6;
}

.file-name {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  color: #9ca3af;
}

/* ===== 输入区 ===== */
.input-area {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid #ebeef5;
  background: #ffffff;
  flex-shrink: 0;
}

.input-box {
  flex: 1;
}

.input-area :deep(.el-textarea__inner) {
  border-radius: 8px;
  box-shadow: 0 0 0 1px #e5e7eb inset;
}

.input-area :deep(.el-textarea__inner:focus) {
  box-shadow: 0 0 0 1px #3b82f6 inset;
}
</style>
