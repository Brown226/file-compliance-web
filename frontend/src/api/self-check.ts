import request from '@/utils/request'

/** 单条自检结果 */
export interface SelfCheckItemAPI {
  docStandardNo: string
  docStandardName: string
  matchResult: {
    matched: boolean
    matchLevel: number
    libraryId?: string
    libraryStandardNo?: string
    libraryStandardName?: string
    libraryStandardStatus?: string
    similarity?: number
  }
  errorTypes: string[]
  noDiff?: { originalRanges: Array<{ start: number; length: number }>; correctRanges: Array<{ start: number; length: number }> } | null
  nameDiff?: { originalRanges: Array<{ start: number; length: number }>; correctRanges: Array<{ start: number; length: number }> } | null
  fullMatch: string
  sourceFile: string
  /** 在原文中的起始字符位置（0-based），-1 表示无位置 */
  startChar: number
  /** 在原文中的结束字符位置 */
  endChar: number
  /** 所在行号（1-based），-1 表示未知 */
  lineNumber: number
  /** 上下文文本片段（前后约200字符），用于预览定位 */
  contextText: string
}

/** 自检报告 */
export interface SelfCheckReportAPI {
  id: string
  totalChecked: number
  matchedCount: number
  errorCount: number
  items: SelfCheckItemAPI[]
  checkedAt: string
  standardLibraryInfo: {
    name: string
    total: number
  }
}

/** 标准库信息 */
export interface LibraryInfoAPI {
  folders: Array<{ id: string; name: string; count: number }>
  total: number
}

/** 获取可用的标准库列表 */
export function getSelfCheckLibraryInfoApi() {
  return request.get<LibraryInfoAPI>('/self-check/library-info')
}

/** 执行标准引用自检 */
export function runSelfCheckApi(formData: FormData) {
  return request.post<SelfCheckReportAPI>('/self-check/run', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 5 * 60 * 1000, // 5分钟超时（大文件+大标准库可能较慢）
  })
}

/** 导出自检报告 Excel */
export function exportSelfCheckReportApi(reportId: string) {
  return request.get<Blob>(`/self-check/report/${reportId}/export`, {
    responseType: 'blob',
  })
}

/** 错误类型中文映射 */
export function errorTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    NO_MATCH: '标准库中不存在该标准',
    NUMBER_MISMATCH: '编号错误',
    NAME_MISMATCH: '名称错误',
    ABOLISHED: '该标准已废止',
    UPCOMING: '该标准尚未实施',
    VERSION_MISMATCH: '版本号不匹配',
  }
  return labels[type] || type
}
