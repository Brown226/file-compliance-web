import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { exportTaskReportWordApi, exportTaskReportApi } from '@/api/task'

export function useTaskExport(taskId: () => string, taskTitle: () => string) {
  const exporting = ref(false)

  const downloadBlob = (blob: Blob, filename: string) => {
    if (!blob || blob.size === 0) {
      ElMessage.warning('暂无可导出的内容')
      return false
    }
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    window.URL.revokeObjectURL(url)
    return true
  }

  const exportToWord = async () => {
    if (exporting.value) return
    exporting.value = true
    try {
      const res = await exportTaskReportWordApi(taskId.value)
      const success = downloadBlob(res.data, `${taskTitle() || '审查报告'}_Word版.docx`)
      if (success) ElMessage.success('Word导出成功')
    } catch (e) {
      console.error('[useTaskExport] Word导出失败:', e)
      ElMessage.error('导出Word失败')
    } finally {
      exporting.value = false
    }
  }

  const exportToExcel = async () => {
    if (exporting.value) return
    exporting.value = true
    try {
      const res = await exportTaskReportApi(taskId.value)
      const success = downloadBlob(res.data, `${taskTitle() || '审查报告'}_Excel版.xlsx`)
      if (success) ElMessage.success('Excel导出成功')
    } catch (e) {
      console.error('[useTaskExport] Excel导出失败:', e)
      ElMessage.error('导出Excel失败')
    } finally {
      exporting.value = false
    }
  }

  const handleExportCommand = (command: string) => {
    switch (command) {
      case 'excel':
        exportToExcel()
        break
      case 'pdf':
        ElMessage.info('PDF导出功能开发中，敬请期待')
        break
      case 'print':
        window.print()
        break
      default:
        console.warn('[useTaskExport] 未知导出命令:', command)
    }
  }

  return {
    exporting,
    exportToWord,
    exportToExcel,
    handleExportCommand,
  }
}
