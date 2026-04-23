/**
 * 文件大小格式化 Composable
 */
export function useFormatFileSize() {
  const formatFileSize = (bytes?: number | null): string => {
    if (bytes == null) return '未知'
    if (bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const k = 1024
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i]
  }

  return { formatFileSize }
}
