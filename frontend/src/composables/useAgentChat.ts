import { useChat } from '@ai-sdk/vue'
import { DefaultChatTransport } from 'ai'
import { computed, ref } from 'vue'
import { useUserStore } from '@/stores/user'

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

  return { messages, status, error, sendMessage, stop, regenerate, isLoading, sessionId }
}
