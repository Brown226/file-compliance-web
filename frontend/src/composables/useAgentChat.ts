import { useChat } from '@ai-sdk/vue'
import { DefaultChatTransport } from 'ai'
import { computed, ref } from 'vue'
import { useUserStore } from '@/stores/user'
import { listMessagesApi, type MessageItem } from '@/api/agent'
import { trimHistoryForTransport } from '@/utils/messageTrim'

/**
 * Agent 对话 Composable
 * 基于 @ai-sdk/vue v4 的 useChat，封装 Agent 流式对话 + 文件会话绑定。
 */
export function useAgentChat() {
  const userStore = useUserStore()
  const sessionId = ref<string | null>(null)

  // 会话设置（模型 / 工具预设 / 推理强度）
  // - 随 chat/stream 请求体透传，后端按需覆盖 LlmConfig / 工具过滤 / reasoningEffort
  // - 持久化由调用方负责（有 sessionId 时 PATCH /sessions/:id 的 settings）
  const modelKey = ref<string | null>(null)
  const toolPreset = ref<string>('full')
  const thinkingLevel = ref<string | null>(null)

  // Task 44：ask_user 恢复注入 — 用户回复挂起问题后，带 answer 重发，
  // transport.body 每次请求重新求值，因此置值后会随下一次 sendMessage 透传到后端
  const pendingAskAnswer = ref<{ requestId: string; answer: string } | null>(null)

  // transport 的 headers/body 支持 getter 函数，每次请求都会重新求值，
  // 因此 token 与 sessionId 的变化会被自动带入。
  //
  // prepareSendMessagesRequest：发送前对历史做瘦身（旧轮 tool output 截断，
  // 口径与后端 trimStaleToolOutputs 一致）。注意：一旦提供该钩子，返回的 body
  // 会整体替换 SDK 默认构造——id/messages/trigger/messageId 必须在这里自己拼回
  //（与 ai 包非钩子路径的字段保持完全一致），否则后端拿不到消息。
  const transport = new DefaultChatTransport({
    api: '/api/agent/chat/stream',
    headers: () => ({ Authorization: `Bearer ${userStore.token}` }),
    body: () => ({
      sessionId: sessionId.value,
      modelKey: modelKey.value,
      toolPreset: toolPreset.value,
      thinkingLevel: thinkingLevel.value,
      pendingAskAnswer: pendingAskAnswer.value,
    }),
    credentials: 'include',
    prepareSendMessagesRequest: ({ body, id, trigger, messageId, messages }) => ({
      body: {
        ...(body ?? {}),
        id,
        trigger,
        messageId,
        messages: trimHistoryForTransport(messages),
      },
    }),
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
    const historyMessages = (res.data as MessageItem[]).map(m => {
      // 先放文本 part，再从 debug.toolCalls 还原工具调用 part（历史回看显示 ToolCallChip）
      const parts: any[] = [{ type: 'text', text: m.content || '' }]
      const toolCalls = m.debug?.toolCalls
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          parts.push({
            type: `tool-${tc.toolName}`,
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input: tc.input,
            output: tc.output,
            state: tc.isError ? 'output-error' : 'output-available',
          })
        }
      }
      return {
        id: m.id,
        role: m.role === 'user' ? 'user' : 'assistant',
        parts,
        // P0-⑨ 知识引用溯源：保留后端写入的 sources（来源卡片渲染依赖此字段）
        sources: m.sources ?? undefined,
        createdAt: m.createdAt || undefined,
      }
    })
    messages.value = historyMessages as any
    sessionId.value = sid
  }

  /**
   * 新建会话：生成新的 sessionId（UUID）并清空消息。
   * 关键：不再把 sessionId 置 null——否则发送首条消息时后端因无 sessionId 无法持久化，
   * 导致左侧会话列表不产生历史记录。前端先生成 UUID，后端 ensureSession 会自动创建会话。
   */
  function startNewSession(): void {
    messages.value = [] as any
    sessionId.value = crypto.randomUUID()
  }

  /** 批量设置会话设置（切换会话/新建会话时同步 UI 状态） */
  function setSettings(settings: {
    modelKey?: string | null
    toolPreset?: string
    thinkingLevel?: string | null
  }): void {
    if (settings.modelKey !== undefined) modelKey.value = settings.modelKey
    if (settings.toolPreset !== undefined) toolPreset.value = settings.toolPreset
    if (settings.thinkingLevel !== undefined) thinkingLevel.value = settings.thinkingLevel
  }

  return {
    messages, status, error, sendMessage, stop, regenerate,
    isLoading, sessionId,
    modelKey, toolPreset, thinkingLevel, setSettings,
    loadHistory, startNewSession,
    pendingAskAnswer,
  }
}
