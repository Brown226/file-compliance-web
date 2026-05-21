<template>
  <div class="qa-page">
    <div class="qa-shell">
      <aside class="session-panel">
        <div class="session-panel__header">
          <h2>会话管理</h2>
          <el-button class="new-session-btn" type="primary" plain @click="createSession">
            <el-icon><Plus /></el-icon>
            新建会话
          </el-button>
        </div>

        <div v-if="sessions.length > 0" class="session-list">
          <button
            v-for="session in sessions"
            :key="session.id"
            type="button"
            :class="['session-item', { active: currentSessionId === session.id }]"
            @click="switchSession(session.id)"
          >
            <div class="session-item__accent">
              <el-icon><ChatDotRound /></el-icon>
            </div>
            <div class="session-item__content">
              <div class="session-item__top">
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
              <div class="session-item__meta">
                <span>{{ getSessionMessageCount(session) }}</span>
                <span>{{ formatSessionTime(session.updatedAt) }}</span>
              </div>
            </div>
          </button>
        </div>

        <div v-else class="session-empty">
          <div class="session-empty__icon">
            <el-icon><Document /></el-icon>
          </div>
          <h3>暂无会话</h3>
          <p>先新建一个会话，再开始提问。</p>
          <el-button class="session-empty__action" type="primary" @click="createSession">
            新建会话
          </el-button>
        </div>
      </aside>

      <section class="chat-panel">
        <div class="chat-panel__header">
          <div>
            <h2>{{ activeSessionTitle }}</h2>
            <p class="chat-panel__subtitle">{{ messages.length }} 条消息</p>
          </div>
        </div>

        <div ref="chatContainer" class="chat-messages">
          <div v-if="!hasMessages" class="chat-empty-stage">
            <div class="chat-empty-card">
              <h3>先写清标准编号与核查对象</h3>
              <p>问题越具体，回答越稳定。建议直接写明标准编号、专业对象和核查目标。</p>
              <div class="chat-empty-grid">
                <button
                  v-for="prompt in examplePrompts"
                  :key="prompt"
                  type="button"
                  class="prompt-card"
                  @click="selectExamplePrompt(prompt)"
                >
                  {{ prompt }}
                </button>
              </div>
            </div>
          </div>

          <div v-else class="message-list">
            <div class="message-stage">
              <div
                v-for="(msg, index) in messages"
                :key="msg.id || index"
                :class="['message-row', msg.role === 'user' ? 'user' : 'assistant']"
              >
                <div class="message-avatar">
                  {{ msg.role === 'user' ? '问' : 'AI' }}
                </div>

                <div class="message-card">
                  <div class="message-card__meta">
                    <span class="message-author">
                      {{ msg.role === 'user' ? '您的提问' : 'AI 助手回答' }}
                    </span>
                    <span class="message-separator"></span>
                    <span class="message-index">第 {{ index + 1 }} 条</span>
                  </div>

                  <div
                    class="message-content"
                    v-html="renderMarkdown(msg.content || '正在生成回答...')"
                  ></div>
                </div>
              </div>

              <div v-if="isLoading" class="stream-indicator">
                <span></span>
                <span></span>
                <span></span>
                <p>正在检索知识库并持续生成回答</p>
              </div>
            </div>
          </div>
        </div>

        <footer class="composer-panel">
          <div class="composer-panel__body">
            <el-input
              v-model="inputQuestion"
              type="textarea"
              :autosize="{ minRows: 3, maxRows: 6 }"
              placeholder="请输入具体问题，例如：GB/T 50265 中对泵站厂房的防火分区和疏散要求有哪些？"
              resize="none"
              :disabled="isLoading"
              @keydown.enter="handleEnter"
            />

            <el-button
              class="send-btn"
              type="primary"
              :disabled="!canSend"
              :loading="isLoading"
              @click="askQuestion"
            >
              <el-icon><Position /></el-icon>
              发送
            </el-button>
          </div>
        </footer>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { ChatDotRound, Delete, Document, Plus, Position } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { useMarkdown } from '@/composables/useMarkdown'
import {
  createQASessionApi,
  deleteQASessionApi,
  getQAHistoryApi,
  getQASessionsApi,
  getQAStreamUrl,
  type QAMessage,
  type QASession,
} from '@/api/qa'

type ChatMessage = Partial<QAMessage> & {
  role: 'user' | 'assistant' | 'system'
  content: string
}

const userStore = useUserStore()
const { renderMarkdown } = useMarkdown()

const inputQuestion = ref('')
const messages = ref<ChatMessage[]>([])
const isLoading = ref(false)
const sessions = ref<QASession[]>([])
const currentSessionId = ref('')
const chatContainer = ref<HTMLElement | null>(null)

const examplePrompts = [
  'GB/T 50265 中对泵站厂房的防火分区和疏散要求有哪些？',
  '核电站防火设计中，电缆竖井和电缆夹层应重点核查哪些条款？',
]

const hasMessages = computed(() => messages.value.length > 0)
const canSend = computed(() => Boolean(inputQuestion.value.trim()) && !isLoading.value)

const activeSession = computed(() =>
  sessions.value.find(session => session.id === currentSessionId.value) || null,
)

const activeSessionTitle = computed(() => activeSession.value?.title || '新对话')

const scrollToBottom = async () => {
  await nextTick()
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight
  }
}

const formatSessionTime = (time: string) => {
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const getSessionMessageCount = (session: QASession) => {
  const count = session._count?.messages ?? 0
  return count > 0 ? `${count} 条消息` : '等待提问'
}

const loadSessions = async () => {
  try {
    const { data } = await getQASessionsApi()
    sessions.value = data || []

    const hasCurrentSession = sessions.value.some(session => session.id === currentSessionId.value)
    if (!hasCurrentSession) {
      if (sessions.value.length > 0) {
        await switchSession(sessions.value[0].id)
      } else {
        currentSessionId.value = ''
        messages.value = []
      }
    }
  } catch (error) {
    console.error(error)
  }
}

const createSession = async () => {
  try {
    const { data } = await createQASessionApi()
    sessions.value = [data, ...sessions.value.filter(session => session.id !== data.id)]
    currentSessionId.value = data.id
    messages.value = []
    await scrollToBottom()
    return data
  } catch (error) {
    ElMessage.error('创建会话失败，请稍后重试')
    return null
  }
}

const switchSession = async (sessionId: string) => {
  if (!sessionId) return
  currentSessionId.value = sessionId

  try {
    const { data } = await getQAHistoryApi(sessionId)
    messages.value = (data || []) as ChatMessage[]
    await scrollToBottom()
  } catch (error) {
    messages.value = []
  }
}

const deleteSession = async (sessionId: string) => {
  try {
    await deleteQASessionApi(sessionId)
    sessions.value = sessions.value.filter(session => session.id !== sessionId)

    if (currentSessionId.value === sessionId) {
      if (sessions.value.length > 0) {
        await switchSession(sessions.value[0].id)
      } else {
        currentSessionId.value = ''
        messages.value = []
      }
    }
  } catch (error) {
    ElMessage.error('删除会话失败，请稍后重试')
  }
}

const selectExamplePrompt = (prompt: string) => {
  inputQuestion.value = prompt
}

const buildRequestHistory = () =>
  messages.value
    .filter(message => ['user', 'assistant'].includes(message.role) && String(message.content || '').trim())
    .slice(-12)
    .map(message => ({
      role: message.role,
      content: String(message.content || '').slice(0, 4000),
    }))

const parseSseEvent = (eventText: string) => {
  const eventLine = eventText.split('\n').find(line => line.startsWith('event:'))
  const dataLines = eventText
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.replace('data:', '').trim())

  if (!dataLines.length) return null

  try {
    return {
      event: eventLine?.replace('event:', '').trim(),
      data: JSON.parse(dataLines.join('\n')),
    }
  } catch (error) {
    console.error('Failed to parse SSE event:', error)
    return null
  }
}

const askQuestion = async () => {
  if (!inputQuestion.value.trim() || isLoading.value) return

  const question = inputQuestion.value.trim()
  const history = buildRequestHistory()
  inputQuestion.value = ''

  if (!currentSessionId.value) {
    const createdSession = await createSession()
    if (!createdSession) {
      inputQuestion.value = question
      return
    }
  }

  messages.value.push({ role: 'user', content: question })
  const assistantMessage: ChatMessage = { role: 'assistant', content: '' }
  messages.value.push(assistantMessage)
  await scrollToBottom()

  isLoading.value = true
  try {
    const token = userStore.token
    const response = await fetch(getQAStreamUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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

        if (parsed.event === 'chunk') {
          assistantMessage.content = parsed.data?.content || assistantMessage.content || ''
        } else if (parsed.event === 'done') {
          assistantMessage.content = parsed.data?.answer || assistantMessage.content || ''
        } else if (parsed.event === 'error') {
          throw new Error(parsed.data?.message || 'STREAM_ERROR')
        }
      }

      await scrollToBottom()
    }

    if (!assistantMessage.content) {
      assistantMessage.content = '暂未返回有效回答，请稍后重试。'
    }
  } catch (error) {
    ElMessage.error('问答请求失败，请稍后重试')
    assistantMessage.content = '抱歉，我暂时无法完成这次问答。请稍后重试，或补充更具体的标准编号与审查场景。'
  } finally {
    isLoading.value = false
    await scrollToBottom()
  }
}

const handleEnter = (event: KeyboardEvent) => {
  if (event.shiftKey) return
  event.preventDefault()
  askQuestion()
}

onMounted(() => {
  loadSessions()
})
</script>

<style scoped>
.qa-page {
  height: calc(100vh - 92px);
  min-height: calc(100vh - 92px);
  color: var(--corp-text-primary);
  overflow: hidden;
  background: #f6f8fc;
}

.qa-shell {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
  padding: 16px;
}

.session-panel,
.chat-panel {
  min-height: 0;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 20px;
  background: #fff;
}

.session-panel {
  display: flex;
  flex-direction: column;
  padding: 16px;
  overflow: hidden;
}

.session-panel__header,
.chat-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 14px;
  margin-bottom: 14px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.8);
}

.session-panel__header h2,
.chat-panel__header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.3;
}

.chat-panel__subtitle {
  margin: 6px 0 0;
  color: var(--corp-text-secondary);
  font-size: 12px;
}

.new-session-btn {
  flex-shrink: 0;
  border-radius: 999px;
}

.session-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 2px;
}

.session-item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--color-gray-200);
  border-radius: 16px;
  background: #fff;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--corp-transition-base),
    box-shadow var(--corp-transition-base);
}

.session-item:hover,
.session-item.active {
  border-color: rgba(37, 99, 235, 0.24);
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.06);
}

.session-item__accent {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 12px;
  background: #eff6ff;
  color: var(--color-primary-700);
}

.session-item.active .session-item__accent {
  background: #2563eb;
  color: #fff;
}

.session-item__content {
  min-width: 0;
  flex: 1;
}

.session-item__top {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.session-title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-delete {
  opacity: 0;
  flex-shrink: 0;
}

.session-item:hover .session-delete,
.session-item.active .session-delete {
  opacity: 1;
}

.session-item__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--corp-text-secondary);
}

.session-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 220px;
  padding: 20px;
  border: 1px dashed rgba(148, 163, 184, 0.6);
  border-radius: 18px;
  background: #f8fafc;
  text-align: center;
}

.session-empty__icon {
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: #fff;
  color: var(--color-primary-600);
  font-size: 22px;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.06);
}

.session-empty h3 {
  margin: 0;
  font-size: 16px;
}

.session-empty p {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--corp-text-secondary);
}

.chat-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat-panel__header {
  display: block;
  padding: 16px 18px 14px;
}

.chat-panel__subtitle {
  margin-top: 6px;
}

.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 18px;
  background: #f8fafc;
}

.chat-empty-stage {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-empty-card {
  width: min(720px, 100%);
  padding: 20px;
  border-radius: 18px;
  border: 1px solid rgba(226, 232, 240, 0.96);
  background: #fff;
}

.chat-empty-card h3 {
  margin: 0 0 8px;
  font-size: 20px;
  line-height: 1.32;
}

.chat-empty-card > p {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--corp-text-secondary);
}

.chat-empty-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 16px;
}

.prompt-card {
  min-height: 84px;
  padding: 14px;
  border: 1px solid rgba(226, 232, 240, 0.96);
  border-radius: 14px;
  background: #fff;
  color: var(--corp-text-primary);
  font-size: 13px;
  line-height: 1.7;
  text-align: left;
  cursor: pointer;
}

.prompt-card:hover {
  border-color: rgba(96, 165, 250, 0.72);
}

.message-list {
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 0;
}

.message-stage {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.message-row.user {
  flex-direction: row-reverse;
}

.message-avatar {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 700;
}

.message-row.user .message-avatar {
  background: #111827;
  color: #fff;
}

.message-row.assistant .message-avatar {
  background: #dbeafe;
  color: var(--color-primary-700);
}

.message-card {
  width: min(100%, 1080px);
  max-width: calc(100% - 48px);
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid rgba(226, 232, 240, 0.94);
  background: #fff;
}

.message-row.user .message-card {
  background: #eff6ff;
  border-color: rgba(96, 165, 250, 0.18);
}

.message-card__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--corp-text-secondary);
}

.message-row.user .message-card__meta {
  color: var(--color-primary-700);
}

.message-author {
  font-weight: 600;
}

.message-separator {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.4;
}

.message-content {
  font-size: 15px;
  line-height: 1.8;
  word-break: break-word;
}

.message-content :deep(*) {
  max-width: 100%;
}

.message-content :deep(p) {
  margin: 0 0 12px;
}

.message-content :deep(p:last-child) {
  margin-bottom: 0;
}

.message-content :deep(ul),
.message-content :deep(ol) {
  margin: 0 0 12px;
  padding-left: 20px;
}

.message-content :deep(li + li) {
  margin-top: 6px;
}

.message-content :deep(strong) {
  font-weight: 700;
}

.message-content :deep(blockquote) {
  margin: 12px 0;
  padding: 10px 14px;
  border-left: 3px solid rgba(37, 99, 235, 0.36);
  background: rgba(239, 246, 255, 0.7);
  border-radius: 0 12px 12px 0;
}

.message-content :deep(code) {
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.06);
  font-size: 13px;
  font-family: var(--font-mono);
}

.message-content :deep(pre) {
  margin: 12px 0;
  padding: 14px 16px;
  overflow-x: auto;
  border-radius: 14px;
  background: #0f172a;
  color: #f8fafc;
}

.message-content :deep(pre code) {
  padding: 0;
  background: transparent;
  color: inherit;
}

.message-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 14px 0;
  overflow: hidden;
  border-radius: 12px;
}

.message-content :deep(th),
.message-content :deep(td) {
  padding: 10px 12px;
  border: 1px solid rgba(226, 232, 240, 0.95);
  text-align: left;
}

.message-content :deep(th) {
  background: rgba(248, 250, 252, 0.96);
  font-weight: 600;
}

.stream-indicator {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  margin-left: 48px;
  padding: 10px 14px;
  border-radius: 999px;
  background: #fff7ed;
  color: #9a3412;
  font-size: 12px;
}

.stream-indicator span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  animation: qa-pulse 1s infinite ease-in-out;
}

.stream-indicator span:nth-child(2) {
  animation-delay: 0.15s;
}

.stream-indicator span:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes qa-pulse {
  0%,
  100% {
    transform: translateY(0);
    opacity: 0.35;
  }

  50% {
    transform: translateY(-3px);
    opacity: 1;
  }
}

.composer-panel {
  margin: 0 18px 18px;
  padding: 14px 16px;
  border-top: none;
  border-radius: 18px;
  background: #fff;
  box-shadow: inset 0 0 0 1px rgba(226, 232, 240, 0.9);
}

.composer-panel__body {
  display: flex;
  align-items: flex-end;
  gap: 14px;
}

.composer-panel__body :deep(.el-textarea) {
  flex: 1;
}

.composer-panel__body :deep(.el-textarea__inner) {
  min-height: 108px !important;
  padding: 16px 16px;
  border: none;
  border-radius: 16px;
  background: #f8fafc;
  box-shadow: inset 0 0 0 1px rgba(209, 213, 219, 0.8);
  font-size: 14px;
  line-height: 1.8;
  color: var(--corp-text-primary);
}

.composer-panel__body :deep(.el-textarea__inner:focus) {
  box-shadow:
    inset 0 0 0 1px rgba(37, 99, 235, 0.8),
    0 0 0 4px rgba(59, 130, 246, 0.1);
}

.send-btn {
  flex-shrink: 0;
  width: 132px;
  height: 56px;
  border: none;
  border-radius: 16px;
  background: linear-gradient(135deg, #111827 0%, #1d4ed8 100%);
}

.send-btn:hover,
.send-btn:focus {
  transform: translateY(-1px);
}

.send-btn.is-disabled,
.send-btn.is-disabled:hover {
  transform: none;
  box-shadow: none;
}

@media (max-width: 1200px) {
  .qa-shell {
    grid-template-columns: 260px minmax(0, 1fr);
  }

  .message-card {
    width: 100%;
    max-width: calc(100% - 48px);
  }
}

@media (max-width: 1024px) {
  .qa-shell {
    grid-template-columns: 240px minmax(0, 1fr);
  }
}

@media (max-width: 768px) {
  .qa-page {
    height: auto;
    min-height: auto;
    overflow: visible;
  }

  .qa-shell {
    grid-template-columns: 1fr;
    padding: 12px;
  }

  .session-panel,
  .chat-panel {
    border-radius: 18px;
  }

  .session-list {
    max-height: 260px;
  }

  .chat-panel__header,
  .chat-messages,
  .composer-panel {
    padding-left: 14px;
    padding-right: 14px;
  }

  .chat-empty-grid {
    grid-template-columns: 1fr;
  }

  .message-card {
    max-width: calc(100% - 44px);
    padding: 13px 14px;
  }

  .composer-panel__body {
    flex-direction: column;
    align-items: stretch;
  }

  .send-btn {
    width: 100%;
  }
}
</style>