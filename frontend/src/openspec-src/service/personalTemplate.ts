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

// 定义个人模板类型
export interface PersonalTemplate {
  id: number | string
  name: string
  content: string
  userId: number
  createdAt: string
  updatedAt: string
}

// 定义请求类型
export interface CreateTemplateRequest {
  name: string
  content: string
  userId: number
}

export interface UpdateTemplateRequest {
  name: string
  content: string
}

export interface QueryTemplateRequest {
  userId: number
  keyword?: string
  page?: number
  pageSize?: number
}

/**
 * 创建个人模板
 */
export async function createPersonalTemplate(
  data: CreateTemplateRequest
): Promise<ApiResponse<PersonalTemplate>> {
  try {
    const response = await fetch(`${API_BASE_URL}/personal-template`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data)
    })

    if (!response.ok) {
      if (response.status === 401) {
        authStorage.clearAll()
        redirectToLogin()
        throw new Error('未授权，请重新登录')
      }
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse<PersonalTemplate> = await response.json()
    
    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '创建个人模板失败')
    }
  } catch (error) {
    console.error('创建个人模板接口失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 更新个人模板
 */
export async function updatePersonalTemplate(
  id: number | string,
  data: UpdateTemplateRequest
): Promise<ApiResponse<PersonalTemplate>> {
  try {
    const response = await fetch(`${API_BASE_URL}/personal-template/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data)
    })

    if (!response.ok) {
      if (response.status === 401) {
        authStorage.clearAll()
        redirectToLogin()
        throw new Error('未授权，请重新登录')
      }
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse<PersonalTemplate> = await response.json()
    
    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '更新个人模板失败')
    }
  } catch (error) {
    console.error('更新个人模板接口失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 删除个人模板
 */
export async function deletePersonalTemplate(
  id: number | string
): Promise<ApiResponse<void>> {
  try {
    const response = await fetch(`${API_BASE_URL}/personal-template/${id}`, {
      method: 'DELETE',
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

    const result: ApiResponse<void> = await response.json()
    
    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '删除个人模板失败')
    }
  } catch (error) {
    console.error('删除个人模板接口失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 获取个人模板详情
 */
export async function getPersonalTemplate(
  id: number | string
): Promise<ApiResponse<PersonalTemplate>> {
  try {
    const response = await fetch(`${API_BASE_URL}/personal-template/${id}`, {
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

    const result: ApiResponse<PersonalTemplate> = await response.json()
    
    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '获取个人模板详情失败')
    }
  } catch (error) {
    console.error('获取个人模板详情接口失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}

/**
 * 查询个人模板列表
 */
export interface PersonalTemplateListData {
  total: number
  page: number
  pageSize: number
  list: PersonalTemplate[]
}

export async function getPersonalTemplates(
  params: QueryTemplateRequest
): Promise<ApiResponse<PersonalTemplateListData>> {
  try {
    const response = await fetch(`${API_BASE_URL}/personal-template/list`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(params)
    })

    if (!response.ok) {
      if (response.status === 401) {
        authStorage.clearAll()
        redirectToLogin()
        throw new Error('未授权，请重新登录')
      }
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const result: ApiResponse<PersonalTemplateListData> = await response.json()
    
    if (result.code === 200) {
      return result
    } else {
      throw new Error(result.message || '获取个人模板列表失败')
    }
  } catch (error) {
    console.error('获取个人模板列表接口失败:', error)
    return {
      code: 500,
      message: error instanceof Error ? error.message : '未知错误',
      data: null
    }
  }
}