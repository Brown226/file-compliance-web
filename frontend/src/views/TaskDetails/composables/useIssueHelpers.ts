/**
 * 问题条目相关的工具函数
 * 从 TaskResultsView.vue 提取
 */
import type { TaskDetail } from '@/types/models'

export function useIssueHelpers() {
  const getIssueTitle = (item: any, index: number): string => {
    if (item.originalText && item.originalText.trim()) {
      const text = item.originalText.trim().slice(0, 45)
      return text.length < item.originalText.trim().length ? `${text}...` : text
    }
    if (item.suggestedText && item.suggestedText.trim()) {
      const text = item.suggestedText.trim().slice(0, 45)
      return text.length < item.suggestedText.trim().length ? `${text}...` : text
    }
    if (item.description && item.description.trim()) {
      return `问题 ${index + 1}：${item.description.trim().slice(0, 35)}`
    }
    return `问题 ${index + 1}`
  }

  const getConfidenceLabel = (confidence?: string | null): string => {
    const map: Record<string, string> = {
      RULE_EXACT: '规则命中',
      STD_MATCH: '标准比对',
      AI_INFERRED: 'AI推断',
      NO_RESULT: '无问题说明',
    }
    return confidence ? (map[confidence] || confidence) : ''
  }

  const getConfidenceTagType = (confidence?: string | null): 'success' | 'warning' | 'info' | 'danger' => {
    if (confidence === 'RULE_EXACT') return 'danger'
    if (confidence === 'STD_MATCH') return 'success'
    if (confidence === 'AI_INFERRED') return 'warning'
    return 'info'
  }

  const getStandardRefTitle = (item: TaskDetail): string => {
    const ref = item.standardRef || item.standardRefId
    if (typeof ref === 'string') return ref
    if (ref && typeof ref === 'object') {
      return (ref as any).standardName || (ref as any).name || '标准引用'
    }
    return '标准引用'
  }

  const getIssueTypeLabel = (type: string): string => {
    const m: Record<string, string> = {
      TYPO: '文本错误',
      VIOLATION: '合规违规',
      CONSISTENCY: '一致性',
      COMPLETENESS: '完整性',
      NAMING: '一致性',
      ENCODING: '合规违规',
      ATTRIBUTE: '完整性',
      HEADER: '合规违规',
      PAGE: '合规违规',
      FORMAT: '合规违规',
      LAYOUT: '合规违规',
      STD_REF: '合规违规',
      DWG: '合规违规',
      FLUENCY: '文本错误',
      SCAN: '文本错误',
      TEMPLATE: '合规违规',
      CROSS_REFERENCE: '一致性',
    }
    return m[type] || type
  }

  const getCategoryTagType = (type: string): any => {
    const m: Record<string, any> = {
      VIOLATION: 'danger',
      CONSISTENCY: 'info',
      COMPLETENESS: 'warning',
      TYPO: 'warning',
      NAMING: 'info',
      ENCODING: 'danger',
      ATTRIBUTE: 'warning',
      HEADER: 'success',
      PAGE: 'info',
      FORMAT: 'warning',
      LAYOUT: 'info',
      STD_REF: 'warning',
      DWG: 'info',
      FLUENCY: 'warning',
      SCAN: 'info',
      TEMPLATE: 'warning',
      CROSS_REFERENCE: 'info',
    }
    return m[type] || 'info'
  }

  const pct = (part: number, total: number): string => {
    if (total <= 0) return '0%'
    return Math.round((part / total) * 100) + '%'
  }

  const truncateText = (text: string, maxLen: number): string => {
    if (!text) return ''
    const t = text.trim()
    return t.length > maxLen ? t.slice(0, maxLen) + '...' : t
  }

  const pickLocateKeyword = (text: string): string => {
    const raw = (text || '').trim()
    if (!raw) return ''

    const candidates = raw
      .split(/[|｜\n\r\t]/)
      .map(s => s.trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)

    const preferred = candidates.find(s => s.length >= 6 && s.length <= 40)
    if (preferred) return preferred

    return candidates[0] || raw.slice(0, 40)
  }

  const collectLocateAnchors = (item: TaskDetail): string[] => {
    const anchors: string[] = []

    if (item.originalText) anchors.push(item.originalText)

    const refs = Array.isArray(item.sourceReferences) ? item.sourceReferences : []
    refs.forEach((ref: any) => {
      if (typeof ref?.chunkContent === 'string' && ref.chunkContent.trim()) {
        anchors.push(ref.chunkContent)
      }
      if (typeof ref?.standardTitle === 'string' && ref.standardTitle.trim()) {
        anchors.push(ref.standardTitle)
      }
    })

    const diffRanges = item.diffRanges as any
    if (diffRanges && typeof diffRanges === 'object') {
      const maybeOriginal = diffRanges.originalText || diffRanges.original || diffRanges.rawText
      if (typeof maybeOriginal === 'string' && maybeOriginal.trim()) {
        anchors.push(maybeOriginal)
      }
    }

    const seen = new Set<string>()
    return anchors
      .map(s => String(s || '').trim())
      .filter(Boolean)
      .filter(s => {
        const key = s.replace(/\s+/g, '').toLowerCase()
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      })
  }

  return {
    getIssueTitle,
    getConfidenceLabel,
    getConfidenceTagType,
    getStandardRefTitle,
    getIssueTypeLabel,
    getCategoryTagType,
    pct,
    truncateText,
    pickLocateKeyword,
    collectLocateAnchors,
  }
}
