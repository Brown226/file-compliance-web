<template>
  <div class="qa-page">
    <div class="qa-shell">
      <!-- 头部 -->
      <div class="qa-header">
        <div class="qa-header-left">
          <h2>智能问答</h2>
          <p class="qa-subtitle">基于知识库的标准规范、法律法规和审查规则回答您的问题</p>
        </div>
        <div class="qa-header-right">
          <el-button type="primary" link @click="createSession">
            <el-icon><Plus /></el-icon> 新对话
          </el-button>
        </div>
      </div>

      <div class="qa-body">
        <!-- 侧边会话列表 -->
        <div class="session-sidebar">
          <div class="session-list">
            <div
              v-for="session in sessions"
              :key="session.id"
              :class="['session-item', { active: currentSessionId === session.id }]"
              @click="switchSession(session.id)"
            >
              <span class="session-title">{{ session.title || '新对话' }}</span>
              <el-button
                type="danger"
                link
                size="small"
                class="session-delete"
                @click.stop="deleteSession(session.id)"
              >
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
            <div v-if="sessions.length === 0" class="session-empty">暂无会话</div>
          </div>
        </div>

        <!-- 聊天区域 -->
        <div class="chat-area">
          <div ref="chatContainer" class="chat-messages">
            <div v-if="messages.length === 0" class="chat-empty">
              <p class="chat-empty-title">输入一个具体问题</p>
              <p>例如：GB/T 50265 中对泵站厂房有什么要求？核电站防火设计有哪些规范？</p>
            </div>

            <div v-for="(msg, index) in messages" :key="index" :class="['message-row', msg.role]">
              <div class="message-bubble">
                <p class="role-label">{{ msg.role === 'user' ? '你' : 'AI 助手' }}</p>
                <div class="message-content" v-html="renderMarkdown(msg.content || '正在生成...')"></div>
              </div>
            </div>

            <div v-if="isLoading" class="stream-indicator">
              <span></span><span></span><span></span>
              <p>正在检索知识库并生成回答...</p>
            </div>
          </div>

          <!-- 输入框 -->
          <div class="composer">
            <el-input
              v-model="inputQuestion"
              type="textarea"
              :rows="2"
              placeholder="输入问题，Enter 发送，Shift + Enter 换行"
              resize="none"
              :disabled="isLoading"
              @keydown.enter.prevent="handleEnter"
            />
            <el-button
              type="primary"
              :disabled="!inputQuestion.trim() || isLoading"
              :loading="isLoading"
              @click="askQuestion"
            >
              发送
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { Plus, Delete } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { useMarkdown } from '@/composables/useMarkdown'
import {
  getQASessionsApi,
  createQASessionApi,
  deleteQASessionApi,
  getQAHistoryApi,
  getQAStreamUrl,
} from '@/api/qa'

const userStore = useUserStore()
const inputQuestion = ref('')
const messages = ref<any[]>([])
const isLoading = ref(false)
const sessions = ref<any[]>([])
const currentSessionId = ref('')
const chatContainer = ref<HTMLElement | null>(null)

const { renderMarkdown } = useMarkdown()

const scrollToBottom = async () => {
  await nextTick()
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight
  }
}

const loadSessions = async () => {
  try {
    const { data } = await getQASessionsApi()
    sessions.value = data || []
  } catch (e) {
    console.error(e)
  }
}

const createSession = async () => {
  try {
    const { data } = await createQASessionApi()
    sessions.value.unshift(data)
    currentSessionId.value = data.id
    messages.value = []
  } catch (e) {
    ElMessage.error('创建会话失败')
  }
}

const switchSession = async (sessionId: string) => {
  currentSessionId.value = sessionId
  try {
    const { data } = await getQAHistoryApi(sessionId)
    messages.value = data || []
    scrollToBottom()
  } catch (e) {
    messages.value = []
  }
}

const deleteSession = async (sessionId: string) => {
  try {
    await deleteQASessionApi(sessionId)
    sessions.value = sessions.value.filter(s => s.id !== sessionId)
    if (currentSessionId.value === sessionId) {
      currentSessionId.value = ''
      messages.value = []
    }
  } catch (e) {
    ElMessage.error('删除失败')
  }
}

const buildRequestHistory = () => messages.value
  .filter(m => ['user', 'assistant'].includes(m.role) && String(m.content || '').trim())
  .slice(-12)
  .map(m => ({ role: m.role, content: String(m.content || '').slice(0, 4000) }))

const parseSseEvent = (eventText: string) => {
  const eventLine = eventText.split('\n').find(line => line.startsWith('event:'))
  const dataLines = eventText.split('\n').filter(line => line.startsWith('data:')).map(line => line.replace('data:', '').trim())
  if (!dataLines.length) return null
  return {
    event: eventLine?.replace('event:', '').trim(),
    data: JSON.parse(dataLines.join('\n')),
  }
}

const askQuestion = async () => {
  if (!inputQuestion.value.trim() || isLoading.value) return

  const question = inputQuestion.value.trim()
  const history = buildRequestHistory()
  inputQuestion.value = ''

  // 如果没有会话，先创建
  if (!currentSessionId.value) {
    await createSession()
  }

  messages.value.push({ role: 'user', content: question })
  const assistantMessage = { role: 'assistant', content: '' }
  messages.value.push(assistantMessage)
  await scrollToBottom()

  isLoading.value = true
  try {
    const token = userStore.token
    const response = await fetch(getQAStreamUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        question,
        sessionId: currentSessionId.value,
        history,
      }),
    })

    if (!response.ok || !response.body) throw new Error('STREAM_FAILED')

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() || ''

      for (const eventText of events) {
        const parsed = parseSseEvent(eventText)
        if (!parsed) continue

        if (parsed.event === 'meta' && parsed.data.sessionId) {
          currentSessionId.value = parsed.data.sessionId
        }
        if (parsed.event === 'delta') {
          assistantMessage.content += parsed.data.content || ''
          scrollToBottom()
        }
        if (parsed.event === 'done' && parsed.data.answer) {
          assistantMessage.content = parsed.data.answer
        }
        if (parsed.event === 'error') throw new Error(parsed.data.error || 'STREAM_FAILED')
      }
    }

    if (!assistantMessage.content.trim()) assistantMessage.content = '未收到有效回答。'
    loadSessions() // 刷新会话列表（标题可能更新了）
  } catch (e) {
    ElMessage.error('问答请求失败，请稍后重试')
    assistantMessage.content = '抱歉，我现在无法回答您的问题。'
  } finally {
    isLoading.value = false
    scrollToBottom()
  }
}

const handleEnter = (event: KeyboardEvent) => {
  if (!event.shiftKey) askQuestion()
}

onMounted(() => {
  loadSessions()
})
</script>

<style scoped>
.qa-page {
  height: calc(100vh - 120px);
  min-height: 500px;
}

.qa-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.qa-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.qa-header-left h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 4px;
  color: var(--corp-text-primary);
}

.qa-subtitle {
  font-size: 13px;
  color: var(--corp-text-secondary);
  margin: 0;
}

.qa-body {
  flex: 1;
  display: flex;
  gap: 16px;
  min-height: 0;
}

/* 侧边栏 */
.session-sidebar {
  width: 220px;
  flex-shrink: 0;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
}

.session-list {
  height: 100%;
  overflow-y: auto;
  padding: 8px;
}

.session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--corp-text-primary);
  transition: background 0.15s;
}

.session-item:hover {
  background: #f1f5f9;
}

.session-item.active {
  background: var(--color-primary-50);
  color: var(--corp-primary);
  font-weight: 500;
}

.session-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-delete {
  opacity: 0;
  flex-shrink: 0;
}

.session-item:hover .session-delete {
  opacity: 1;
}

.session-empty {
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
  padding: 24px 0;
}

/* 聊天区域 */
.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  min-width: 0;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.chat-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
}

.chat-empty-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--corp-text-primary);
  margin: 0 0 8px;
}

.message-row {
  margin-bottom: 16px;
  display: flex;
}

.message-row.user {
  justify-content: flex-end;
}

.message-row.assistant {
  justify-content: flex-start;
}

.message-bubble {
  max-width: min(720px, 80%);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  line-height: 1.6;
}

.message-row.user .message-bubble {
  background: var(--corp-primary);
  color: #fff;
}

.message-row.assistant .message-bubble {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  color: var(--corp-text-primary);
}

.role-label {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 600;
  opacity: 0.7;
}

.message-content :deep(code) {
  background: rgba(0, 0, 0, 0.06);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
}

.message-content :deep(strong) {
  font-weight: 600;
}

.stream-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 0;
  color: #94a3b8;
  font-size: 12px;
}

.stream-indicator span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--corp-primary);
  animation: pulse 1s infinite ease-in-out;
}

.stream-indicator span:nth-child(2) { animation-delay: 0.15s; }
.stream-indicator span:nth-child(3) { animation-delay: 0.3s; }

@keyframes pulse {
  0%, 100% { transform: translateY(0); opacity: 0.35; }
  50% { transform: translateY(-3px); opacity: 1; }
}

.composer {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #e2e8f0;
  align-items: flex-end;
}

.composer .el-textarea {
  flex: 1;
}

@media (max-width: 768px) {
  .session-sidebar { display: none; }
  .qa-page { height: auto; min-height: calc(100vh - 120px); }
}
</style>
