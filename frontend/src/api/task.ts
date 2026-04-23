import request from '@/utils/request'
import type { Task, TaskDetail, TaskFile } from '@/types/models'
import type { PaginatedResponse } from '@/types/api'

// ==================== 合规审查任务 ====================

// 创建审查任务（文件上传方式）
export function createTaskApi(formData: FormData) {
  return request.post<Task>('/tasks', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

// 获取任务列表
export function getTasksApi(params?: {
  page?: number
  limit?: number
  status?: string
  title?: string
}) {
  return request.get<PaginatedResponse<Task>>('/tasks', { params })
}

// 获取任务详情
export function getTaskByIdApi(id: string) {
  return request.get<Task>(`/tasks/${id}`)
}

// 获取任务审查结果
export function getTaskDetailsApi(id: string) {
  return request.get<TaskDetail[]>(`/tasks/${id}/details`)
}

// 获取任务文件列表
export function getTaskFilesApi(id: string) {
  return request.get<TaskFile[]>(`/tasks/${id}/files`)
}

// 获取任务问题列表
export function getTaskIssuesApi(id: string) {
  return request.get<TaskDetail[]>(`/tasks/${id}/issues`)
}

// 获取任务审查进度
export function getTaskProgressApi(id: string) {
  return request.get<{ progress: number; status: string; completedFiles: number; totalFiles: number }>(`/tasks/${id}/progress`)
}

// 导出任务审查报告
export function exportTaskReportApi(id: string) {
  return request.get<Blob>(`/tasks/${id}/export`, { responseType: 'blob' })
}

// 删除任务
export function deleteTaskApi(id: string) {
  return request.delete<{ message: string }>(`/tasks/${id}`)
}

// 批量删除任务
export function deleteTasksApi(ids: string[]) {
  return request.delete<{ message: string; count: number }>('/tasks', { data: { ids } })
}

// 重新审核任务
export function reReviewTaskApi(id: string) {
  return request.post<Task>(`/tasks/${id}/review`)
}

// 更新任务状态
export function updateTaskStatusApi(id: string, status: string) {
  return request.patch<Task>(`/tasks/${id}/status`, { status })
}

// 获取审查模式列表（含能力配置）
export function getReviewModesApi() {
  return request.get<Array<{
    mode: string;
    displayName: string;
    description: string;
    needsRefFiles: boolean;
    capabilities: {
      rules: boolean;
      standardRef: 'on' | 'off' | 'config';
      ai: boolean;
      aiStrategy: 'standard' | 'llmOnly' | 'refCompare' | 'multimodal';
      crossFile: boolean;
      needsRefFiles: boolean;
    };
  }>>('/tasks/review-modes')
}

// 获取审查模式能力配置（可编辑版）
export function getModeCapabilitiesApi() {
  return request.get<Record<string, {
    enabled: boolean;
    rules: boolean;
    standardRef: boolean;
    ai: boolean;
    aiStrategy: 'standard' | 'llmOnly' | 'refCompare' | 'multimodal';
    crossFile: boolean;
  }>>('/tasks/mode-capabilities')
}

// 保存审查模式能力配置
export function saveModeCapabilitiesApi(config: Record<string, any>) {
  return request.put('/tasks/mode-capabilities', config)
}

// 上传参照文件
export function uploadRefFilesApi(taskId: string, formData: FormData) {
  return request.post<TaskFile[]>(`/tasks/${taskId}/ref-files`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

// 标记/取消标记误报
export function toggleFalsePositiveApi(detailId: string, data: { isFalsePositive: boolean; reason?: string }) {
  return request.patch<TaskDetail>(`/tasks/details/${detailId}/false-positive`, data)
}

// 获取文件提取文本内容（用于原文预览定位）
export function getTaskFileContentApi(taskId: string, fileId: string) {
  return request.get<{ extractedText: string | null; fileName: string; fileType: string }>(`/tasks/${taskId}/files/${fileId}/content`)
}
