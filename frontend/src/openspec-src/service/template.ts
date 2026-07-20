// 模板管理服务接口
import { getAuthorization, authStorage, redirectToLogin } from '@openspec/utils/auth'

// API 响应基础格式
export interface ApiResponse<T = any> {
  code: number
  message: string
  data: T | null
}

// 构建API基础URL
const API_PREFIX = import.meta.env.AI_APP || ''
const API_BASE_URL = `${API_PREFIX}/api/v1`
const AGENT_BASE_URL = '/agent'

/**
 * 获取带认证头的请求配置
 */
function getAuthHeaders(): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }
  
  const authorization = getAuthorization()
  if (authorization) {
    headers['Authorization'] = authorization
  }
  
  return headers
}

// 模板标签类型
export interface TemplateTag {
  id: number
  name: string
  category: 'profession' | 'business_type'
  isSystem: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

// 文档模板类型
export interface DocumentTemplate {
  id: number
  name: string
  description: string
  filePath: string
  fileName: string
  fileSize: number
  fileType: string
  status: 'uploaded' | 'parsing' | 'extracting' | 'saving' | 'completed' | 'success' | 'failed'
  errorMessage?: string
  userId: number
  isStandard: boolean
  downloadCount: number
  createdAt: string
  updatedAt: string
  tags?: TemplateTag[]
  content?: string  // 解析后的内容
  chapters?: string // 章节结构JSON
}

// CAD模板类型
export interface CadTemplate {
  id: number
  name: string
  description: string
  filePath: string
  fileName: string
  fileSize: number
  fileType: string
  userId: number
  downloadCount: number
  createdAt: string
  updatedAt: string
}

/**
 * 获取所有标签
 */
export async function getAllTags(): Promise<ApiResponse<TemplateTag[]>> {
  const url = `${API_BASE_URL}/template-tags`
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders()
    })

    if (!response.ok) {
      if (response.status === 401) {
        // 访客浏览时不强制跳转登录页，静默返回空数据
        throw new Error('未授权')
      }
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse<TemplateTag[]> = await response.json()
    
    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '获取标签列表失败')
    }
  } catch (error) {
    console.error('获取标签列表失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 根据分类获取标签
 */
export async function getTagsByCategory(category: string): Promise<ApiResponse<TemplateTag[]>> {
  const url = `${API_BASE_URL}/template-tags/category/${category}`
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders()
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse<TemplateTag[]> = await response.json()
    
    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '获取标签列表失败')
    }
  } catch (error) {
    console.error('获取标签列表失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 创建标签
 */
export async function createTag(data: {
  name: string
  category: string
  sortOrder?: number
}): Promise<ApiResponse<TemplateTag>> {
  const url = `${API_BASE_URL}/template-tags`
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data)
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse<TemplateTag> = await response.json()
    
    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '创建标签失败')
    }
  } catch (error) {
    console.error('创建标签失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 删除标签
 */
export async function deleteTag(id: number): Promise<ApiResponse<void>> {
  const url = `${API_BASE_URL}/template-tags/${id}`
  
  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: getAuthHeaders()
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse<void> = await response.json()
    
    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '删除标签失败')
    }
  } catch (error) {
    console.error('删除标签失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 获取文档模板列表
 */
export async function getDocumentTemplates(userId: string): Promise<ApiResponse<DocumentTemplate[]>> {
  const url = `${API_BASE_URL}/document-templates?userId=${userId}`
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders()
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse<DocumentTemplate[]> = await response.json()
    
    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '获取模板列表失败')
    }
  } catch (error) {
    console.error('获取模板列表失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 获取单个文档模板详情
 */
export async function getDocumentTemplate(templateId: number): Promise<ApiResponse<DocumentTemplate>> {
  const url = `${API_BASE_URL}/document-templates/${templateId}`
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders()
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse<DocumentTemplate> = await response.json()
    
    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '获取模板详情失败')
    }
  } catch (error) {
    console.error('获取模板详情失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 创建文档模板
 */
export async function createDocumentTemplate(data: {
  name: string
  description: string
  fileName: string
  fileSize: number
  fileType: string
  filePath: string
  userId: number
  isStandard?: boolean
}): Promise<ApiResponse<DocumentTemplate>> {
  const url = `${API_BASE_URL}/document-templates`
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data)
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse<DocumentTemplate> = await response.json()
    
    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '创建模板失败')
    }
  } catch (error) {
    console.error('创建模板失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 设置模板标签
 */
export async function setDocumentTemplateTags(templateId: number, tagIds: number[]): Promise<ApiResponse<void>> {
  const url = `${API_BASE_URL}/document-templates/${templateId}/tags`
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(tagIds)
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse<void> = await response.json()
    
    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '设置标签失败')
    }
  } catch (error) {
    console.error('设置标签失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 获取CAD模板
 */
export async function getCadTemplate(userId: string): Promise<ApiResponse<CadTemplate>> {
  const url = `${API_BASE_URL}/cad-templates/${userId}`
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders()
    })

    if (!response.ok) {
      if (response.status === 404) {
        return {
          code: 404,
          message: '未找到CAD模板',
          data: null
        }
      }
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse<CadTemplate> = await response.json()
    
    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '获取CAD模板失败')
    }
  } catch (error) {
    console.error('获取CAD模板失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 下载文档模板
 */
export async function downloadDocumentTemplate(templateId: number): Promise<ApiResponse<string>> {
  const url = `${API_BASE_URL}/document-templates/${templateId}/download`
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders()
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse<string> = await response.json()
    
    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '获取下载链接失败')
    }
  } catch (error) {
    console.error('获取下载链接失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 更新文档模板状态
 */
export async function updateDocumentTemplateStatus(templateId: number, status: string): Promise<ApiResponse<void>> {
  const url = `${API_BASE_URL}/document-templates/${templateId}/status?status=${status}`
  
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: getAuthHeaders()
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse<void> = await response.json()
    
    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '更新状态失败')
    }
  } catch (error) {
    console.error('更新状态失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 删除文档模板
 */
export async function deleteDocumentTemplate(templateId: number): Promise<ApiResponse<void>> {
  const url = `${API_BASE_URL}/document-templates/${templateId}`

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: getAuthHeaders()
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse<void> = await response.json()

    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '删除模板失败')
    }
  } catch (error) {
    console.error('删除模板失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 更新文档模板内容和章节
 */
export async function updateDocumentTemplateContent(
  templateId: number,
  content: string,
  chapters: string
): Promise<ApiResponse<void>> {
  const url = `${API_BASE_URL}/document-templates/${templateId}/content`

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ content, chapters })
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse<void> = await response.json()

    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '更新内容失败')
    }
  } catch (error) {
    console.error('更新内容失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

// ==================== 模板智能匹配 ====================

/**
 * 模板匹配结果类型
 */
export interface TemplateMatchResult {
  // 模板信息
  templateId: number
  templateName: string

  // 匹配的章节/Chunk信息
  chunkId: string
  chunkContent: string        // 用于填充 chapterTemplateText
  chapterTitle: string        // 从 chunk 中提取的章节标题

  // 匹配元数据
  similarity: number          // 0-1, 综合评分
  matchType: 'auto' | 'manual' | 'default'

  // 文档名称（可选）
  documentName?: string
}

/**
 * 搜索匹配的模板章节
 *
 * 基于 RAGFlow Metadata 的智能匹配，使用用户ID、章节标题和可选标签
 * 在个人模板知识库中进行权限过滤和向量检索
 */
export async function searchTemplateChapter(params: {
  userId: string
  chapterTitle: string
  professionTagId?: number
  businessTypeTagId?: number
  threshold?: number
  limit?: number
}): Promise<ApiResponse<{
  matched: TemplateMatchResult | null
  alternatives: TemplateMatchResult[]
}>> {
  const url = `${AGENT_BASE_URL}/template/search`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(params)
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result = await response.json()

    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '模板检索失败')
    }
  } catch (error) {
    console.error('模板检索失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 获取模板指定章节内容
 *
 * 根据模板ID和章节标题，检索对应的章节内容
 * 注意：该接口暂未实现，待后续根据需求开发
 */
export async function getTemplateChapter(
  templateId: number,
  chapterTitle: string
): Promise<ApiResponse<{
  templateId: number
  templateName: string
  chapterTitle: string
  chapterContent: string
  chapterIndex: number
  totalChapters: number
}>> {
  const url = `${AGENT_BASE_URL}/template/${templateId}/chapter?chapterTitle=${encodeURIComponent(chapterTitle)}`

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders()
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result = await response.json()

    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '获取模板章节失败')
    }
  } catch (error) {
    console.error('获取模板章节失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}
