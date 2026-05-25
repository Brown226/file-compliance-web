<template>
  <div class="qa-page">
    <!-- 左侧边栏：对话历史 -->
    <aside class="qa-sidebar">
      <div class="qa-sidebar__header">
        <el-button type="primary" class="new-chat-btn" @click="createNewConversation">
          <el-icon><Plus /></el-icon>
          新建对话
        </el-button>
      </div>

      <div class="qa-sidebar__list">
        <div
          v-for="conv in conversations"
          :key="conv.id"
          :class="['qa-sidebar__item', { active: currentConversationId === conv.id }]"
          @click="switchConversation(conv.id)"
        >
          <div class="qa-sidebar__item-content">
            <el-icon class="qa-sidebar__item-icon"><ChatDotRound /></el-icon>
            <span class="qa-sidebar__item-title">{{ conv.title }}</span>
          </div>
          <el-button
            type="danger"
            link
            size="small"
            class="qa-sidebar__item-delete"
            @click.stop="deleteConversation(conv.id)"
          >
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>

        <div v-if="conversations.length === 0" class="qa-sidebar__empty">
          <el-icon><ChatLineSquare /></el-icon>
          <span>暂无对话记录</span>
        </div>
      </div>
    </aside>

    <!-- 右侧主区域 -->
    <main class="qa-main">
      <!-- 顶部：知识库选择和参数 -->
      <header class="qa-header">
        <div class="qa-header__left">
          <el-button class="kb-select-btn" @click="showKbSelector = true">
            <el-icon><Collection /></el-icon>
            <span v-if="selectedCategoryIds.length === 0">选择知识库</span>
            <span v-else>已选 {{ selectedCategoryIds.length }} 个知识库</span>
            <el-icon class="kb-select-btn__arrow"><ArrowDown /></el-icon>
          </el-button>
          <div v-if="selectedCategoryIds.length > 0" class="kb-selected-tags">
            <el-tag
              v-for="id in selectedCategoryIds.slice(0, 3)"
              :key="id"
              size="small"
              type="primary"
              effect="plain"
              closable
              @close="removeKb(id)"
            >
              {{ getKbName(id) }}
            </el-tag>
            <el-tag
              v-if="selectedCategoryIds.length > 3"
              size="small"
              type="info"
              effect="plain"
            >
              +{{ selectedCategoryIds.length - 3 }}
            </el-tag>
          </div>
        </div>
        <div class="qa-header__right">
          <el-popover placement="bottom-end" :width="320" trigger="click">
            <template #reference>
              <el-button link>
                <el-icon><Setting /></el-icon>
                检索参数
              </el-button>
            </template>
            <div class="params-panel">
              <div class="params-panel__item">
                <span class="params-panel__label">返回结果数</span>
                <el-input-number v-model="searchParams.topK" :min="1" :max="30" size="small" controls-position="right" />
              </div>
              <div class="params-panel__item">
                <span class="params-panel__label">最小相似度</span>
                <span class="params-panel__value">{{ (searchParams.minSimilarity * 100).toFixed(0) }}%</span>
              </div>
              <el-slider v-model="searchParams.minSimilarity" :min="0.1" :max="0.9" :step="0.05" size="small" />
              <div class="params-panel__item">
                <span class="params-panel__label">搜索模式</span>
                <el-radio-group v-model="searchParams.searchMode" size="small">
                  <el-radio-button value="hybrid">混合</el-radio-button>
                  <el-radio-button value="vector">向量</el-radio-button>
                  <el-radio-button value="keyword">关键词</el-radio-button>
                </el-radio-group>
              </div>
              <el-divider />
              <div class="params-panel__toggle">
                <el-switch v-model="searchParams.enableMultiQuery" size="small" />
                <span>多查询扩展</span>
              </div>
              <div class="params-panel__toggle">
                <el-switch v-model="searchParams.enableHyDE" size="small" />
                <span>假设性文档</span>
              </div>
              <div class="params-panel__toggle">
                <el-switch v-model="searchParams.enableCompression" size="small" />
                <span>上下文压缩</span>
              </div>
              <el-button type="primary" link size="small" class="params-panel__reset" @click="resetSearchParams">
                重置默认
              </el-button>
            </div>
          </el-popover>
        </div>
      </header>

      <!-- 消息区域 -->
      <div ref="chatContainer" class="qa-messages">
        <div v-if="messages.length === 0" class="qa-empty">
          <div class="qa-empty__icon">
            <el-icon :size="48"><ChatDotRound /></el-icon>
          </div>
          <h3>知识库智能问答</h3>
          <p>选择知识库后，输入问题即可获得基于标准规范的精准回答</p>
          <div class="qa-empty__prompts">
            <button
              v-for="prompt in examplePrompts"
              :key="prompt"
              class="qa-prompt-btn"
              @click="selectPrompt(prompt)"
            >
              {{ prompt }}
            </button>
          </div>
        </div>

        <div v-else class="qa-message-list">
          <div
            v-for="(msg, idx) in messages"
            :key="msg.id || idx"
            :class="['qa-message', msg.role]"
          >
            <div class="qa-message__avatar">
              {{ msg.role === 'user' ? '我' : 'AI' }}
            </div>
            <div class="qa-message__content">
              <!-- 处理中状态 -->
              <div v-if="msg.status === 'processing'" class="qa-message__processing">
                <div class="qa-loading__dots">
                  <span></span><span></span><span></span>
                </div>
                <span>正在检索知识库并生成回答...</span>
              </div>
              <!-- 失败状态 -->
              <div v-else-if="msg.status === 'failed'" class="qa-message__failed">
                <el-icon><WarningFilled /></el-icon>
                <span>{{ msg.content || '问答请求失败' }}</span>
              </div>
              <!-- 正常内容 -->
              <template v-else>
                <div v-if="msg.role === 'assistant'" v-html="renderMarkdown(msg.content || '')"></div>
                <div v-else>{{ msg.content }}</div>
              </template>

              <!-- 引用来源 -->
              <div v-if="msg.sources?.length" class="qa-message__sources">
                <div class="qa-sources__header">
                  <el-icon><Document /></el-icon>
                  <span>引用来源</span>
                </div>
                <div class="qa-sources__list">
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
        </div>
      </div>

      <!-- 输入区域 -->
      <footer class="qa-input">
        <el-input
          v-model="inputQuestion"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 4 }"
          placeholder="输入问题，按 Enter 发送，Shift+Enter 换行"
          resize="none"
          :disabled="isProcessing"
          @keydown.enter="handleEnter"
        />
        <el-button
          type="primary"
          :disabled="!canSend"
          :loading="isProcessing"
          @click="askQuestion"
        >
          <el-icon><Promotion /></el-icon>
        </el-button>
      </footer>
    </main>

    <KnowledgeBaseSelector
      v-model:visible="showKbSelector"
      :tree-data="categoryTree"
      :selected-ids="selectedCategoryIds"
      @confirm="handleKbConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Plus, Delete, ChatDotRound, ChatLineSquare, Setting, Document, Promotion, WarningFilled, FolderOpened, Collection, ArrowDown } from '@element-plus/icons-vue'
import KnowledgeBaseSelector from '@/views/components/KnowledgeBaseSelector.vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { useMarkdown } from '@/composables/useMarkdown'
import {
  getConversationsApi,
  getConversationApi,
  createConversationApi,
  deleteConversationApi,
  langchainAskStreamApi,
  langchainAskBackgroundApi,
  getMessageStatusApi,
  type Conversation,
  type ConversationDetail,
  type MessageStatus,
} from '@/api/langchain'
import { getKnowledgeTreeApi, type KnowledgeTreeNode } from '@/api/knowledge-category'

interface ChatMessage {
  id?: string
  role: 'user' | 'assistant'
  content: string
  status?: 'processing' | 'completed' | 'failed'
  sources?: Array<{ content: string; document_name: string; similarity: number }>
  debug?: any
}

interface SearchParams {
  topK: number
  minSimilarity: number
  searchMode: 'hybrid' | 'vector' | 'keyword'
  enableMultiQuery: boolean
  enableHyDE: boolean
  enableCompression: boolean
}

const DEFAULT_SEARCH_PARAMS: SearchParams = {
  topK: 8,
  minSimilarity: 0.3,
  searchMode: 'hybrid',
  enableMultiQuery: true,
  enableHyDE: true,
  enableCompression: true,
}

const userStore = useUserStore()
const { renderMarkdown } = useMarkdown()

const STORAGE_KEYS = {
  SELECTED_KB_IDS: 'langchain-qa-selected-kb-ids',
  SEARCH_PARAMS: 'langchain-qa-search-params',
}

const inputQuestion = ref('')
const messages = ref<ChatMessage[]>([])
const isProcessing = ref(false)
const selectedCategoryIds = ref<string[]>([])
const showKbSelector = ref(false)
const searchParams = ref<SearchParams>({ ...DEFAULT_SEARCH_PARAMS })
const chatContainer = ref<HTMLElement | null>(null)
const categoryTree = ref<KnowledgeTreeNode[]>([])
const conversations = ref<Conversation[]>([])
const currentConversationId = ref<string | null>(null)
const abortController = ref<AbortController | null>(null)

// ========== 持久化存储 ==========
const saveSelectedKbIds = (ids: string[]) => {
  try {
    localStorage.setItem(STORAGE_KEYS.SELECTED_KB_IDS, JSON.stringify(ids))
  } catch { /* ignore */ }
}

const loadSelectedKbIds = (): string[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SELECTED_KB_IDS)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch { /* ignore */ }
  return []
}

const saveSearchParams = (params: SearchParams) => {
  try {
    localStorage.setItem(STORAGE_KEYS.SEARCH_PARAMS, JSON.stringify(params))
  } catch { /* ignore */ }
}

const loadSearchParams = (): SearchParams | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SEARCH_PARAMS)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return null
}

// 监听知识库选择变化，自动保存
watch(selectedCategoryIds, (ids) => {
  saveSelectedKbIds(ids)
}, { deep: true })

// 监听搜索参数变化，自动保存
watch(searchParams, (params) => {
  saveSearchParams(params)
}, { deep: true })

const findKbNode = (id: string, nodes: any[]): any => {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const found = findKbNode(id, node.children)
      if (found) return found
    }
  }
  return null
}

const getKbName = (id: string) => {
  const node = findKbNode(id, categoryTree.value)
  return node?.name || id
}

const removeKb = (id: string) => {
  selectedCategoryIds.value = selectedCategoryIds.value.filter(i => i !== id)
}

const handleKbConfirm = (ids: string[]) => {
  selectedCategoryIds.value = ids
}

const examplePrompts = [
  'GB/T 50265 中对泵站厂房的防火分区和疏散要求有哪些？',
  '核电站防火设计中，电缆竖井应重点核查哪些条款？',
  '消防泵房的防火间距要求是什么？',
  '安全壳贯穿件的密封性试验有哪些标准要求？',
]

const canSend = computed(() => inputQuestion.value.trim() && !isProcessing.value && selectedCategoryIds.value.length > 0)

const resetSearchParams = () => {
  searchParams.value = { ...DEFAULT_SEARCH_PARAMS }
  ElMessage.success('已重置为默认参数')
}

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

// 开始流式问答（SSE）
const startStreamAsk = async (question: string) => {
  const token = userStore.token
  console.log('[SSE] 开始流式问答, token:', token ? '✅ 有' : '❌ 无')
  if (!token) {
    ElMessage.error('未登录，请重新登录')
    isProcessing.value = false
    return
  }

  const controller = new AbortController()
  abortController.value = controller

  console.log('[SSE] 发送请求, 问题:', question.slice(0, 50))
  console.log('[SSE] 知识库:', selectedCategoryIds.value)

  try {
    await langchainAskStreamApi(
      {
        question,
        categoryIds: selectedCategoryIds.value,
        sessionId: currentConversationId.value || undefined,
        history: messages.value
          .filter(m => m.role === 'user' && m.status === 'completed')
          .slice(-12)
          .map(m => ({ role: m.role, content: m.content.slice(0, 4000) })),
        topK: searchParams.value.topK,
        enableMultiQuery: searchParams.value.enableMultiQuery,
        enableHyDE: searchParams.value.enableHyDE,
        enableCompression: searchParams.value.enableCompression,
      },
      {
        token,
        signal: controller.signal,
        onMessage: (data: any, eventType?: string) => {
          console.log(`[SSE] 收到事件: ${eventType || 'message'}`, data)

          const msgIndex = messages.value.findIndex(m => m.role === 'assistant' && m.status === 'processing')
          if (msgIndex === -1) {
            console.warn('[SSE] 找不到 processing 状态的 assistant 消息')
            return
          }

          const msg = messages.value[msgIndex]

          switch (eventType) {
            case 'status':
              msg.content = data.message || '正在处理...'
              break

            case 'sources':
              msg.sources = data.sources || []
              msg.debug = data.debug || {}
              break

            case 'delta':
              if (data.content) {
                msg.content += data.content
              }
              break

            case 'done':
              msg.content = data.answer || msg.content
              msg.status = 'completed'
              isProcessing.value = false
              abortController.value = null
              loadConversations()
              console.log('[SSE] ✅ 流式完成')
              break

            case 'error':
              msg.status = 'failed'
              msg.content = data.error || '问答请求失败'
              isProcessing.value = false
              abortController.value = null
              console.error('[SSE] ❌ 服务端错误:', data.error)
              break

            default:
              if (data.content) {
                msg.content += data.content
              }
          }

          scrollToBottom()
        },
        onError: (error: string) => {
          console.error('[SSE] 🔥 流式错误:', error)
          ElMessage.error('连接失败: ' + error)
          const msgIndex = messages.value.findIndex(m => m.role === 'assistant' && m.status === 'processing')
          if (msgIndex !== -1) {
            messages.value[msgIndex].status = 'failed'
            messages.value[msgIndex].content = `❌ 连接失败: ${error}`
          }
          isProcessing.value = false
          abortController.value = null
        },
        onComplete: () => {
          console.log('[SSE] 流结束 (onComplete)')
          const msgIndex = messages.value.findIndex(m => m.role === 'assistant' && m.status === 'processing')
          if (msgIndex !== -1 && messages.value[msgIndex].status === 'processing') {
            messages.value[msgIndex].status = 'completed'
            if (!messages.value[msgIndex].content) {
              messages.value[msgIndex].content = '(空回复)'
            }
          }
          isProcessing.value = false
          abortController.value = null
        },
      }
    )
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.log('[SSE] 用户取消请求')
    } else {
      console.error('[SSE] 💥 请求异常:', err)
      ElMessage.error('请求异常: ' + err.message)
      const msgIndex = messages.value.findIndex(m => m.role === 'assistant' && m.status === 'processing')
      if (msgIndex !== -1) {
        messages.value[msgIndex].status = 'failed'
        messages.value[msgIndex].content = `❌ 请求失败: ${err.message}`
      }
      isProcessing.value = false
      abortController.value = null
    }
  }
}

// 加载对话列表
const loadConversations = async () => {
  try {
    const { data } = await getConversationsApi()
    conversations.value = data || []
  } catch {
    conversations.value = []
  }
}

// 创建新对话
const createNewConversation = async () => {
  try {
    const { data } = await createConversationApi()
    conversations.value.unshift(data)
    currentConversationId.value = data.id
    messages.value = []
    if (abortController.value) {
      abortController.value.abort()
      abortController.value = null
    }
    isProcessing.value = false
  } catch {
    ElMessage.error('创建对话失败')
  }
}

// 切换对话
const switchConversation = async (id: string) => {
  if (isProcessing.value) {
    ElMessage.warning('请等待当前问答完成')
    return
  }
  try {
    const { data } = await getConversationApi(id)
    currentConversationId.value = id
    messages.value = (data.messages || []).map(m => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      status: (m.status as any) || 'completed',
      sources: m.sources,
      debug: m.debug,
    }))
    await scrollToBottom()
  } catch {
    ElMessage.error('加载对话失败')
  }
}

// 删除对话
const deleteConversation = async (id: string) => {
  try {
    await ElMessageBox.confirm('确定删除这个对话吗？', '提示', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await deleteConversationApi(id)
    conversations.value = conversations.value.filter(c => c.id !== id)
    if (currentConversationId.value === id) {
      currentConversationId.value = null
      messages.value = []
      if (abortController.value) {
        abortController.value.abort()
        abortController.value = null
      }
      isProcessing.value = false
    }
    ElMessage.success('已删除')
  } catch {
    // 用户取消
  }
}

const askQuestion = async () => {
  if (!inputQuestion.value.trim() || isProcessing.value) return
  if (selectedCategoryIds.value.length === 0) {
    ElMessage.warning('请先选择知识库')
    return
  }

  const question = inputQuestion.value.trim()
  inputQuestion.value = ''

  isProcessing.value = true

  // 添加用户消息
  const userMsg: ChatMessage = {
    role: 'user',
    content: question,
    status: 'completed',
  }
  messages.value.push(userMsg)

  // 添加助手消息（初始状态为 processing）
  const assistantMsg: ChatMessage = {
    role: 'assistant',
    content: '',
    status: 'processing',
  }
  messages.value.push(assistantMsg)
  await scrollToBottom()

  // 使用 SSE 流式输出
  await startStreamAsk(question)
}

onMounted(async () => {
  try {
    const { data } = await getKnowledgeTreeApi()
    categoryTree.value = data || []
  } catch {
    categoryTree.value = []
  }

  // 恢复持久化的知识库选择
  const savedIds = loadSelectedKbIds()
  if (savedIds.length > 0 && categoryTree.value.length > 0) {
    const allLeafIds: string[] = []
    function collectLeaves(nodes: any[]) {
      for (const node of nodes) {
        if (!node.children || node.children.length === 0) {
          allLeafIds.push(node.id)
        } else {
          collectLeaves(node.children)
        }
      }
    }
    collectLeaves(categoryTree.value)
    // 只保留仍然存在于当前树中的 ID
    selectedCategoryIds.value = savedIds.filter(id => allLeafIds.includes(id))
    if (selectedCategoryIds.value.length > 0) {
      console.log(`[QA] 恢复知识库选择: ${selectedCategoryIds.value.length} 个`)
    }
  }

  // 恢复持久化的搜索参数
  const savedParams = loadSearchParams()
  if (savedParams) {
    searchParams.value = { ...DEFAULT_SEARCH_PARAMS, ...savedParams }
  }

  await loadConversations()
})

onUnmounted(() => {
  if (abortController.value) {
    abortController.value.abort()
    abortController.value = null
  }
})
</script>

<style scoped>
.qa-page {
  display: flex;
  height: calc(100vh - 60px);
  background: linear-gradient(135deg, #f0f4f8 0%, #e8ecf1 100%);
}

/* 左侧边栏 */
.qa-sidebar {
  width: 280px;
  background: #fff;
  border-right: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
}

.qa-sidebar__header {
  padding: 16px;
  border-bottom: 1px solid #e4e7ed;
}

.new-chat-btn {
  width: 100%;
}

.qa-sidebar__list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.qa-sidebar__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 4px;
}

.qa-sidebar__item:hover {
  background: #f5f7fa;
}

.qa-sidebar__item.active {
  background: #ecf5ff;
  color: #409eff;
}

.qa-sidebar__item-content {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.qa-sidebar__item-icon {
  flex-shrink: 0;
  font-size: 16px;
}

.qa-sidebar__item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}

.qa-sidebar__item-delete {
  opacity: 0;
  transition: opacity 0.2s;
}

.qa-sidebar__item:hover .qa-sidebar__item-delete {
  opacity: 1;
}

.qa-sidebar__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: #909399;
  font-size: 14px;
  gap: 10px;
}

.qa-sidebar__empty .el-icon {
  font-size: 32px;
}

/* 右侧主区域 */
.qa-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* 顶部 header */
.qa-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(228, 231, 237, 0.6);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.qa-header__left {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.kb-select-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  background: #fff;
  color: #606266;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.kb-select-btn:hover {
  border-color: #409eff;
  color: #409eff;
}

.kb-select-btn__arrow {
  margin-left: 4px;
  font-size: 12px;
}

.kb-selected-tags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* 参数面板 */
.params-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.params-panel__item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.params-panel__label {
  font-size: 13px;
  color: #606266;
}

.params-panel__value {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.params-panel__toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #606266;
}

.params-panel__reset {
  align-self: flex-end;
  margin-top: 8px;
}

/* 消息区域 */
.qa-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.qa-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #909399;
}

.qa-empty__icon {
  width: 80px;
  height: 80px;
  border-radius: 20px;
  background: #ecf5ff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
  color: #409eff;
}

.qa-empty h3 {
  margin: 0 0 10px;
  font-size: 20px;
  font-weight: 600;
  color: #303133;
}

.qa-empty p {
  margin: 0 0 30px;
  font-size: 14px;
}

.qa-empty__prompts {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  max-width: 600px;
}

.qa-prompt-btn {
  padding: 14px;
  border: 1px solid #e4e7ed;
  border-radius: 10px;
  background: #fff;
  color: #606266;
  font-size: 13px;
  line-height: 1.5;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.qa-prompt-btn:hover {
  border-color: #409eff;
  color: #409eff;
}

/* 消息列表 */
.qa-message-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.qa-message {
  display: flex;
  gap: 12px;
  max-width: 800px;
}

.qa-message.user {
  margin-left: auto;
  flex-direction: row-reverse;
}

.qa-message__avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
}

.qa-message.user .qa-message__avatar {
  background: linear-gradient(135deg, #409eff 0%, #337ecc 100%);
  color: #fff;
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.3);
}

.qa-message.assistant .qa-message__avatar {
  background: linear-gradient(135deg, #f0f7ff 0%, #e6f1fc 100%);
  color: #409eff;
  box-shadow: 0 2px 6px rgba(64, 158, 255, 0.15);
}

.qa-message__content {
  padding: 16px 20px;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.7;
  transition: all 0.3s ease;
}

.qa-message.user .qa-message__content {
  background: linear-gradient(135deg, #409eff 0%, #337ecc 100%);
  color: #fff;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.25);
}

.qa-message.assistant .qa-message__content {
  background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%);
  border: 1px solid rgba(228, 231, 237, 0.8);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(255, 255, 255, 0.8) inset;
}

.qa-message__content :deep(p) {
  margin: 0 0 10px;
}

.qa-message__content :deep(p:last-child) {
  margin-bottom: 0;
}

.qa-message__content :deep(ul),
.qa-message__content :deep(ol) {
  margin: 0 0 10px;
  padding-left: 20px;
}

.qa-message__content :deep(code) {
  padding: 2px 6px;
  border-radius: 4px;
  background: #f5f7fa;
  font-size: 13px;
}

.qa-message.user .qa-message__content :deep(code) {
  background: rgba(255, 255, 255, 0.2);
}

.qa-message__content :deep(pre) {
  margin: 10px 0;
  padding: 12px;
  border-radius: 8px;
  background: #1e1e1e;
  color: #d4d4d4;
  overflow-x: auto;
}

.qa-message__content :deep(pre code) {
  padding: 0;
  background: transparent;
  color: inherit;
}

/* 处理中状态 */
.qa-message__processing {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #606266;
  padding: 4px 0;
}

.qa-loading__dots {
  display: flex;
  gap: 5px;
  align-items: center;
}

.qa-loading__dots span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: linear-gradient(135deg, #409eff 0%, #66b1ff 100%);
  animation: loading-bounce 1.2s infinite ease-in-out;
  box-shadow: 0 1px 3px rgba(64, 158, 255, 0.3);
}

.qa-loading__dots span:nth-child(2) { animation-delay: 0.16s; }
.qa-loading__dots span:nth-child(3) { animation-delay: 0.32s; }

@keyframes loading-bounce {
  0%, 100% { transform: translateY(0) scale(1); opacity: 0.4; }
  50% { transform: translateY(-6px) scale(1.1); opacity: 1; }
}

/* 失败状态 */
.qa-message__failed {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #f56c6c;
}

/* 引用来源 */
.qa-message__sources {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid rgba(235, 238, 245, 0.8);
}

.qa-sources__header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #909399;
  margin-bottom: 10px;
  font-weight: 500;
}

.qa-sources__list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.qa-sources__list .el-tag {
  background: linear-gradient(135deg, #f0f7ff 0%, #e8f2fe 100%);
  border-color: rgba(64, 158, 255, 0.2);
  color: #409eff;
  font-size: 12px;
}

/* 输入区域 */
.qa-input {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding: 16px 20px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(10px);
  border-top: 1px solid rgba(228, 231, 237, 0.6);
  box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.04);
}

.qa-input :deep(.el-textarea) {
  flex: 1;
}

.qa-input :deep(.el-textarea__inner) {
  min-height: 40px !important;
  padding: 10px 14px;
  border-radius: 10px;
  resize: none;
}

.qa-input .el-button {
  height: 40px;
  width: 40px;
  padding: 0;
  border-radius: 12px;
  background: linear-gradient(135deg, #409eff 0%, #337ecc 100%);
  border: none;
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.3);
  transition: all 0.3s ease;
}

.qa-input .el-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.4);
}

.qa-input .el-button:active:not(:disabled) {
  transform: translateY(0);
}

@media (max-width: 768px) {
  .qa-sidebar {
    display: none;
  }

  .qa-empty__prompts {
    grid-template-columns: 1fr;
  }
}
</style>
