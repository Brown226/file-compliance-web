// StageRunner 测试（方案A：审查阶段状态机）
// - trimIssuesPayload：issue 裁剪核心字段 / 非 issue 元素保留 / 超限截断
// - runStage：首次执行 DONE + payload 落库；DONE 跳过（续跑）；FAILED 标记 + 重抛
// - FAILED 重试：attemptCount 递增，DONE 阶段不变
// - alwaysRun：DONE 也执行；allowSkip：null → SKIPPED；markSkipped
// - getTaskStageSummary / hasFailedStage
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StageRunner, trimIssuesPayload, COMMON_STAGES, DEC_STAGES } from '../stage-runner.service';
import db from '../../../config/db';

function makeIssue(partial: Record<string, any> = {}): any {
  return {
    issueType: 'VIOLATION',
    originalText: '原文',
    suggestedText: '建议',
    description: '描述',
    ruleCode: 'R-1',
    severity: 'warning',
    cadHandleId: null,
    reviewSource: 'COMPLIANCE',
    confidence: 'HIGH',
    locateMeta: { absolute: { start: 0, end: 4 } }, // 大字段应被裁剪
    sourceReferences: [{ content: 'xxx' }], // 大字段应被裁剪
    ...partial,
  };
}

describe('trimIssuesPayload（payload 裁剪）', () => {
  it('裁剪为核心字段，剔除 locateMeta/sourceReferences 大字段', () => {
    const trimmed = trimIssuesPayload([makeIssue()])!;
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0]).toEqual({
      issueType: 'VIOLATION',
      originalText: '原文',
      suggestedText: '建议',
      description: '描述',
      ruleCode: 'R-1',
      severity: 'warning',
      reviewSource: 'COMPLIANCE',
      confidence: 'HIGH',
    });
    expect(trimmed[0].cadHandleId).toBeUndefined(); // null 值剔除
    expect(trimmed[0].locateMeta).toBeUndefined();
    expect(trimmed[0].sourceReferences).toBeUndefined();
  });

  it('空/undefined 返回 null', () => {
    expect(trimIssuesPayload(undefined)).toBeNull();
    expect(trimIssuesPayload([])).toBeNull();
  });

  it('非 issue 元素原样保留（preload 的审点 id 列表）', () => {
    const trimmed = trimIssuesPayload(['cp-1', 'cp-2'] as any)!;
    expect(trimmed).toEqual(['cp-1', 'cp-2']);
  });
});

describe('StageRunner.runStage（阶段执行器）', () => {
  let findFirstMock: ReturnType<typeof vi.spyOn>;
  let createMock: ReturnType<typeof vi.spyOn>;
  let updateMock: ReturnType<typeof vi.spyOn>;
  let countMock: ReturnType<typeof vi.spyOn>;
  let findManyMock: ReturnType<typeof vi.spyOn>;

  const handle = () => StageRunner.handle('task-1', 'file-1', 'DEC_REVIEW');

  beforeEach(() => {
    findFirstMock = vi.spyOn(db.reviewStage, 'findFirst');
    createMock = vi.spyOn(db.reviewStage, 'create');
    updateMock = vi.spyOn(db.reviewStage, 'update');
    countMock = vi.spyOn(db.reviewStage, 'count');
    findManyMock = vi.spyOn(db.reviewStage, 'findMany');
    findFirstMock.mockReset();
    createMock.mockReset();
    updateMock.mockReset();
    countMock.mockReset();
    findManyMock.mockReset();
  });

  afterEach(() => {
    findFirstMock.mockRestore();
    createMock.mockRestore();
    updateMock.mockRestore();
    countMock.mockRestore();
    findManyMock.mockRestore();
  });

  it('首次执行：RUNNING 标记 + 执行 + DONE + 裁剪 payload 落库', async () => {
    findFirstMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ id: 's1' } as any);
    const fn = vi.fn().mockResolvedValue([makeIssue()]);

    const result = await handle().runStage('completeness', fn);

    expect(result).toHaveLength(1);
    expect(fn).toHaveBeenCalledTimes(1);
    // 状态流转：RUNNING（attempt=1）→ DONE（payload 裁剪）
    expect(createMock).toHaveBeenCalledTimes(2);
    const runningCall = createMock.mock.calls[0][0].data;
    expect(runningCall.status).toBe('RUNNING');
    expect(runningCall.stageKey).toBe('completeness');
    const doneCall = createMock.mock.calls[1][0].data;
    expect(doneCall.status).toBe('DONE');
    expect(doneCall.payload.issues[0].originalText).toBe('原文');
    expect(doneCall.payload.issues[0].locateMeta).toBeUndefined();
  });

  it('已有 DONE 记录：跳过执行，直接返回裁剪 payload（断点续跑）', async () => {
    findFirstMock.mockResolvedValue({
      id: 's1',
      status: 'DONE',
      attemptCount: 2,
      payload: { issues: [makeIssue({ originalText: '续跑恢复' })] },
    } as any);
    const fn = vi.fn();

    const result = await handle().runStage('smart_judge', fn);

    expect(result).toHaveLength(1);
    expect((result as any)[0].originalText).toBe('续跑恢复');
    expect(fn).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('执行抛错：标记 FAILED + error，并重新抛出', async () => {
    findFirstMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ id: 's1' } as any);
    const fn = vi.fn().mockRejectedValue(new Error('LLM 超时'));

    await expect(handle().runStage('text_cross', fn)).rejects.toThrow('LLM 超时');
    // RUNNING + FAILED 两次落库
    expect(createMock).toHaveBeenCalledTimes(2);
    const failedCall = createMock.mock.calls[1][0].data;
    expect(failedCall.status).toBe('FAILED');
    expect(failedCall.error).toContain('LLM 超时');
  });

  it('FAILED 后重试：attemptCount 递增，仅失败阶段重跑，DONE 阶段跳过', async () => {
    // 第一次：FAILED
    findFirstMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ id: 's1' } as any);
    await expect(handle().runStage('compliance', async () => {
      throw new Error('LLM 抖动');
    })).rejects.toThrow('LLM 抖动');

    // 重试：已有 FAILED 记录 → 重新执行（不跳过）
    findFirstMock.mockResolvedValue({
      id: 's1', status: 'FAILED', attemptCount: 1, error: 'LLM 抖动', payload: null,
    } as any);
    updateMock.mockResolvedValue({ id: 's1' } as any);
    const fn = vi.fn().mockResolvedValue([makeIssue({ originalText: '重试成功' })]);
    const result = await handle().runStage('compliance', fn);

    expect(result).toHaveLength(1);
    expect(fn).toHaveBeenCalledTimes(1);
    // 重试更新：RUNNING（attempt+1）→ DONE
    expect(updateMock).toHaveBeenCalledTimes(2);
    const runningUpdate = updateMock.mock.calls[0][0].data;
    expect(runningUpdate.status).toBe('RUNNING');
    expect(runningUpdate.attemptCount).toEqual({ increment: 1 });
  });

  it('alwaysRun：DONE 记录存在也执行（preload/fast 幂等阶段）', async () => {
    findFirstMock.mockResolvedValue({
      id: 's1', status: 'DONE', attemptCount: 1,
      payload: { issues: [{ id: 'cp-1' }] },
    } as any);
    updateMock.mockResolvedValue({ id: 's1' } as any);
    const fn = vi.fn().mockResolvedValue(['cp-new']);

    const result = await handle().runStage('preload', fn, { alwaysRun: true });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toEqual(['cp-new']);
  });

  it('allowSkip：执行器返回 null → SKIPPED 不抛错', async () => {
    findFirstMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ id: 's1' } as any);
    const fn = vi.fn().mockResolvedValue(null);

    const result = await handle().runStage('rule_fallback', fn, { allowSkip: true });

    expect(result).toBeNull();
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[1][0].data.status).toBe('SKIPPED');
  });

  it('markSkipped：显式标记业务跳过', async () => {
    findFirstMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ id: 's1' } as any);
    await handle().markSkipped('image_text', '无图纸');
    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0][0].data;
    expect(call.status).toBe('SKIPPED');
    expect(call.error).toBe('无图纸');
  });

  it('getTaskStageSummary：返回阶段摘要列表', async () => {
    findManyMock.mockResolvedValue([
      { stageKey: 'preload', fileId: null, status: 'DONE', attemptCount: 1, error: null, updatedAt: new Date() },
      { stageKey: 'completeness', fileId: 'file-1', status: 'FAILED', attemptCount: 2, error: 'LLM 超时', updatedAt: new Date() },
    ] as any);
    const summary = await StageRunner.getTaskStageSummary('task-1');
    expect(summary).toHaveLength(2);
    expect(summary[1].status).toBe('FAILED');
    expect(summary[1].error).toBe('LLM 超时');
  });

  it('hasFailedStage：存在 FAILED 记录返回 true', async () => {
    countMock.mockResolvedValue(1);
    expect(await StageRunner.hasFailedStage('task-1')).toBe(true);
    countMock.mockResolvedValue(0);
    expect(await StageRunner.hasFailedStage('task-1')).toBe(false);
  });

  it('阶段注册表：通用 3 阶段 + DEC 7 阶段', () => {
    expect(COMMON_STAGES).toEqual(['preload', 'fast', 'ai']);
    expect(DEC_STAGES).toEqual([
      'completeness', 'compliance', 'smart_judge', 'image_text', 'text_cross', 'rule_fallback', 'merge',
    ]);
  });
});
