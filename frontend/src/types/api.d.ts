/**
 * API 响应通用类型
 */

import type { AxiosResponse } from 'axios'

/** 统一 API 响应结构（后端返回格式：{ code, message, data }） */
export interface ApiResponse<T = unknown> {
  code: number
  message: string
  data: T
}

/** 分页请求参数 */
export interface PaginationParams {
  page?: number
  limit?: number
}

/** 分页响应结构 */
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  limit: number
}

/** 类型安全封装：请求返回的 data 部分类型 */
export type ApiData<T> = AxiosResponse<T>
