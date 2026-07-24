/**
 * 项目问答 API 服务
 *
 * 对接 Python Agent 的 /agent/workflow/chat/stream 接口
 * （原 qa.ts 调用的 /agent/rag/ragflow/chat_electric_qa 等接口在 agent 中
 *  不存在，已废弃。现统一走 workflow 流式接口。）
 *
 * 走 Vite /agent 代理（dev）或 Nginx 反代（prod），使用相对路径。
 */
import { authFetch } from '@openspec/utils/auth'

// --- 类型定义 ---

export interface DocReference {
  document_id: string
  document_name: string
}

export interface ChunkReference {
  doc_id: string
  doc_name: string
  content?: string
  chunk_content?: string
  position?: any
  image_id?: string
  type?: string
}

/** workflow 流式接收到的事件载荷（逐事件） */
export interface WorkflowChunk {
  /** 本次增量文本（token 事件） */
  content?: string
  /** 思考摘要（timeline_step 完成时携带） */
  thoughts?: string
  /** 引用块（reference 事件） */
  docReferences?: DocReference[]
  chunkReferences?: ChunkReference[]
  /** 事件类型，便于上层区分处理 */
  event?: string
}

export interface ChatCompleteResponse {
  content: string
  thoughts?: string
  docReferences: DocReference[]
  chunkReferences: ChunkReference[]
}

/** workflow/chat/stream 请求体 */
export interface WorkflowChatParams {
  message: string
  projectId?: string
  documentId?: string
  chapterName?: string
  template?: string
  projectInfo?: string
  additionalRequirements?: string
  professionTagId?: number
  businessTypeTagId?: number
}

// --- 核心函数 ---

/**
 * 调用 Agent /agent/workflow/chat/stream 流式接口
 *
 * Agent SSE 协议（见 backend/openspec-agent/api/workflow_api.py）：
 *   event: token           / data: { content, node, timestamp }
 *   event: timeline_step   / data: { id, title, status, thought, duration }
 *   event: tool_call       / data: { name, display_name, status, result }
 *   event: reference       / data: { chunk_reference, doc_aggs }
 *   event: memory_recalled / data: { memories }
 *   event: done            / data: { timestamp }
 *   event: error           / data: { type, message, suggestion }
 */
export async function chatWithWorkflowStream(
  params: WorkflowChatParams,
  callbacks: {
    onChunk?: (chunk: WorkflowChunk) => void
    onComplete?: (response: ChatCompleteResponse) => void
    onError?: (error: Error) => void
  },
  signal?: AbortSignal,
): Promise<ChatCompleteResponse | undefined> {
  const fullUrl = '/agent/workflow/chat/stream'

  const response = await authFetch(fullUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  })

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  if (!response.body) {
    throw new Error('ReadableStream not supported in this browser.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  let fullContent = ''
  let allThoughts = ''
  const allDocRefs: DocReference[] = []
  const allChunkRefs: ChunkReference[] = []
  let sseBuffer = ''

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel()
        throw new DOMException('The operation was aborted.', 'AbortError')
      }

      const { done, value } = await reader.read()
      if (done) break

      sseBuffer += decoder.decode(value, { stream: true })

      // SSE 事件以 \n\n 分隔
      let sepIdx: number
      while ((sepIdx = sseBuffer.indexOf('\n\n')) !== -1) {
        const rawEvent = sseBuffer.slice(0, sepIdx)
        sseBuffer = sseBuffer.slice(sepIdx + 2)
        parseSseEvent(rawEvent)
      }
    }
    // 处理尾部残留
    if (sseBuffer.trim()) parseSseEvent(sseBuffer)
  } catch (err: any) {
    if (err.name === 'AbortError') throw err
    console.warn('Failed to read stream:', err)
  }

  const fullResponse: ChatCompleteResponse = {
    content: fullContent,
    thoughts: allThoughts,
    docReferences: allDocRefs,
    chunkReferences: allChunkRefs,
  }

  callbacks.onComplete?.(fullResponse)
  return fullResponse

  // --- SSE 事件解析（闭包，复用外层累积变量） ---
  function parseSseEvent(raw: string) {
    const lines = raw.split('\n')
    let eventType = 'message'
    let dataStr = ''
    for (const ln of lines) {
      if (ln.startsWith('event:')) {
        eventType = ln.slice(6).trim()
      } else if (ln.startsWith('data:')) {
        dataStr += ln.slice(5).trim()
      } else if (ln.startsWith(':')) {
        // SSE 注释 / keep-alive，忽略
      }
    }
    if (!dataStr) return

    let payload: any
    try {
      payload = JSON.parse(dataStr)
    } catch {
      // 非 JSON 的 data（可能是 keep-alive 文本），忽略
      return
    }

    switch (eventType) {
      case 'token': {
        const text: string = payload.content || ''
        if (text) {
          fullContent += text
          callbacks.onChunk?.({ content: text, event: 'token' })
        }
        break
      }
      case 'timeline_step': {
        // 步骤完成时携带 thought 摘要
        if (payload.status === 'completed' && payload.thought) {
          allThoughts += (allThoughts ? '\n' : '') + payload.thought
          callbacks.onChunk?.({ thoughts: payload.thought, event: 'timeline_step' })
        }
        break
      }
      case 'reference': {
        const chunks: ChunkReference[] = payload.chunk_reference || []
        const docs: DocReference[] = (payload.doc_aggs || []).map((d: any) => ({
          document_id: d.doc_id || d.id,
          document_name: d.doc_name || d.name,
        }))
        allChunkRefs.push(...chunks)
        allDocRefs.push(...docs)
        callbacks.onChunk?.({
          docReferences: docs,
          chunkReferences: chunks,
          event: 'reference',
        })
        break
      }
      case 'memory_recalled': {
        // 记忆召回事件，暂不展示在对话流，可后续扩展
        break
      }
      case 'error': {
        const errMsg = payload.message || 'Agent 内部错误'
        callbacks.onError?.(new Error(errMsg))
        break
      }
      case 'done':
      case 'session_start':
      default:
        // 其他事件忽略
        break
    }
  }
}
