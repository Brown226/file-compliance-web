/**
 * 严重度辅助 Composable
 */
const SEVERITY_MAP: Record<string, { label: string; type: string }> = {
  error: { label: '错误', type: 'danger' },
  warning: { label: '警告', type: 'warning' },
  info: { label: '提示', type: 'info' },
  HIGH: { label: '高', type: 'danger' },
  MEDIUM: { label: '中', type: 'warning' },
  LOW: { label: '低', type: 'info' },
}

export function useSeverityHelpers() {
  const getSeverityLabel = (severity: string): string => {
    return SEVERITY_MAP[severity]?.label ?? severity
  }

  const getSeverityType = (severity: string): string => {
    return SEVERITY_MAP[severity]?.type ?? 'info'
  }

  return { getSeverityLabel, getSeverityType }
}
