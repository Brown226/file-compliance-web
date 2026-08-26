/**
 * useIssueFilter 筛选逻辑测试
 *
 * 覆盖（2026-08-26 判标全模式扩展后）：
 * - 基础：严重度 / 分类 / 全文搜索
 * - 新增：复核状态筛选（pending = 只看 PENDING_REVIEW）
 * - hasActiveFilters / resetFilters 对新增筛选维度的联动
 */
import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useIssueFilter } from '../useIssueFilter'
import type { IssueDetail } from '../../types/issue'

function makeIssue(partial: Partial<IssueDetail> = {}): IssueDetail {
  return {
    id: `issue-${Math.random()}`,
    issueType: 'VIOLATION',
    severity: 'warning',
    description: '测试问题',
    originalText: '原文',
    ...partial,
  } as IssueDetail
}

function setup(details: IssueDetail[]) {
  const refs = ref(details)
  const selectedFileId = ref<string | null>(null)
  return useIssueFilter(refs, selectedFileId)
}

describe('useIssueFilter', () => {
  const pendingIssues = [
    makeIssue({ id: 'p1', reviewStatus: 'PENDING_REVIEW', judgeConfidence: 'LOW', judgeReason: '疑似误报：参数名与前文不一致' }),
    makeIssue({ id: 'p2', reviewStatus: 'PENDING_REVIEW', judgeConfidence: 'LOW', judgeReason: '描述不够具体' }),
  ]
  const confirmedIssues = [
    makeIssue({ id: 'c1', reviewStatus: 'CONFIRMED', judgeConfidence: 'HIGH' }),
    makeIssue({ id: 'c2', reviewStatus: 'CONFIRMED' }),
    makeIssue({ id: 'c3' }),
  ]
  const all = [...pendingIssues, ...confirmedIssues]

  it('复核状态筛选 pending：只显示 PENDING_REVIEW 条目', () => {
    const f = setup(all)
    f.filterReviewStatus.value = 'pending'
    expect(f.filteredAndSearched.value.map(i => i.id)).toEqual(['p1', 'p2'])
  })

  it('复核状态为空：不做复核过滤，返回全部', () => {
    const f = setup(all)
    expect(f.filteredAndSearched.value.length).toBe(all.length)
  })

  it('复核状态筛选计入 hasActiveFilters', () => {
    const f = setup(all)
    expect(f.hasActiveFilters.value).toBe(false)
    f.filterReviewStatus.value = 'pending'
    expect(f.hasActiveFilters.value).toBe(true)
  })

  it('resetFilters 清空复核状态筛选', () => {
    const f = setup(all)
    f.filterReviewStatus.value = 'pending'
    f.resetFilters()
    expect(f.filterReviewStatus.value).toBe('')
    expect(f.filteredAndSearched.value.length).toBe(all.length)
  })

  it('复核状态筛选与严重度筛选叠加生效', () => {
    const withError = [
      makeIssue({ id: 'pe', reviewStatus: 'PENDING_REVIEW', severity: 'error' }),
      makeIssue({ id: 'pw', reviewStatus: 'PENDING_REVIEW', severity: 'warning' }),
      makeIssue({ id: 'ce', reviewStatus: 'CONFIRMED', severity: 'error' }),
    ]
    const f = setup(withError)
    f.filterReviewStatus.value = 'pending'
    f.filterSeverity.value = 'error'
    expect(f.filteredAndSearched.value.map(i => i.id)).toEqual(['pe'])
  })

  it('严重度筛选（回归）', () => {
    const f = setup(all)
    f.filterSeverity.value = 'error'
    expect(f.filteredAndSearched.value).toEqual([]) // 全部 warning
  })
})