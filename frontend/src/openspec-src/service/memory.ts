/**
 * 记忆管理 API 服务
 */
import { authFetch } from '@openspec/utils/auth'

const MEMORY_BASE_URL = '/agent/memory'

export interface Memory {
  id: number
  user_id: string
  content: string
  chapter_name?: string
  source_type?: string
  category?: string
  similarity?: number
  created_at: string
}

/**
 * 获取用户记忆列表
 */
export async function listMemories(limit = 50, offset = 0): Promise<Memory[]> {
  const res = await authFetch(`${MEMORY_BASE_URL}/list?limit=${limit}&offset=${offset}`)
  const json = await res.json()
  return json.code === 200 ? json.data : []
}

/**
 * 语义搜索召回记忆
 */
export async function recallMemories(query: string, limit = 5): Promise<Memory[]> {
  const res = await authFetch(`${MEMORY_BASE_URL}/recall`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit }),
  })
  const json = await res.json()
  return json.code === 200 ? json.data : []
}

/**
 * 删除单条记忆
 */
export async function deleteMemory(id: number): Promise<boolean> {
  const res = await authFetch(`${MEMORY_BASE_URL}/${id}`, { method: 'DELETE' })
  const json = await res.json()
  return json.code === 200
}

/**
 * 分类标签映射（用于前端展示）
 */
export const CATEGORY_LABELS: Record<string, string> = {
  material_preference: '材料偏好',
  design_parameter: '设计参数',
  standard_reference: '规范引用',
  style_preference: '风格偏好',
  other: '其他',
}
