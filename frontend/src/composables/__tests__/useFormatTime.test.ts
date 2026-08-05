/**
 * composables 纯逻辑单元测试
 *
 * 覆盖：
 * - useFormatTime：zh-CN 日期时间/日期格式化 + 空值与非法输入兜底 '-'
 * - useFormatFileSize：B/KB/MB/GB 单位换算 + 边界（0/空/负数）
 * - useStatusHelpers：任务状态/审查类型的中文标签与 Element Plus type 映射 + 未知兜底
 */
import { describe, it, expect } from 'vitest'
import { useFormatTime } from '../useFormatTime'
import { useFormatFileSize } from '../useFormatFileSize'
import { useStatusHelpers } from '../useStatusHelpers'

describe('useFormatTime', () => {
  const { formatTime, formatDate } = useFormatTime()

  it('formatTime 输出 zh-CN 日期时间', () => {
    const out = formatTime('2026-08-05T10:00:00Z')
    expect(out).toContain('2026/08/05')
    expect(out).toContain('18:00') // UTC+8
  })

  it('formatDate 输出 zh-CN 日期', () => {
    expect(formatDate('2026-08-05T10:00:00Z')).toContain('2026/08/05')
  })

  it('空值/非法输入 → 兜底 -', () => {
    expect(formatTime(null)).toBe('-')
    expect(formatTime(undefined)).toBe('-')
    expect(formatTime('not-a-date')).toBe('-')
    expect(formatDate(null)).toBe('-')
  })
})

describe('useFormatFileSize', () => {
  const { formatFileSize } = useFormatFileSize()

  it('B 单位', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(512)).toBe('512 B')
  })

  it('KB 单位', () => {
    expect(formatFileSize(1024)).toBe('1 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
  })

  it('MB/GB 单位', () => {
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5 MB')
    expect(formatFileSize(2 * 1024 * 1024 * 1024)).toBe('2 GB')
  })

  it('空值 → 「未知」', () => {
    expect(formatFileSize(null)).toBe('未知')
    expect(formatFileSize(undefined)).toBe('未知')
  })
})

describe('useStatusHelpers', () => {
  const { getTaskStatusLabel, getTaskStatusType, getReviewTypeLabel, getReviewTypeType } = useStatusHelpers()

  it('任务状态中文标签 + type 映射', () => {
    expect(getTaskStatusLabel('PENDING')).toBe('排队中')
    expect(getTaskStatusType('PENDING')).toBe('info')
    expect(getTaskStatusLabel('PROCESSING')).toBe('审查中')
    expect(getTaskStatusLabel('COMPLETED')).toBe('已完成')
    expect(getTaskStatusType('COMPLETED')).toBe('success')
    expect(getTaskStatusLabel('FAILED')).toBe('失败')
    expect(getTaskStatusType('FAILED')).toBe('danger')
  })

  it('未知状态 → 「未知状态」+ type 默认 info', () => {
    expect(getTaskStatusLabel('WEIRD')).toBe('未知状态')
    expect(getTaskStatusType('WEIRD')).toBe('info')
  })

  it('审查类型中文标签 + type 映射（TEXT/IMAGE/DOCUMENT）', () => {
    expect(getReviewTypeLabel('TEXT')).toBe('文字审查')
    expect(getReviewTypeLabel('IMAGE')).toBe('图片审查')
    expect(getReviewTypeType('IMAGE')).toBe('warning')
    expect(getReviewTypeLabel('DOCUMENT')).toBe('文档审查')
    expect(getReviewTypeType('DOCUMENT')).toBe('success')
  })

  it('未知审查类型 → 原样返回 + type 默认 info', () => {
    expect(getReviewTypeLabel('contract_review')).toBe('contract_review')
    expect(getReviewTypeType('contract_review')).toBe('info')
  })
})
