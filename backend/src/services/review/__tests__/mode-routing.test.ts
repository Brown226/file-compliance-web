/**
 * 审查模式路由单元测试
 *
 * 回归保护：CONSISTENCY 模式被 resolvePipelineSelector 吞成 LIBRARY_REVIEW 的缺陷
 * （修复于 2026-08：adaptReviewPlanForExecution 改为 task.reviewMode 直接优先）。
 */

import { describe, it, expect } from 'vitest';
import { ReviewService } from '../review.service';
import { TaskService } from '../../system/task.service';

function makeTask(overrides: Record<string, unknown> = {}): any {
  return {
    reviewMode: 'CONSISTENCY',
    reviewPlan: {
      objective: 'COMPLIANCE',
      evidence: { sources: ['STANDARD'] },
      execution: { profile: 'AI_ONLY' },
      enhancements: {},
    },
    ...overrides,
  };
}

describe('ReviewService.adaptReviewPlanForExecution 模式路由', () => {
  it('CONSISTENCY 任务不再被重推导为 LIBRARY_REVIEW（核心回归）', () => {
    const r = ReviewService.adaptReviewPlanForExecution(makeTask());
    expect(r.reviewMode).toBe('CONSISTENCY');
  });

  it('DEC_REVIEW 保持原路径', () => {
    const r = ReviewService.adaptReviewPlanForExecution(makeTask({ reviewMode: 'DEC_REVIEW' }));
    expect(r.reviewMode).toBe('DEC_REVIEW');
  });

  it('LIBRARY_REVIEW 直接采用落库模式', () => {
    const r = ReviewService.adaptReviewPlanForExecution(makeTask({ reviewMode: 'LIBRARY_REVIEW' }));
    expect(r.reviewMode).toBe('LIBRARY_REVIEW');
  });

  it('TYPO_GRAMMAR 直接采用落库模式', () => {
    const r = ReviewService.adaptReviewPlanForExecution(makeTask({ reviewMode: 'TYPO_GRAMMAR' }));
    expect(r.reviewMode).toBe('TYPO_GRAMMAR');
  });

  it('CONTRACT_REVIEW 直接采用落库模式', () => {
    const r = ReviewService.adaptReviewPlanForExecution(makeTask({ reviewMode: 'CONTRACT_REVIEW' }));
    expect(r.reviewMode).toBe('CONTRACT_REVIEW');
  });

  it('无 reviewMode 时回退推导：COMPARE + contractStance → CONTRACT_REVIEW（兼容旧数据）', () => {
    const task = makeTask({ reviewMode: undefined });
    task.reviewPlan = {
      objective: 'COMPARE',
      evidence: { sources: ['REFERENCE'] },
      execution: { profile: 'AI_ONLY' },
      enhancements: {},
      contractStance: 'owner',
    };
    const r = ReviewService.adaptReviewPlanForExecution(task);
    expect(r.reviewMode).toBe('CONTRACT_REVIEW');
  });

  it('无 reviewMode 时回退推导：COMPARE → DOC_REVIEW', () => {
    const task = makeTask({ reviewMode: undefined });
    task.reviewPlan = {
      objective: 'COMPARE',
      evidence: { sources: ['REFERENCE'] },
      execution: { profile: 'AI_ONLY' },
      enhancements: {},
    };
    const r = ReviewService.adaptReviewPlanForExecution(task);
    expect(r.reviewMode).toBe('DOC_REVIEW');
  });

  it('无 reviewMode 时回退推导：PROOFREAD → TYPO_GRAMMAR', () => {
    const task = makeTask({ reviewMode: undefined });
    task.reviewPlan = {
      objective: 'PROOFREAD',
      evidence: { sources: [] },
      execution: { profile: 'AI_ONLY' },
      enhancements: {},
    };
    const r = ReviewService.adaptReviewPlanForExecution(task);
    expect(r.reviewMode).toBe('TYPO_GRAMMAR');
  });

  it('非法 reviewMode 值回退推导（老数据/脏数据兼容）', () => {
    const task = makeTask({ reviewMode: 'BOGUS_MODE' });
    task.reviewPlan = {
      objective: 'COMPARE',
      evidence: { sources: ['REFERENCE'] },
      execution: { profile: 'AI_ONLY' },
      enhancements: {},
    };
    const r = ReviewService.adaptReviewPlanForExecution(task);
    expect(r.reviewMode).toBe('DOC_REVIEW');
  });

  it('RULE_ONLY 有 enabledPrefixes 时保留 RULE_ONLY', () => {
    const task = makeTask({ reviewMode: undefined });
    task.reviewPlan = {
      objective: 'COMPLIANCE',
      evidence: { sources: ['STANDARD'], enabledPrefixes: ['NAME', 'TYPO'] },
      execution: { profile: 'RULE_ONLY' },
      enhancements: {},
    };
    const r = ReviewService.adaptReviewPlanForExecution(task);
    expect(r.reviewMode).toBe('RULE_ONLY');
    expect(r.enabledPrefixes).toEqual(['NAME', 'TYPO']);
  });
});

describe('TaskService.mapEntryModule 入口映射', () => {
  it('CONSISTENCY 入口映射为 CONSISTENCY', () => {
    expect(TaskService.mapEntryModule('CONSISTENCY')).toBe('CONSISTENCY');
  });

  it('LIBRARY 入口映射为 LIBRARY_REVIEW', () => {
    expect(TaskService.mapEntryModule('LIBRARY')).toBe('LIBRARY_REVIEW');
  });

  it('未知入口兜底 LIBRARY_REVIEW', () => {
    expect(TaskService.mapEntryModule('UNKNOWN')).toBe('LIBRARY_REVIEW');
  });
});
