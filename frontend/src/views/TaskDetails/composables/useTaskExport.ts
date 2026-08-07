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
      const res = await exportTaskReportWordApi(taskId())
      // 2026-08 修复：后端输出为 Word 兼容 HTML（.doc 格式），此前前端改名 .docx
      // 导致"HTML 内容 + .docx 扩展名"不匹配，Word/WPS 打开报格式错误。
      // 文件名改回 .doc，与后端 Content-Type application/msword 一致。
      const success = downloadBlob(res.data, `${taskTitle() || '审查报告'}_审查报告.doc`)
      if (success) ElMessage.success('Word文档导出成功')
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
      const res = await exportTaskReportApi(taskId())
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
      case 'word':
        exportToWord()
        break
      case 'excel':
        exportToExcel()
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
