import request from '@/utils/request'

export interface RuleFolderTreeNode {
  id: string
  label: string
  count: number
  sortOrder: number
  parentId?: string | null
  children: RuleFolderTreeNode[]
}

export interface CreateFolderData {
  name: string
  parentId?: string | null
}

/** 获取目录树 */
export const getRuleFoldersApi = () =>
  request.get<RuleFolderTreeNode[]>('/rule-folders')

/** 创建目录 */
export const createRuleFolderApi = (data: CreateFolderData) =>
  request.post<RuleFolderTreeNode>('/rule-folders', data)

/** 更新目录名称 */
export const updateRuleFolderApi = (id: string, data: { name: string }) =>
  request.put(`/rule-folders/${id}`, data)

/** 删除目录 */
export const deleteRuleFolderApi = (id: string) =>
  request.delete(`/rule-folders/${id}`)

/** 移动目录到目标 */
export const moveRuleFoldersApi = (ids: string[], targetId: string) =>
  request.post('/rule-folders/move', { ids, targetId })

/** 合并目录 */
export const mergeRuleFoldersApi = (ids: string[], name: string) =>
  request.post('/rule-folders/merge', { ids, name })
