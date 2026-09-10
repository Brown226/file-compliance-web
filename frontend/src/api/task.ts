import request from '@/utils/request'
import type { Task, TaskDetail, TaskFile, ReviewPlan } from '@/types/models'
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
  reviewMode?: string
  search?: string
  creator?: string
  startDate?: string
  endDate?: string
}) {
  return request.get<PaginatedResponse<Task>>('/tasks', { params })
}

// 获取任务详情
export function getTaskByIdApi(id: string) {
  return request.get<Task>(`/tasks/${id}`)
}

// 获取任务审查结果
export function getTaskDetailsApi(id: string) {
  return request.get<{ details: TaskDetail[]; files: TaskFile[] }>(`/tasks/${id}/details`)
}

// 获取任务审查进度
export interface ReviewStageItem {
  stageKey: string
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED'
  attemptCount: number
  error?: string | null
  fileName?: string | null
  updatedAt?: string
}

export function getTaskProgressApi(id: string) {
  return request.get<{ progress: number; status: string; completedFiles: number; totalFiles: number; stages?: ReviewStageItem[] }>(`/tasks/${id}/progress`)
}

// 导出任务审查报告(Excel)
export function exportTaskReportApi(id: string) {
  return request.get<Blob>(`/tasks/${id}/export`, { responseType: 'blob' })
}

// 导出任务审查报告(Word)
export function exportTaskReportWordApi(id: string) {
  return request.get<Blob>(`/tasks/${id}/export-word`, { responseType: 'blob' })
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

/**
 * 生成/重新生成任务级 Markdown 审查报告
 * 用于历史任务（无报告）或对 AI 版报告不满意时手动触发
 */
export function regenerateTaskReportApi(id: string) {
  return request.post<{ reportMarkdown: string }>(`/tasks/${id}/report`)
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
      standardRef: boolean;
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
    /** 智能判标开关（2026-08-26 扩展）：非 DEC 模式 AI 产出打置信度，LOW 转人工复核 */
    smartJudge: boolean;
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

// 标记/取消标记采纳
export function toggleAdoptApi(detailId: string, data: { adopted: boolean }) {
  return request.patch<TaskDetail>(`/tasks/details/${detailId}/adopt`, data)
}

// 轻量级上传（仅用于预分析，不创建任务）
export function uploadOnlyApi(formData: FormData) {
  return request.post<{
    code: number;
    message: string;
    data: {
      files: Array<{
        fileName: string;
        filePath: string;
        fileSize: number;
        fileType: string;
      }>;
    };
  }>('/tasks/upload-only', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}



// 获取任务审查摘要（聚合统计）
export function getReviewSummaryApi(id: string) {
  return request.get<{
    task: any;
    overview: { totalIssues: number; falsePositives: number; effectiveIssues: number; severityCounts: { error: number; warning: number; info: number } };
    noResultReasons?: string[];
    issueTypeCounts: Array<{ type: string; count: number }>;
    fileIssueCounts: Array<{ fileId: string; fileName: string; fileType: string; errorCount: number; totalIssues: number }>;
    topRuleCodes: Array<{ code: string; count: number; severity: string }>;
    fileCount: number;
  }>(`/tasks/${id}/review-summary`)
}

// 获取文件提取文本内容（用于原文预览定位）
export function getTaskFileContentApi(taskId: string, fileId: string) {
  return request.get<{ extractedText: string | null; fileName: string; fileType: string }>(`/tasks/${taskId}/files/${fileId}/content`)
}

// ==================== LLM 推理回放（阶段 3） ====================

/** LLM 调用日志（推理回放用） */
export interface LlmCallLog {
  id: string
  mode: string | null
  model: string
  provider: string | null
  promptTokens: number
  completionTokens: number
  totalTokens: number
  latencyMs: number
  status: 'success' | 'failed' | 'cache'
  errorMsg: string | null
  promptFull: string | null
  completionFull: string | null
  ragChunks: any
  createdAt: string
}

// 获取任务级 LLM 调用日志（推理回放）
export function getLlmLogsApi(taskId: string) {
  return request.get<LlmCallLog[]>(`/tasks/${taskId}/llm-logs`)
}
