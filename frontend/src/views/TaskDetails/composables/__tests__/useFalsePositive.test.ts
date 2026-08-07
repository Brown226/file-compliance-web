/**
 * useFalsePositive 单元测试
 *
 * 覆盖 2026-08 修复：
 * - handleCancelFalsePositive（新增：取消误报标记，此前 UI 有入口但父组件未接线）
 * - handleBatchFalsePositiveFromIssueList（修复：此前为空实现但 UI 弹"已提交 N 条"假成功）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

const { toggleFalsePositiveApiMock, elMock } = vi.hoisted(() => ({
  toggleFalsePositiveApiMock: vi.fn(),
  elMock: {
    ElMessage: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
    ElMessageBox: { confirm: vi.fn(), alert: vi.fn() },
  },
}))

vi.mock('@/api/task', () => ({
  toggleFalsePositiveApi: toggleFalsePositiveApiMock,
}))
vi.mock('element-plus', () => elMock)

import { useFalsePositive } from '../useFalsePositive'
import type { TaskDetail } from '@/types/models'

function makeDetail(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: 'd1',
    taskId: 't1',
    fileId: 'f1',
    issueType: 'TYPO',
    ruleCode: 'TYPO_001',
    severity: 'warning',
    originalText: '帐号',
    suggestedText: '账号',
    description: '错别字',
    isFalsePositive: false,
    adopted: false,
    ...overrides,
  } as TaskDetail
}

describe('useFalsePositive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toggleFalsePositiveApiMock.mockResolvedValue({ data: {} })
  })

  describe('handleCancelFalsePositive（2026-08 新增）', () => {
    it('调用 API 取消误报并更新本地状态', async () => {
      const allDetails = ref<TaskDetail[]>([makeDetail({ id: 'd1', isFalsePositive: true, fpReason: '误报原因' })])
      const { handleCancelFalsePositive } = useFalsePositive(allDetails)

      await handleCancelFalsePositive(allDetails.value[0])

      expect(toggleFalsePositiveApiMock).toHaveBeenCalledWith('d1', { isFalsePositive: false })
      expect(allDetails.value[0].isFalsePositive).toBe(false)
      expect(allDetails.value[0].fpReason).toBeNull()
      expect(elMock.ElMessage.success).toHaveBeenCalledWith('已取消误报标记')
    })

    it('API 失败时提示错误且不改本地状态', async () => {
      toggleFalsePositiveApiMock.mockRejectedValue({ response: { data: { message: '无权限' } } })
      const allDetails = ref<TaskDetail[]>([makeDetail({ id: 'd1', isFalsePositive: true })])
      const { handleCancelFalsePositive } = useFalsePositive(allDetails)

      await handleCancelFalsePositive(allDetails.value[0])

      expect(elMock.ElMessage.error).toHaveBeenCalledWith('无权限')
      expect(allDetails.value[0].isFalsePositive).toBe(true)
    })
  })

  describe('handleBatchFalsePositiveFromIssueList（2026-08 修复空实现）', () => {
    it('全部成功：提示已标记数量并更新本地状态', async () => {
      const allDetails = ref<TaskDetail[]>([
        makeDetail({ id: 'd1' }),
        makeDetail({ id: 'd2' }),
      ])
      const { handleBatchFalsePositiveFromIssueList } = useFalsePositive(allDetails)

      await handleBatchFalsePositiveFromIssueList(['d1', 'd2'], '确认无误')

      expect(toggleFalsePositiveApiMock).toHaveBeenCalledTimes(2)
      expect(toggleFalsePositiveApiMock).toHaveBeenCalledWith('d1', { isFalsePositive: true, reason: '确认无误' })
      expect(elMock.ElMessage.success).toHaveBeenCalledWith('已标记 2 条误报')
      expect(allDetails.value.every(d => d.isFalsePositive)).toBe(true)
    })

    it('部分失败：提示含失败数量', async () => {
      toggleFalsePositiveApiMock
        .mockResolvedValueOnce({ data: {} })
        .mockRejectedValueOnce(new Error('boom'))
      const allDetails = ref<TaskDetail[]>([makeDetail({ id: 'd1' }), makeDetail({ id: 'd2' })])
      const { handleBatchFalsePositiveFromIssueList } = useFalsePositive(allDetails)

      await handleBatchFalsePositiveFromIssueList(['d1', 'd2'])

      expect(elMock.ElMessage.success).toHaveBeenCalledWith('已标记 1 条误报，1 条失败')
      expect(allDetails.value[0].isFalsePositive).toBe(true)
      expect(allDetails.value[1].isFalsePositive).toBe(false)
    })

    it('全部失败：提示失败且不弹假成功', async () => {
      toggleFalsePositiveApiMock.mockRejectedValue(new Error('boom'))
      const allDetails = ref<TaskDetail[]>([makeDetail({ id: 'd1' })])
      const { handleBatchFalsePositiveFromIssueList } = useFalsePositive(allDetails)

      await handleBatchFalsePositiveFromIssueList(['d1'])

      expect(elMock.ElMessage.error).toHaveBeenCalledWith('批量标记误报失败')
      expect(elMock.ElMessage.success).not.toHaveBeenCalled()
    })

    it('空列表：不调用 API 直接提示', async () => {
      const allDetails = ref<TaskDetail[]>([])
      const { handleBatchFalsePositiveFromIssueList } = useFalsePositive(allDetails)

      await handleBatchFalsePositiveFromIssueList([])

      expect(toggleFalsePositiveApiMock).not.toHaveBeenCalled()
      expect(elMock.ElMessage.warning).toHaveBeenCalledWith('没有可标记的问题')
    })
  })
})
