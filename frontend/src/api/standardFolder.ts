import request from '@/utils/request'
import type { StandardFolder } from '@/types/models'

// ==================== 标准文件夹管理 ====================

// 获取文件夹树形结构
export function getFolderTreeApi() {
  return request.get<StandardFolder[]>('/standard-folders/tree')
}

// 获取所有文件夹（扁平列表）
export function getAllFoldersApi() {
  return request.get<StandardFolder[]>('/standard-folders')
}

// 创建文件夹
export function createFolderApi(data: { name: string; parentId?: string }) {
  return request.post<StandardFolder>('/standard-folders', data)
}

// 更新文件夹
export function updateFolderApi(id: string, data: { name?: string; parentId?: string | null }) {
  return request.put<StandardFolder>(`/standard-folders/${id}`, data)
}

// 删除文件夹
export function deleteFolderApi(id: string) {
  return request.delete<{ message: string }>(`/standard-folders/${id}`)
}
