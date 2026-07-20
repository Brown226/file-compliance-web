// 文档管理服务接口
import { getAuthorization, authStorage, redirectToLogin } from '@openspec/utils/auth'

// API 响应基础格式
export interface ApiResponse<T = any> {
  code: number
  message: string
  data: T | null
}

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

// 创建文档请求参数
export interface CreateDocumentRequest {
  name: string
  userId: string
  projectInfo: Record<string, any>
}

// 重命名文档请求参数
export interface RenameDocumentRequest {
  name: string
}

// 文档信息
export interface DocumentData {
  id: string
  name: string
  userId: string
  projectInfo: string
  metaTags?: string
  version: number
  lastModifiedBy?: string
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

// 获取文档列表请求参数
export interface GetDocumentListParams {
  page?: number
  pageSize?: number
  status?: 'draft' | 'reviewing' | 'finalized'
  keyword?: string
  userId: string // 必填
}

// 文档列表响应数据
export interface DocumentListData {
  total: number
  page: number
  pageSize: number
  list: DocumentData[]
}

const API_PREFIX = import.meta.env.AI_APP || ''
// API 基础配置（使用相对路径，生产同域，开发由 Vite 代理）
const API_BASE_URL = `${API_PREFIX}/api/v1`

// ===== Blocks（文档块）相关类型 =====
export type BlockType =
  | 'heading_1'
  | 'heading_2'
  | 'heading_3'
  | 'heading_4'
  | 'paragraph'
  | 'table'
  | 'list_item'
  | 'code_block'

export interface BlockData {
  id: string
  documentId: string
  blockType: BlockType
  orderKey: string
  level: number
  content: string
  blockName?: string
  metadata?: string
  isDeleted: boolean
  creatorId?: string
  modifierId?: string
  createdAt: string
  updatedAt: string
}

export interface BlockListData {
  total: number
  page: number
  pageSize: number
  list: BlockData[]
}

export interface GetBlockListParams {
  page?: number
  pageSize?: number
  blockType?: BlockType
  keyword?: string
}

export interface CreateBlockRequest {
  block_type: BlockType
  content: string
  level?: number
  parent_id?: string | null
  after_id?: string
}

export interface BatchCreateBlockItem {
  block_name: string
  block_type: BlockType
  content?: string
  docReference?: any
  chunkReference?: any
}

export interface BatchCreateBlocksRequest {
  anchor_after_id?: string
  level?: number
  parent_id?: string | null
  blocks: BatchCreateBlockItem[]
  returnOnlyIds?: boolean
}

export interface ExportMarkdownData {
  content: string
  fileName: string
}

/**
 * 根据文档ID获取文档详情
 * @param documentId 文档ID
 * @returns Promise<ApiResponse<DocumentData>>
 */
export async function getDocumentById(
  documentId: string
): Promise<ApiResponse<DocumentData>> {
  const url = `${API_BASE_URL}/documents/${documentId}`

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders()
    })

    if (!response.ok) {
      if (response.status === 401) {
        authStorage.clearAll()
        redirectToLogin()
        throw new Error('未授权，请重新登录')
      }
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse<DocumentData> = await response.json()

    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '获取文档详情失败')
    }
  } catch (error) {
    console.error('获取文档详情接口失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 获取文档列表
 * @param params 查询参数
 * @returns Promise<ApiResponse<DocumentListData>>
 */
export async function getDocumentList(
  params: GetDocumentListParams
): Promise<ApiResponse<DocumentListData>> {
  const queryParams = new URLSearchParams()
  
  if (params.page) {
    queryParams.append('page', params.page.toString())
  }
  if (params.pageSize) {
    queryParams.append('pageSize', params.pageSize.toString())
  }
  if (params.status) {
    queryParams.append('status', params.status)
  }
  if (params.keyword) {
    queryParams.append('keyword', params.keyword)
  }
  queryParams.append('userId', params.userId)
  
  const url = `${API_BASE_URL}/documents?${queryParams.toString()}`
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders()
    })

    if (!response.ok) {
      // 处理 401 未授权错误
      if (response.status === 401) {
        authStorage.clearAll()
        redirectToLogin()
        throw new Error('未授权，请重新登录')
      }
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse<DocumentListData> = await response.json()
    
    // 检查业务状态码
    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '获取文档列表失败')
    }
  } catch (error) {
    console.error('获取文档列表接口失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 创建文档
 * @param params 创建文档参数
 * @returns Promise<ApiResponse<DocumentData>>
 */
export async function createDocument(
  params: CreateDocumentRequest
): Promise<ApiResponse<DocumentData>> {
  const url = `${API_BASE_URL}/documents/create`
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(params)
    })

    if (!response.ok) {
      // 处理 401 未授权错误
      if (response.status === 401) {
        authStorage.clearAll()
        redirectToLogin()
        throw new Error('未授权，请重新登录')
      }
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse<DocumentData> = await response.json()
    
    // 检查业务状态码
    if (result.code === 201 || result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '创建文档失败')
    }
  } catch (error) {
    console.error('创建文档接口失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 重命名文档
 * @param documentId 文档ID
 * @param name 新文档名称
 * @returns Promise<ApiResponse>
 */
export async function renameDocument(
  documentId: string,
  name: string
): Promise<ApiResponse> {
  const url = `${API_BASE_URL}/documents/${documentId}/rename`
  
  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name })
    })

    if (!response.ok) {
      // 处理 401 未授权错误
      if (response.status === 401) {
        authStorage.clearAll()
        redirectToLogin()
        throw new Error('未授权，请重新登录')
      }
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse = await response.json()
    
    // 检查业务状态码
    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '重命名文档失败')
    }
  } catch (error) {
    console.error('重命名文档接口失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 删除文档
 * @param documentId 文档ID
 * @returns Promise<ApiResponse>
 */
export async function deleteDocument(
  documentId: string
): Promise<ApiResponse> {
  const url = `${API_BASE_URL}/documents/${documentId}`
  
  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: getAuthHeaders()
    })

    if (!response.ok) {
      // 处理 401 未授权错误
      if (response.status === 401) {
        authStorage.clearAll()
        redirectToLogin()
        throw new Error('未授权，请重新登录')
      }
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse = await response.json()
    
    // 检查业务状态码
    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '删除文档失败')
    }
  } catch (error) {
    console.error('删除文档接口失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

// ===== Blocks（文档块）服务 =====

/**
 * 获取文档块列表
 */
export async function getDocumentBlocks(
  documentId: string,
  params: GetBlockListParams = {}
): Promise<ApiResponse<BlockListData>> {
  const queryParams = new URLSearchParams()
  if (params.page) queryParams.append('page', String(params.page))
  if (params.pageSize) queryParams.append('pageSize', String(params.pageSize))
  if (params.blockType) queryParams.append('blockType', params.blockType)
  if (params.keyword) queryParams.append('keyword', params.keyword)

  const url = `${API_BASE_URL}/documents/${documentId}/blocks${queryParams.toString() ? `?${queryParams.toString()}` : ''}`

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders()
    })
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    const result: ApiResponse<BlockListData> = await response.json()
    if (result.code === 200) return result
    throw new Error(result.message || '获取文档块列表失败')
  } catch (error) {
    console.error('获取文档块列表接口失败:', error)
    return { code: 500, message: error instanceof Error ? error.message : '未知错误', data: null }
  }
}

/**
 * 新增文档块（单条）
 */
export async function createDocumentBlock(
  documentId: string,
  payload: CreateBlockRequest
): Promise<ApiResponse<BlockData>> {
  const url = `${API_BASE_URL}/documents/${documentId}/blocks`
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    })
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    const result: ApiResponse<BlockData> = await response.json()
    if (result.code === 201 || result.code === 200) return result
    throw new Error(result.message || '新增文档块失败')
  } catch (error) {
    console.error('新增文档块接口失败:', error)
    return { code: 500, message: error instanceof Error ? error.message : '未知错误', data: null }
  }
}

/**
 * 批量新增文档块
 */
export async function batchCreateDocumentBlocks<TReturn = any>(
  documentId: string,
  payload: BatchCreateBlocksRequest
): Promise<ApiResponse<TReturn[]>> {
  const url = `${API_BASE_URL}/documents/${documentId}/blocks/batch`
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    })
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    const result: ApiResponse<TReturn[]> = await response.json()
    if (result.code === 201 || result.code === 200) return result
    throw new Error(result.message || '批量新增文档块失败')
  } catch (error) {
    console.error('批量新增文档块接口失败:', error)
    return { code: 500, message: error instanceof Error ? error.message : '未知错误', data: null }
  }
}

/**
 * 获取文档块详情
 */
export async function getDocumentBlockDetail(
  documentId: string,
  blockId: string
): Promise<ApiResponse<BlockData>> {
  const url = `${API_BASE_URL}/documents/${documentId}/blocks/${blockId}`
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders()
    })
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    const result: ApiResponse<BlockData> = await response.json()
    if (result.code === 200) return result
    throw new Error(result.message || '获取文档块详情失败')
  } catch (error) {
    console.error('获取文档块详情接口失败:', error)
    return { code: 500, message: error instanceof Error ? error.message : '未知错误', data: null }
  }
}

/**
 * 更新文档块内容
 */
export async function updateDocumentBlock(
  documentId: string,
  blockId: string,
  payload: { block_name?: string; content?: string, docReference?: any[], chunkReference?: any[] }
): Promise<ApiResponse> {
  const url = `${API_BASE_URL}/documents/${documentId}/blocks/${blockId}`
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    })
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    const result: ApiResponse = await response.json()
    if (result.code === 200) return result
    throw new Error(result.message || '更新文档块失败')
  } catch (error) {
    console.error('更新文档块接口失败:', error)
    return { code: 500, message: error instanceof Error ? error.message : '未知错误', data: null }
  }
}

/**
 * 重命名文档块
 */
export async function renameDocumentBlock(
  documentId: string,
  blockId: string,
  name: string
): Promise<ApiResponse> {
  const url = `${API_BASE_URL}/documents/${documentId}/blocks/${blockId}/rename`
  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name })
    })
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    const result: ApiResponse = await response.json()
    if (result.code === 200) return result
    throw new Error(result.message || '重命名文档块失败')
  } catch (error) {
    console.error('重命名文档块接口失败:', error)
    return { code: 500, message: error instanceof Error ? error.message : '未知错误', data: null }
  }
}

/**
 * 删除文档块
 */
export async function deleteDocumentBlock(
  documentId: string,
  blockId: string
): Promise<ApiResponse> {
  const url = `${API_BASE_URL}/documents/${documentId}/blocks/${blockId}`
  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    })
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    const result: ApiResponse = await response.json()
    if (result.code === 200) return result
    throw new Error(result.message || '删除文档块失败')
  } catch (error) {
    console.error('删除文档块接口失败:', error)
    return { code: 500, message: error instanceof Error ? error.message : '未知错误', data: null }
  }
}

/**
 * 导出整文档为 Markdown
 */
export async function exportDocumentMarkdown(
  documentId: string
): Promise<ApiResponse<ExportMarkdownData>> {
  const url = `${API_BASE_URL}/documents/${documentId}/export/markdown`
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders()
    })
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    const result: ApiResponse<ExportMarkdownData> = await response.json()
    if (result.code === 200) return result
    throw new Error(result.message || '导出 Markdown 失败')
  } catch (error) {
    console.error('导出 Markdown 接口失败:', error)
    return { code: 500, message: error instanceof Error ? error.message : '未知错误', data: null }
  }
}

