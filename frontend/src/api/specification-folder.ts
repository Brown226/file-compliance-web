import request from '@/utils/request'

export interface SpecificationFolderTreeNode {
  id: string
  label: string
  count: number
  sortOrder: number
  parentId?: string | null
  children: SpecificationFolderTreeNode[]
}

export interface CreateFolderData {
  name: string
  parentId?: string | null
}

export const getSpecificationFoldersApi = () =>
  request.get<SpecificationFolderTreeNode[]>('/specification-folders')

export const createSpecificationFolderApi = (data: CreateFolderData) =>
  request.post<SpecificationFolderTreeNode>('/specification-folders', data)

export const updateSpecificationFolderApi = (id: string, data: { name: string }) =>
  request.put(`/specification-folders/${id}`, data)

export const deleteSpecificationFolderApi = (id: string) =>
  request.delete(`/specification-folders/${id}`)

export const moveSpecificationFoldersApi = (ids: string[], targetId: string) =>
  request.post('/specification-folders/move', { ids, targetId })

export const mergeSpecificationFoldersApi = (ids: string[], name: string) =>
  request.post('/specification-folders/merge', { ids, name })