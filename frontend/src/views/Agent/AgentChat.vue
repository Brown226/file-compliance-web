<template>
  <div class="agent-layout">
    <!-- 左侧：会话列表 -->
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
          <div class="header-left">
            <div class="header-icon">
              <el-icon :size="18"><ChatDotRound /></el-icon>
            </div>
            <div class="header-text">
              <h3>Agent 审查助手</h3>
              <span v-if="sessionId" class="session-tag">会话已绑定</span>
            </div>
          </div>
          <div class="header-actions">
            <el-button text size="small" :disabled="isLoading || messages.length === 0" @click="clearConversation">
              <el-icon :size="14"><Delete /></el-icon>
              <span>清空对话</span>
            </el-button>
          </div>
        </header>

        <!-- 消息列表 -->
        <div ref="messagesContainer" class="messages-container">
          <div v-if="messages.length === 0" class="empty-state">
            <div class="empty-icon">
              <el-icon :size="40"><ChatLineRound /></el-icon>
            </div>
            <p class="empty-title">开始新的审查</p>
            <p class="empty-desc">上传待审文件，或直接描述你想要审查的内容</p>
            <div class="empty-hints">
              <span>💡 试试：帮我审查这份合同的付款条款</span>
              <span>💡 试试：检查这份规章是否符合 GB/T 标准</span>
            </div>
          </div>

          <div
            v-for="(message, idx) in messages"
            :key="message.id"
            class="message-row"
            :class="message.role"
          >
            <div class="avatar">
              <el-avatar :size="34" :class="message.role === 'user' ? 'avatar-user' : 'avatar-assistant'">
                {{ message.role === 'user' ? '我' : 'AI' }}
              </el-avatar>
            </div>
            <div class="bubble-wrap">
              <div class="bubble" :class="message.role">
                <!-- 工具调用 chip -->
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
                    class="markdown-content"
                    v-html="renderMarkdown(extractIssuesFromMessage(message).beforeText)"
                  />
                  <AgentIssueList :issues="extractIssuesFromMessage(message).issues" />
                  <div
                    v-if="extractIssuesFromMessage(message).afterText"
                    class="markdown-content"
                    v-html="renderMarkdown(extractIssuesFromMessage(message).afterText)"
                  />
                </template>

                <!-- 普通文本 -->
                <template v-else>
                  <div
                    v-if="message.role === 'assistant'"
                    class="markdown-content"
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
            <div class="avatar">
              <el-avatar :size="34" class="avatar-assistant">AI</el-avatar>
            </div>
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

        <!-- 输入区 -->
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
              placeholder="输入问题或审查要求…"
              resize="none"
              @keydown.enter.exact.prevent="handleSend"
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
              停止生成
            </el-button>
          </div>
        </footer>
      </div>
    </main>

    <!-- 右侧：执行追踪面板 -->
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
  Download,
  Printer,
  Close,
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

const sessionListRef = ref<InstanceType<typeof AgentSessionList> | null>(null)

async function handleSelectSession(sid: string) {
  try {
    await loadHistory(sid)
    uploadedFiles.value = []
    ElMessage.success('已切换到历史会话')
  } catch (e) {
    ElMessage.error('加载会话历史失败：' + (e as Error).message)
  }
}

function handleNewChat() {
  clearSession()
  uploadedFiles.value = []
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

function clearConversation() { clearSession(); uploadedFiles.value = [] }
function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / 1048576).toFixed(1) + 'MB'
}

watch(messages, () => nextTick(() => {
  const el = messagesContainer.value
  if (el) el.scrollTop = el.scrollHeight
}), { flush: 'post' })
</script>

<style scoped>
/* ===== 三栏布局 ===== */
.agent-layout {
  display: flex;
  height: 100%;
  width: 100%;
  background: #f5f6f8;
  gap: 0;
}

.layout-left {
  width: 260px;
  flex-shrink: 0;
  height: 100%;
  background: #fafbfc;
  border-right: 1px solid #e8eaf0;
}

.layout-center {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  justify-content: center;
}

.layout-right {
  width: 300px;
  flex-shrink: 0;
  height: 100%;
  border-left: 1px solid #e8eaf0;
}

/* ===== 对话框容器 ===== */
.agent-chat {
  width: 100%;
  max-width: 800px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #fff;
}

/* ===== 顶部标题栏 ===== */
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid #f0f0f4;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-icon {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: linear-gradient(135deg, #4f6ef7 0%, #6c8cff 100%);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-text {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-text h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #1a1a2e;
  letter-spacing: -0.01em;
}

.session-tag {
  padding: 2px 8px;
  font-size: 11px;
  color: #059669;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  border-radius: 10px;
  font-weight: 500;
}

.header-actions {
  display: flex;
  gap: 4px;
}

/* ===== 消息列表 ===== */
.messages-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 20px 8px;
  background: #fff;
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
  width: 72px;
  height: 72px;
  border-radius: 20px;
  background: linear-gradient(135deg, #f0f2ff 0%, #e8ecff 100%);
  color: #7c8dfc;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
}

.empty-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: #2a2a3e;
}

.empty-desc {
  margin: 4px 0 16px;
  font-size: 13px;
  color: #9a9aae;
}

.empty-hints {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.empty-hints span {
  font-size: 12px;
  color: #b0b0c0;
  padding: 6px 12px;
  background: #f8f9fc;
  border-radius: 6px;
  border: 1px dashed #e0e0ec;
}

/* ===== 消息行 ===== */
.message-row {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  align-items: flex-start;
}

.message-row.user {
  flex-direction: row-reverse;
}

.avatar {
  flex-shrink: 0;
  padding-top: 1px;
}

.avatar-user {
  background: linear-gradient(135deg, #4f6ef7 0%, #6c8cff 100%);
  color: #fff;
  font-weight: 600;
  font-size: 13px;
}

.avatar-assistant {
  background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
  color: #fff;
  font-weight: 600;
  font-size: 13px;
}

.bubble-wrap {
  max-width: calc(100% - 60px);
  min-width: 0;
}

.message-row.user .bubble-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.bubble {
  padding: 12px 16px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.65;
  word-break: break-word;
}

.bubble.user {
  background: #f0f2f5;
  color: #1a1a2e;
  border-bottom-right-radius: 4px;
}

.bubble.assistant {
  color: #1a1a2e;
}

.text-content {
  white-space: pre-wrap;
}

/* ===== Markdown ===== */
.markdown-content :deep(p) { margin: 0 0 8px; }
.markdown-content :deep(p:last-child) { margin-bottom: 0; }
.markdown-content :deep(pre) {
  background: #1a1b26;
  color: #c0caf5;
  padding: 14px 16px;
  border-radius: 10px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.55;
  margin: 8px 0;
}
.markdown-content :deep(code) {
  font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Menlo', 'Consolas', monospace;
  font-size: 13px;
}
.markdown-content :deep(:not(pre) > code) {
  background: #f0f2f5;
  padding: 2px 6px;
  border-radius: 4px;
  color: #e5484d;
  font-size: 12.5px;
}
.markdown-content :deep(ul), .markdown-content :deep(ol) { margin: 0 0 8px; padding-left: 22px; }
.markdown-content :deep(li) { margin: 3px 0; }
.markdown-content :deep(a) { color: #4f6ef7; text-decoration: none; }
.markdown-content :deep(a:hover) { text-decoration: underline; }
.markdown-content :deep(table) { border-collapse: collapse; margin: 8px 0; font-size: 13px; }
.markdown-content :deep(th), .markdown-content :deep(td) { border: 1px solid #e8eaf0; padding: 7px 12px; }
.markdown-content :deep(th) { background: #fafbfc; font-weight: 600; }
.markdown-content :deep(h1), .markdown-content :deep(h2), .markdown-content :deep(h3) { margin: 12px 0 6px; }
.markdown-content :deep(h1) { font-size: 17px; }
.markdown-content :deep(h2) { font-size: 15px; }
.markdown-content :deep(h3) { font-size: 14px; }

/* ===== 消息操作 ===== */
.message-actions {
  margin-top: 4px;
  padding-left: 4px;
}

/* ===== 报告操作 ===== */
.report-actions {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #f0f0f4;
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
  padding: 16px 20px;
  background: #f8f9fc;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #c0c0d0;
  animation: typing-bounce 1.3s infinite ease-in-out;
}
.dot:nth-child(2) { animation-delay: 0.15s; }
.dot:nth-child(3) { animation-delay: 0.3s; }
@keyframes typing-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-5px); opacity: 1; }
}

/* ===== 已上传文件 ===== */
.uploaded-files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 20px;
  border-top: 1px solid #f0f0f4;
  background: #fafbfc;
  flex-shrink: 0;
}
.file-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px 4px 10px;
  background: #fff;
  border: 1px solid #e0e0ec;
  border-radius: 8px;
  font-size: 12px;
  color: #4a4a5e;
  transition: border-color 0.15s;
}
.file-chip:hover { border-color: #c0c0d0; }
.file-chip .el-icon { color: #4f6ef7; flex-shrink: 0; }
.file-name { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-size { color: #a0a0b0; font-size: 11px; }
.file-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: #c0c0d0;
  cursor: pointer;
  padding: 1px;
  border-radius: 3px;
}
.file-remove:hover { color: #e5484d; background: #fef0f0; }

/* ===== 输入区 ===== */
.input-area {
  padding: 12px 20px;
  border-top: 1px solid #f0f0f4;
  background: #fff;
  flex-shrink: 0;
}
.upload-btn {
  margin-bottom: 8px;
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
  border-radius: 12px;
  padding: 10px 14px;
  background: #f8f9fc;
  border: 1px solid #e8eaf0;
  font-size: 14px;
  line-height: 1.5;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.input-box :deep(.el-textarea__inner:focus) {
  border-color: #4f6ef7;
  box-shadow: 0 0 0 3px rgba(79, 110, 247, 0.1);
  background: #fff;
}
.send-btn {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  flex-shrink: 0;
}
.send-btn :deep(.el-icon) {
  margin: 0;
}
.stop-btn {
  flex-shrink: 0;
  border-radius: 10px;
}
</style>
