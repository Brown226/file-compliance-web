/**
 * 标准引用自检报告相关逻辑
 * 从 TaskResultsView.vue 提取
 */
import { ref, computed, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { Task, TaskDetail, TaskFile } from '@/types/models'

export interface SelfCheckReport {
  standardLibraryInfo?: {
    name?: string
    total?: number
  }
  items?: SelfCheckReportItem[]
  [key: string]: any
}

export interface SelfCheckReportItem {
  sourceFile?: string
  docStandardNo?: string
  docStandardName?: string
  errorTypes?: string[]
  matchResult?: {
    matched?: boolean
    matchLevel?: number
    libraryStandardNo?: string
    libraryStandardName?: string
  }
  fullMatch?: string
  startChar?: number
  [key: string]: any
}

export function useSelfCheck(
  task: Ref<Task | null>,
  taskId: Ref<string>,
  files: Ref<TaskFile[]>,
  filterFileId: Ref<string>,
  selectFile: (fileId: string) => void,
  locateTarget: Ref<any>,
) {
  const scSelected = ref<SelfCheckReportItem | null>(null)

  const isSelfCheck = computed(() => (task.value as any)?.reviewMode === 'SELF_CHECK')

  const scReport = computed((): SelfCheckReport | undefined => {
    return (task.value as any)?.selfCheckReport as SelfCheckReport | undefined
  })

  const scFilteredItems = computed(() => {
    const items = scReport.value?.items || []
    if (!filterFileId.value) return items
    const targetFile = files.value.find((f: TaskFile) => f.id === filterFileId.value)
    if (!targetFile) return items
    return items.filter((it: any) => it.sourceFile === targetFile.fileName)
  })

  const scSelectItem = (row: SelfCheckReportItem) => {
    scSelected.value = row
    if (row && row.startChar != null && row.startChar >= 0 && files.value.length > 0) {
      const file = files.value.find((f: TaskFile) => f.fileName === row.sourceFile)
      if (file) {
        selectFile(file.id)

        locateTarget.value = {
          originalText: row.fullMatch,
          textPosition: {
            chunkIndex: Math.floor(row.startChar / 4000),
            charOffset: row.startChar % 4000,
          },
        }
      }
    }
  }

  const scErrorTagType = (type: string) => {
    if (type === 'NO_MATCH') return 'danger'
    if (type === 'ABOLISHED') return 'warning'
    if (type === 'VERSION_MISMATCH') return 'primary'
    return ''
  }

  const scErrorLabel = (type: string) => {
    const m: Record<string, string> = {
      NO_MATCH: '不存在',
      NUMBER_MISMATCH: '编号错误',
      NAME_MISMATCH: '名称错误',
      ABOLISHED: '已废止',
      UPCOMING: '尚未实施',
      VERSION_MISMATCH: '版本不匹配',
    }
    return m[type] || type
  }

  const handleExportScReport = async () => {
    try {
      const { exportSelfCheckReportApi } = await import('@/api/self-check')
      const { data } = await exportSelfCheckReportApi(taskId.value)
      const blob = data as unknown as Blob
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `标准引用自检报告_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      ElMessage.success('报告导出成功')
    } catch (e) {
      console.error('导出失败:', e)
      ElMessage.error('导出报告失败')
    }
  }

  return {
    isSelfCheck,
    scReport,
    scSelected,
    scFilteredItems,
    scSelectItem,
    scErrorTagType,
    scErrorLabel,
    handleExportScReport,
  }
}
