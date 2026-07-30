import { useChat } from '@ai-sdk/vue'
import { DefaultChatTransport } from 'ai'
import { computed, ref } from 'vue'
import { useUserStore } from '@/stores/user'
import { listMessagesApi, type MessageItem } from '@/api/agent'

/**
 * Agent 对话 Composable
 * 基于 @ai-sdk/vue v4 的 useChat，封装 Agent 流式对话 + 文件会话绑定。
 */
export function useAgentChat() {
  const userStore = useUserStore()
  const sessionId = ref<string | null>(null)

  // transport 的 headers/body 支持 getter 函数，每次请求都会重新求值，
  // 因此 token 与 sessionId 的变化会被自动带入。
  const transport = new DefaultChatTransport({
    api: '/api/agent/chat/stream',
    headers: () => ({ Authorization: `Bearer ${userStore.token}` }),
    body: () => ({ sessionId: sessionId.value }),
    credentials: 'include',
  })

  const { messages, status, error, sendMessage, stop, regenerate } = useChat({ transport })

  // useChat v4 没有 isLoading，由 status 派生：
  // 'submitted' = 已发送待响应，'streaming' = 正在流式接收
  const isLoading = computed(
    () => status.value === 'submitted' || status.value === 'streaming',
  )

  /**
   * 加载历史会话消息并切换到该会话
   *
   * Task 17 遗留 TODO 补齐：把后端 MessageItem[] 转成 UIMessage 格式
   * （UIMessage 的 parts 是 [{ type: 'text', text: string }]），
   * 直接赋值给 messages.value 替换当前消息列表，同时绑定 sessionId。
   */
  async function loadHistory(sid: string): Promise<void> {
    const res = await listMessagesApi(sid)
    const historyMessages = (res.data as MessageItem[]).map(m => ({
      id: m.id,
      role: m.role === 'user' ? 'user' : 'assistant',
      parts: [{ type: 'text', text: m.content || '' }],
    }))
    messages.value = historyMessages as any
    sessionId.value = sid
  }

  /** 清空当前对话（开新会话） */
  function clearSession(): void {
    messages.value = [] as any
    sessionId.value = null
  }

  return {
    messages, status, error, sendMessage, stop, regenerate,
    isLoading, sessionId,
    loadHistory, clearSession,
  }
}
