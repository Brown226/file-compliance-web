// 授权服务接口
import { getAuthorization } from '@openspec/utils/auth'

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

// 授权状态类型
export interface LicenseStatus {
  valid: boolean
  customerName?: string
  issueDate?: string
  features: {
    templateManagement: boolean
    memoryManagement: boolean
    [key: string]: boolean
  }
}

// 缓存授权状态
let cachedLicenseStatus: LicenseStatus | null = null
let cacheTimestamp: number = 0
const CACHE_DURATION = 5 * 60 * 1000 // 5分钟缓存

/**
 * 获取授权状态
 */
export async function getLicenseStatus(forceRefresh = false): Promise<LicenseStatus> {
  // 检查缓存
  const now = Date.now()
  if (!forceRefresh && cachedLicenseStatus && (now - cacheTimestamp) < CACHE_DURATION) {
    return cachedLicenseStatus
  }

  const url = `${API_BASE_URL}/license/status`

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders()
    })

    if (!response.ok) {
      // 请求失败时返回未授权状态
      return {
        valid: false,
        features: {
          templateManagement: false,
          memoryManagement: false
        }
      }
    }

    const result: LicenseStatus = await response.json()

    // 更新缓存
    cachedLicenseStatus = result
    cacheTimestamp = now

    return result
  } catch (error) {
    console.error('获取授权状态失败:', error)
    // 出错时返回未授权状态
    return {
      valid: false,
      features: {
        templateManagement: false,
        memoryManagement: false
      }
    }
  }
}

/**
 * 检查是否有模板管理功能授权
 */
export async function hasTemplateManagementLicense(): Promise<boolean> {
  const status = await getLicenseStatus()
  return status.features.templateManagement
}

/**
 * 检查是否有记忆管理功能授权
 */
export async function hasMemoryManagementLicense(): Promise<boolean> {
  const status = await getLicenseStatus()
  return status.features.memoryManagement
}

/**
 * 清除授权状态缓存
 */
export function clearLicenseCache(): void {
  cachedLicenseStatus = null
  cacheTimestamp = 0
}
