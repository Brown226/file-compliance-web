import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  chatWithWorkflowStream,
  type DocReference,
  type ChunkReference,
} from '@openspec/service/qa'

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  loading?: boolean
  error?: string
  thoughts?: string
  docReferences?: DocReference[]
  chunkReferences?: ChunkReference[]
}

export function useQAChat() {
  const chatMessages = ref<ChatMessage[]>([])
  const isGenerating = ref(false)
  const currentAbortController = ref<AbortController | null>(null)

  /**
   * 发送问题到 Agent /agent/workflow/chat/stream
   *
   * @param question 用户问题
   * @param projectId 项目 ID（用作会话隔离）
   * @param documentId 文档 ID（agent 用作 LangGraph thread_id）
   */
  async function askQuestion(
    question: string,
    projectId?: string,
    documentId?: string,
  ) {
    const q = question.trim()
    if (!q || isGenerating.value) return

    // 1. 添加用户消息
    chatMessages.value.push({
      id: Date.now(),
      role: 'user',
      content: q,
    })

    // 2. 添加 AI 占位消息
    const aiMessage: ChatMessage = {
      id: Date.now() + 1,
      role: 'assistant',
      content: '',
      loading: true,
    }
    chatMessages.value.push(aiMessage)
    isGenerating.value = true

    // 3. 流式请求
    const abortController = new AbortController()
    currentAbortController.value = abortController

    // 累积引用（chunk 中可能多次返回）
    const allDocRefs: DocReference[] = []
    const allChunkRefs: ChunkReference[] = []

    try {
      await chatWithWorkflowStream(
        {
          message: q,
          projectId,
          documentId: documentId || projectId, // 默认用 projectId 作 thread_id
        },
        {
          // onChunk
          onChunk: (chunk) => {
            if (chunk.content) {
              aiMessage.content += chunk.content
            }
            if (chunk.thoughts) {
              aiMessage.thoughts = (aiMessage.thoughts || '') + chunk.thoughts
            }
            if (chunk.docReferences?.length) {
              allDocRefs.push(...chunk.docReferences)
            }
            if (chunk.chunkReferences?.length) {
              allChunkRefs.push(...chunk.chunkReferences)
            }
          },
          // onComplete
          onComplete: () => {
            aiMessage.loading = false
            aiMessage.docReferences = allDocRefs
            aiMessage.chunkReferences = allChunkRefs
            isGenerating.value = false
            currentAbortController.value = null
          },
          // onError
          onError: (err) => {
            aiMessage.error = err.message
          },
        },
        abortController.signal,
      )
    } catch (err: any) {
      aiMessage.loading = false
      isGenerating.value = false
      currentAbortController.value = null

      if (err.name === 'AbortError') {
        // 用户主动取消，不报错
        return
      }
      aiMessage.error = err.message || '请求失败'
      aiMessage.content = aiMessage.content || `请求失败: ${err.message}`
      ElMessage.error(err.message || '请求失败')
    }
  }

  function stopGeneration() {
    currentAbortController.value?.abort()
    // 找到最后一条 loading 的 AI 消息，标记为完成
    const lastAi = [...chatMessages.value].reverse().find(
      (m) => m.role === 'assistant' && m.loading
    )
    if (lastAi) {
      lastAi.loading = false
    }
    isGenerating.value = false
    currentAbortController.value = null
  }

  function clearMessages() {
    chatMessages.value = []
  }

  return {
    chatMessages,
    isGenerating,
    askQuestion,
    stopGeneration,
    clearMessages,
  }
}
