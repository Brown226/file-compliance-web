import { useChat } from '@ai-sdk/vue'
import { DefaultChatTransport } from 'ai'
import { computed, ref } from 'vue'
import { useUserStore } from '@/stores/user'
import { listMessagesApi, getGenerationStatusApi, cancelGenerationApi, type MessageItem } from '@/api/agent'
import { trimHistoryForTransport } from '@/utils/messageTrim'

/** 恢复轮询间隔（后端增量落库节流 2s，1.2s 轮询足够跟手） */
const RESUME_POLL_INTERVAL_MS = 1200
/** 恢复轮询兜底上限：生成端 600s 硬超时，轮询留裕量后强制退出 */
const RESUME_POLL_MAX_MS = 11 * 60 * 1000

/**
 * Agent 对话 Composable
 * 基于 @ai-sdk/vue v4 的 useChat，封装 Agent 流式对话 + 文件会话绑定。
 *
 * 断流恢复（2026-09-09）：浏览器刷新/关标签页后，服务端会继续生成并增量落库；
 * loadHistory 时查询在途生成状态，若有则在历史末尾合成一条流式 assistant 消息
 * 并轮询回填文本，结束后 reload 历史拿到终态行（含 sources/工具卡片）。
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

  const { messages, status, error, sendMessage: sdkSendMessage, stop: sdkStop, regenerate } = useChat({ transport })

  // useChat v4 没有 isLoading，由 status 派生：
  // 'submitted' = 已发送待响应，'streaming' = 正在流式接收
  const isLoading = computed(
    () => status.value === 'submitted' || status.value === 'streaming' || isResuming.value,
  )

  // ==================== 断流恢复 ====================

  /** 是否正在恢复在途生成（loadHistory 检测到后端续跑中的生成） */
  const isResuming = ref(false)
  /** 恢复轮询定时器 */
  let resumePoller: ReturnType<typeof setInterval> | null = null
  /** 轮询守护的会话 id：切换会话后立即停止旧轮询 */
  let resumeSessionId: string | null = null

  /** 后端 MessageItem → UIMessage（loadHistory 与恢复完成后的 reload 共用） */
  function toUIMessages(items: MessageItem[]): any[] {
    return items.map(m => {
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
      // P1：还原思考过程（与流式渲染对称；后端 2026 起随 debug.reasoning 持久化）
      const reasoning = Array.isArray(m.debug?.reasoning) ? m.debug.reasoning : []
      if (reasoning.length > 0) {
        parts.push({ type: 'reasoning', text: reasoning.join('\n\n') })
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
  }

  function stopResumePolling(): void {
    if (resumePoller !== null) {
      clearInterval(resumePoller)
      resumePoller = null
    }
    resumeSessionId = null
  }

  /**
   * 恢复完成：reload 历史拿到终态行（完整内容 + sources/debug 工具卡片），
   * 替换掉轮询期间合成的流式消息。
   */
  async function finishResume(sid: string): Promise<void> {
    stopResumePolling()
    isResuming.value = false
    if (sessionId.value !== sid) return // 用户已切走，不再刷新消息区
    try {
      const res = await listMessagesApi(sid)
      // 过滤同会话下可能仍存在的 processing 行（终态回写是异步的，极端竞态下未及时落终态）
      messages.value = toUIMessages(res.data.filter(m => m.status !== 'processing')) as any
    } catch {
      // reload 失败时保留轮询末次的合成消息文本，不打断用户
    }
  }

  /**
   * 启动恢复轮询：定时拉取在途生成快照，把已累积文本回填到合成的流式消息上，
   * 直到后端生成结束（active=false）后 reload 历史。
   */
  function startResumePolling(sid: string, resumingMessageId: string, initial: { text: string; messageId: string | null }): void {
    stopResumePolling()
    resumeSessionId = sid
    isResuming.value = true
    const pollStartedAt = Date.now()

    // 立即回填首查文本（历史里 processing 行可能比 status 快照更新）
    const ensureResumingMessage = (): any => {
      let target = messages.value.find((m: any) => m.id === resumingMessageId)
      if (!target) {
        target = { id: resumingMessageId, role: 'assistant', parts: [{ type: 'text', text: '' }] }
        messages.value = [...messages.value, target] as any
      }
      return target
    }
    const target = ensureResumingMessage()
    target.parts = [{ type: 'text', text: initial.text }]

    resumePoller = setInterval(async () => {
      if (resumeSessionId !== sid || sessionId.value !== sid) {
        stopResumePolling()
        isResuming.value = false
        return
      }
      if (Date.now() - pollStartedAt > RESUME_POLL_MAX_MS) {
        // 生成端 600s 硬超时仍未结束（异常）：退出轮询，reload 历史兜底
        await finishResume(sid)
        return
      }
      try {
        const res = await getGenerationStatusApi(sid)
        const gen = res.data
        // 无跟踪记录（服务重启/已完成出宽限期）→ reload 历史兜底
        if (!gen?.tracked) {
          await finishResume(sid)
          return
        }
        const msg = ensureResumingMessage()
        msg.parts = [{ type: 'text', text: gen.text ?? '' }]
        if (!gen.active) {
          await finishResume(sid)
        }
      } catch {
        // 网络抖动：继续下一轮轮询
      }
    }, RESUME_POLL_INTERVAL_MS)
  }

  // ==================== 对外 API ====================

  /**
   * 加载历史会话消息并切换到该会话
   *
   * Task 17 遗留 TODO 补齐：把后端 MessageItem[] 转成 UIMessage 格式
   * （UIMessage 的 parts 是 [{ type: 'text', text: string }]），
   * 直接赋值给 messages.value 替换当前消息列表，同时绑定 sessionId。
   *
   * 断流恢复：若该会话有服务端续跑中的生成（刷新/关标签页后重进），过滤掉
   * 落库中的 processing 行（正在被后端增量回写），在历史末尾合成流式消息并
   * 轮询直至生成结束。
   */
  async function loadHistory(sid: string): Promise<void> {
    // 切换会话：停掉旧会话的恢复轮询
    stopResumePolling()
    isResuming.value = false

    const res = await listMessagesApi(sid)
    let items = res.data

    // 恢复在途生成（best-effort：状态接口失败不影响正常历史加载）
    let gen: Awaited<ReturnType<typeof getGenerationStatusApi>>['data'] | null = null
    try {
      gen = (await getGenerationStatusApi(sid)).data
    } catch {
      gen = null
    }
    if (gen?.tracked && gen.active) {
      // 过滤正在被后端回写的 processing 行（messageId 已知时按 id 过滤；
      // 行尚未创建（messageId=null）时历史里也不会有）
      if (gen.messageId) {
        items = items.filter(m => !(m.role === 'assistant' && m.id === gen!.messageId))
      }
      messages.value = toUIMessages(items) as any
      sessionId.value = sid
      startResumePolling(sid, `resuming-${gen.messageId ?? 'pending'}`, {
        text: gen.text ?? '',
        messageId: gen.messageId ?? null,
      })
      return
    }

    messages.value = toUIMessages(items) as any
    sessionId.value = sid
  }

  /**
   * 发送消息（透传 SDK，仅为语义完整保留同名出口）
   */
  function sendMessage(...args: Parameters<typeof sdkSendMessage>): void {
    (sdkSendMessage as any)(...args)
  }

  /**
   * 停止生成：「停止」按钮。
   * 断流恢复改造后，断开连接不再中止服务端生成——必须显式调用
   * POST /generation/cancel，否则后端会把回答生成完并落库。
   * 取消请求 best-effort（fire-and-forget），SDK 侧先停保证 UI 立即响应。
   */
  function stop(): void {
    sdkStop()
    const sid = sessionId.value
    if (sid) {
      cancelGenerationApi(sid).catch(() => {})
    }
  }

  /**
   * 新建会话：生成新的 sessionId（UUID）并清空消息。
   * 关键：不再把 sessionId 置 null——否则发送首条消息时后端因无 sessionId 无法持久化，
   * 导致左侧会话列表不产生历史记录。前端先生成 UUID，后端 ensureSession 会自动创建会话。
   */
  function startNewSession(): void {
    stopResumePolling()
    isResuming.value = false
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
    isLoading, sessionId, isResuming,
    modelKey, toolPreset, thinkingLevel, setSettings,
    loadHistory, startNewSession,
    pendingAskAnswer,
  }
}
