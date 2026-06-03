import type { IssueType, Severity } from '../types/issue'
import {
  ISSUE_TYPE_LABELS,
  ISSUE_TYPE_TAG_TYPES,
  SEVERITY_LABELS,
  SEVERITY_TYPES,
  ENTITY_TYPE_LABELS,
} from '../constants/issue-config'

export function useIssueHelpers() {
  // ===== 标签相关 =====
  
  const getIssueTypeLabel = (type: IssueType): string =>
    ISSUE_TYPE_LABELS[type] || type

  const getCategoryTagType = (type: IssueType): any =>
    ISSUE_TYPE_TAG_TYPES[type] || 'info'

  const getSeverityType = (severity: Severity): any =>
    SEVERITY_TYPES[severity] || 'info'

  const getSeverityLabel = (s: Severity): string =>
    SEVERITY_LABELS[s] || s

  // ===== DWG 相关 =====

  /** 根据图层名称生成一致的颜色 */
  const getLayerColor = (layerName: string): string => {
    let hash = 0
    for (let i = 0; i < layerName.length; i++) {
      hash = layerName.charCodeAt(i) + ((hash << 5) - hash)
    }
    const hue = Math.abs(hash) % 360
    return `hsl(${hue}, 55%, 45%)`
  }

  /** DWG 图元类型中文映射 */
  const getEntityTypeLabel = (type: string): string =>
    ENTITY_TYPE_LABELS[type] || type

  // ===== 参考文档处理 =====

  /** 取相似度最高的前3个参考文档 */
  const topSourceRefs = <T extends { similarity?: number }>(refs: T[]): T[] => {
    if (!refs || refs.length <= 3) return refs || []
    return [...refs]
      .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
      .slice(0, 3)
  }

  return {
    getIssueTypeLabel,
    getCategoryTagType,
    getSeverityType,
    getSeverityLabel,
    getLayerColor,
    getEntityTypeLabel,
    topSourceRefs,
  }
}
