/**
 * 时间格式化 Composable
 */
export function useFormatTime() {
  const formatTime = (time: string | Date | null | undefined): string => {
    if (!time) return '-'
    const d = new Date(time)
    if (isNaN(d.getTime())) return '-'
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const formatDate = (time: string | Date | null | undefined): string => {
    if (!time) return '-'
    const d = new Date(time)
    if (isNaN(d.getTime())) return '-'
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }

  return { formatTime, formatDate }
}
