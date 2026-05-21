<template>
  <div class="lc-qa-page">
    <div class="lc-qa-shell">
      <aside class="lc-qa-sidebar">
        <div class="lc-qa-sidebar__header">
          <div class="lc-badge">LC</div>
          <div>
            <h2>智能问答</h2>
            <p class="lc-qa-sidebar__subtitle">LangChain RAG 引擎</p>
          </div>
        </div>

        <div class="lc-qa-sidebar__section">
          <label class="lc-label">选择知识库</label>
          <el-tree-select
            v-model="selectedCategoryIds"
            :data="categoryTree"
            :props="{ label: 'name', value: 'id', children: 'children' }"
            placeholder="选择知识库（可多选）"
            check-strictly
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            class="lc-tree-select"
          />
        </div>

        <div class="lc-qa-sidebar__section">
          <label class="lc-label">检索增强</label>
          <div class="lc-toggle-group">
            <div class="lc-toggle-item">
              <el-switch v-model="enableMultiQuery" size="small" />
              <span>多查询扩展</span>
            </div>
            <div class="lc-toggle-item">
              <el-switch v-model="enableHyDE" size="small" />
              <span>假设性文档</span>
            </div>
          </div>
        </div>

        <div class="lc-qa-sidebar__footer">
          <div class="lc-engine-tag">
            <span class="lc-engine-dot"></span>
            LangChain.js RAG
          </div>
        </div>
      </aside>

      <section class="lc-qa-chat">
        <div class="lc-qa-chat__header">
          <h2>知识库智能问答</h2>
          <p class="lc-qa-chat__subtitle">{{ messages.length }} 条消息</p>
        </div>

        <div ref="chatContainer" class="lc-qa-messages">
          <div v-if="messages.length === 0" class="lc-qa-empty">
            <div class="lc-qa-empty__card">
              <div class="lc-qa-empty__badge">LC</div>
              <h3>基于 LangChain RAG 的智能问答</h3>
              <p>选择知识库后，输入问题即可获得基于标准规范的精准回答</p>
              <div class="lc-qa-empty__grid">
                <button
                  v-for="prompt in examplePrompts"
                  :key="prompt"
                  type="button"
                  class="lc-qa-prompt-card"
                  @click="selectPrompt(prompt)"
                >
                  {{ prompt }}
                </button>
              </div>
            </div>
          </div>

          <div v-else class="lc-qa-message-list">
            <div
              v-for="(msg, idx) in messages"
              :key="idx"
              :class="['lc-qa-message', msg.role]"
            >
              <div class="lc-qa-message__avatar">
                {{ msg.role === 'user' ? '问' : 'LC' }}
              </div>
              <div class="lc-qa-message__card">
                <div class="lc-qa-message__meta">
                  <span>{{ msg.role === 'user' ? '您的提问' : 'LangChain AI' }}</span>
                </div>
                <div
                  v-if="msg.role === 'assistant'"
                  class="lc-qa-message__content"
                  v-html="renderMarkdown(msg.content || '正在生成回答...')"
                ></div>
                <div v-else class="lc-qa-message__content lc-qa-message__content--user">
                  {{ msg.content }}
                </div>
                <div v-if="msg.sources?.length" class="lc-qa-message__sources">
                  <div class="lc-qa-sources__label">引用来源</div>
                  <div class="lc-qa-sources__list">
                    <el-tag
                      v-for="(src, si) in msg.sources"
                      :key="si"
                      size="small"
                      type="info"
                      effect="plain"
                    >
                      {{ src.document_name }}
                    </el-tag>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="isLoading" class="lc-qa-streaming">
              <div class="lc-qa-streaming__dots">
                <span></span><span></span><span></span>
              </div>
              <p>正在检索知识库并生成回答</p>
            </div>
          </div>
        </div>

        <footer class="lc-qa-composer">
          <div class="lc-qa-composer__body">
            <el-input
              v-model="inputQuestion"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 5 }"
              placeholder="输入问题，例如：GB/T 50265 中对泵站厂房的防火分区要求？"
              resize="none"
              :disabled="isLoading"
              @keydown.enter="handleEnter"
            />
            <el-button
              class="lc-qa-send-btn"
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
import { Position } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { useMarkdown } from '@/composables/useMarkdown'
import { getLangChainStreamUrl } from '@/api/langchain'
import { getKnowledgeTreeApi, type KnowledgeTreeNode } from '@/api/knowledge-category'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: Array<{ content: string; document_name: string; similarity: number }>
}

const userStore = useUserStore()
const { renderMarkdown } = useMarkdown()

const inputQuestion = ref('')
const messages = ref<ChatMessage[]>([])
const isLoading = ref(false)
const selectedCategoryIds = ref<string[]>([])
const enableMultiQuery = ref(true)
const enableHyDE = ref(true)
const chatContainer = ref<HTMLElement | null>(null)
const categoryTree = ref<KnowledgeTreeNode[]>([])

const examplePrompts = [
  'GB/T 50265 中对泵站厂房的防火分区和疏散要求有哪些？',
  '核电站防火设计中，电缆竖井应重点核查哪些条款？',
  '消防泵房的防火间距要求是什么？',
  '安全壳贯穿件的密封性试验有哪些标准要求？',
]

const canSend = computed(() => inputQuestion.value.trim() && !isLoading.value && selectedCategoryIds.value.length > 0)

const scrollToBottom = async () => {
  await nextTick()
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight
  }
}

const selectPrompt = (prompt: string) => {
  inputQuestion.value = prompt
}

const handleEnter = (event: KeyboardEvent) => {
  if (event.shiftKey) return
  event.preventDefault()
  askQuestion()
}

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
  } catch {
    return null
  }
}

const askQuestion = async () => {
  if (!inputQuestion.value.trim() || isLoading.value) return
  if (selectedCategoryIds.value.length === 0) {
    ElMessage.warning('请先选择知识库')
    return
  }

  const question = inputQuestion.value.trim()
  inputQuestion.value = ''

  messages.value.push({ role: 'user', content: question })
  const assistantMsg: ChatMessage = { role: 'assistant', content: '' }
  messages.value.push(assistantMsg)
  await scrollToBottom()

  isLoading.value = true
  try {
    const token = userStore.token
    const response = await fetch(getLangChainStreamUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        question,
        categoryIds: selectedCategoryIds.value,
        history: messages.value
          .filter(m => ['user', 'assistant'].includes(m.role) && m.content.trim())
          .slice(-12)
          .map(m => ({ role: m.role, content: m.content.slice(0, 4000) })),
        enableMultiQuery: enableMultiQuery.value,
        enableHyDE: enableHyDE.value,
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

        if (parsed.event === 'sources') {
          assistantMsg.sources = parsed.data?.sources
        } else if (parsed.event === 'delta') {
          assistantMsg.content += parsed.data?.content || ''
        } else if (parsed.event === 'done') {
          assistantMsg.content = parsed.data?.answer || assistantMsg.content || ''
        } else if (parsed.event === 'error') {
          throw new Error(parsed.data?.error || 'STREAM_ERROR')
        }
      }

      await scrollToBottom()
    }

    if (!assistantMsg.content) {
      assistantMsg.content = '暂未返回有效回答，请稍后重试。'
    }
  } catch (e: any) {
    ElMessage.error('问答请求失败')
    assistantMsg.content = '抱歉，问答请求失败。请检查知识库选择和网络连接后重试。'
  } finally {
    isLoading.value = false
    await scrollToBottom()
  }
}

onMounted(async () => {
  try {
    const { data } = await getKnowledgeTreeApi()
    categoryTree.value = data || []
  } catch {
    categoryTree.value = []
  }
})
</script>

<style scoped>
.lc-qa-page {
  height: calc(100vh - 92px);
  min-height: calc(100vh - 92px);
  color: var(--corp-text-primary);
  overflow: hidden;
  background: #f6f8fc;
}

.lc-qa-shell {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
  padding: 16px;
}

.lc-qa-sidebar {
  display: flex;
  flex-direction: column;
  padding: 20px 16px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 20px;
  background: #fff;
  overflow-y: auto;
}

.lc-qa-sidebar__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 16px;
  margin-bottom: 16px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.8);
}

.lc-badge {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: linear-gradient(135deg, #7c3aed 0%, #3b82f6 100%);
  color: #fff;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: -0.5px;
  flex-shrink: 0;
}

.lc-qa-sidebar__header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.lc-qa-sidebar__subtitle {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--corp-text-tertiary);
  letter-spacing: 0.5px;
}

.lc-qa-sidebar__section {
  margin-bottom: 20px;
}

.lc-label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--corp-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.lc-tree-select {
  width: 100%;
}

.lc-toggle-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.lc-toggle-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.lc-qa-sidebar__footer {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid rgba(226, 232, 240, 0.8);
}

.lc-engine-tag {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--corp-text-tertiary);
}

.lc-engine-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  animation: lc-pulse-dot 2s infinite;
}

@keyframes lc-pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.lc-qa-chat {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 20px;
  background: #fff;
}

.lc-qa-chat__header {
  padding: 16px 20px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.8);
}

.lc-qa-chat__header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.lc-qa-chat__subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--corp-text-secondary);
}

.lc-qa-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 18px 20px;
  background: #f8fafc;
}

.lc-qa-empty {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lc-qa-empty__card {
  width: min(680px, 100%);
  padding: 32px;
  border-radius: 18px;
  border: 1px solid rgba(226, 232, 240, 0.96);
  background: #fff;
  text-align: center;
}

.lc-qa-empty__badge {
  width: 48px;
  height: 48px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: linear-gradient(135deg, #7c3aed 0%, #3b82f6 100%);
  color: #fff;
  font-size: 16px;
  font-weight: 800;
}

.lc-qa-empty__card h3 {
  margin: 0 0 8px;
  font-size: 20px;
  font-weight: 700;
}

.lc-qa-empty__card > p {
  margin: 0;
  font-size: 13px;
  color: var(--corp-text-secondary);
  line-height: 1.7;
}

.lc-qa-empty__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 20px;
  text-align: left;
}

.lc-qa-prompt-card {
  padding: 14px;
  border: 1px solid rgba(226, 232, 240, 0.96);
  border-radius: 14px;
  background: #fff;
  color: var(--corp-text-primary);
  font-size: 13px;
  line-height: 1.7;
  cursor: pointer;
  transition: border-color 0.2s;
}

.lc-qa-prompt-card:hover {
  border-color: rgba(124, 58, 237, 0.4);
}

.lc-qa-message-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.lc-qa-message {
  display: flex;
  gap: 12px;
}

.lc-qa-message.user {
  flex-direction: row-reverse;
}

.lc-qa-message__avatar {
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

.lc-qa-message.user .lc-qa-message__avatar {
  background: #111827;
  color: #fff;
}

.lc-qa-message.assistant .lc-qa-message__avatar {
  background: #f5f3ff;
  color: #7c3aed;
}

.lc-qa-message__card {
  width: min(100%, 900px);
  max-width: calc(100% - 48px);
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid rgba(226, 232, 240, 0.94);
  background: #fff;
}

.lc-qa-message.user .lc-qa-message__card {
  background: #f5f3ff;
  border-color: rgba(124, 58, 237, 0.15);
}

.lc-qa-message__meta {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--corp-text-tertiary);
  font-weight: 500;
}

.lc-qa-message__content {
  font-size: 14px;
  line-height: 1.8;
  word-break: break-word;
}

.lc-qa-message__content--user {
  white-space: pre-wrap;
}

.lc-qa-message__content :deep(p) {
  margin: 0 0 10px;
}

.lc-qa-message__content :deep(p:last-child) {
  margin-bottom: 0;
}

.lc-qa-message__content :deep(ul),
.lc-qa-message__content :deep(ol) {
  margin: 0 0 10px;
  padding-left: 20px;
}

.lc-qa-message__content :deep(blockquote) {
  margin: 10px 0;
  padding: 10px 14px;
  border-left: 3px solid rgba(124, 58, 237, 0.36);
  background: rgba(245, 243, 255, 0.7);
  border-radius: 0 12px 12px 0;
}

.lc-qa-message__content :deep(code) {
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.06);
  font-size: 13px;
  font-family: var(--font-mono);
}

.lc-qa-message__content :deep(pre) {
  margin: 10px 0;
  padding: 14px 16px;
  overflow-x: auto;
  border-radius: 14px;
  background: #0f172a;
  color: #f8fafc;
}

.lc-qa-message__content :deep(pre code) {
  padding: 0;
  background: transparent;
  color: inherit;
}

.lc-qa-message__sources {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(226, 232, 240, 0.8);
}

.lc-qa-sources__label {
  font-size: 11px;
  font-weight: 600;
  color: var(--corp-text-tertiary);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.lc-qa-sources__list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.lc-qa-streaming {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: 48px;
  padding: 10px 14px;
  border-radius: 999px;
  background: #f5f3ff;
  color: #7c3aed;
  font-size: 12px;
}

.lc-qa-streaming__dots {
  display: flex;
  gap: 4px;
}

.lc-qa-streaming__dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  animation: lc-qa-bounce 1s infinite ease-in-out;
}

.lc-qa-streaming__dots span:nth-child(2) { animation-delay: 0.15s; }
.lc-qa-streaming__dots span:nth-child(3) { animation-delay: 0.3s; }

@keyframes lc-qa-bounce {
  0%, 100% { transform: translateY(0); opacity: 0.35; }
  50% { transform: translateY(-3px); opacity: 1; }
}

.lc-qa-composer {
  margin: 0 20px 20px;
  padding: 14px 16px;
  border-radius: 18px;
  background: #fff;
  box-shadow: inset 0 0 0 1px rgba(226, 232, 240, 0.9);
}

.lc-qa-composer__body {
  display: flex;
  align-items: flex-end;
  gap: 14px;
}

.lc-qa-composer__body :deep(.el-textarea) {
  flex: 1;
}

.lc-qa-composer__body :deep(.el-textarea__inner) {
  min-height: 80px !important;
  padding: 14px 16px;
  border: none;
  border-radius: 14px;
  background: #f8fafc;
  box-shadow: inset 0 0 0 1px rgba(209, 213, 219, 0.8);
  font-size: 14px;
  line-height: 1.8;
}

.lc-qa-composer__body :deep(.el-textarea__inner:focus) {
  box-shadow: inset 0 0 0 1px rgba(124, 58, 237, 0.6), 0 0 0 3px rgba(124, 58, 237, 0.08);
}

.lc-qa-send-btn {
  flex-shrink: 0;
  width: 120px;
  height: 52px;
  border: none;
  border-radius: 14px;
  background: linear-gradient(135deg, #7c3aed 0%, #3b82f6 100%);
  font-weight: 600;
}

.lc-qa-send-btn:hover:not(.is-disabled) {
  transform: translateY(-1px);
}

@media (max-width: 768px) {
  .lc-qa-shell {
    grid-template-columns: 1fr;
  }
  .lc-qa-empty__grid {
    grid-template-columns: 1fr;
  }
  .lc-qa-composer__body {
    flex-direction: column;
  }
  .lc-qa-send-btn {
    width: 100%;
  }
}
</style>
