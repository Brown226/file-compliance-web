/**
 * 通用 SSE（Server-Sent Events）工具
 * 替代 API 层直接使用 fetch 的做法，统一 token 传递和错误处理
 */

export interface SSEOptions {
  /** 请求 URL */
  url: string
  /** 请求方法 */
  method?: string
  /** JWT token */
  token: string
  /** 请求体 */
  body?: unknown
  /** 消息回调（data 为解析后的数据，eventType 为 SSE event 字段值，默认 'message'） */
  onMessage: (data: unknown, eventType?: string) => void
  /** 错误回调 */
  onError?: (error: string) => void
  /** 完成回调 */
  onComplete?: () => void
  /** AbortSignal，用于取消 SSE 连接（如组件 onUnmounted 时 abort） */
  signal?: AbortSignal
}

/** 分发单个 SSE 事件 */
function dispatchEvent(
  dataLines: string[],
  eventType: string,
  onMessage: (data: unknown, eventType?: string) => void,
): void {
  const jsonStr = dataLines.join('\n')
  try {
    const data = JSON.parse(jsonStr)
    onMessage(data, eventType)
  } catch (parseErr) {
    // JSON 解析失败，尝试作为纯文本处理
    console.warn('[SSE] JSON 解析失败:', jsonStr)
    onMessage({ raw: jsonStr }, eventType)
  }
}

/**
 * 发起 SSE 流式请求
 */
export async function fetchSSE(options: SSEOptions): Promise<void> {
  const { url, method = 'POST', token, body, onMessage, onError, onComplete, signal } = options

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })

  if (!response.ok) {
    const errMsg = `SSE 请求失败: ${response.status} ${response.statusText}`
    onError?.(errMsg)
    throw new Error(errMsg)
  }

  if (!response.body) {
    const errMsg = 'SSE 响应体为空'
    onError?.(errMsg)
    throw new Error(errMsg)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    let currentEventType = 'message'
    let currentDataLines: string[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        // 空行表示一个 SSE 事件结束，分发积攒的数据
        if (line === '' || line === '\r') {
          if (currentDataLines.length > 0) {
            dispatchEvent(currentDataLines, currentEventType, onMessage)
            currentDataLines = []
            currentEventType = 'message'
          }
          continue
        }

        // 解析 event: 字段
        if (line.startsWith('event:')) {
          currentEventType = line.slice(6).trim()
          continue
        }

        // 解析 data: 字段（支持多行，用 \n 拼接）
        if (line.startsWith('data:')) {
          currentDataLines.push(line.slice(5).replace(/^\s/, ''))
          continue
        }

        // 忽略 id:, retry:, comment 等其他 SSE 字段
      }
    }

    // 流结束后，处理最后未分发的事件（无结尾空行的情况）
    if (currentDataLines.length > 0) {
      dispatchEvent(currentDataLines, currentEventType, onMessage)
    }
  } catch (err) {
    // 释放流资源
    await reader.cancel()
    const errMsg = err instanceof Error ? err.message : 'SSE 读取异常'
    onError?.(errMsg)
    throw err
  } finally {
    onComplete?.()
  }
}
