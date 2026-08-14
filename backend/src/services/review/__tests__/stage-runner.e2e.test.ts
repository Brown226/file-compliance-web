// StageRunner DB 级端到端场景验证（方案A 验证计划第 3 条）
// 前置：开发库可用（RUN_DB_E2E=1 时执行，默认跳过，避免常规回归依赖 DB）
// 场景：真实落库 → DONE 跳过续跑 → 失败 FAILED → 恢复重试 attemptCount+1 → DONE 阶段不变
import { describe, it, expect, afterAll } from 'vitest';
import { StageRunner } from '../stage-runner.service';
import db from '../../../config/db';

const E2E_TASK = `e2e-stage-${Date.now()}`;
const FILE_ID = 'e2e-file-1';

const runE2E = !!process.env.RUN_DB_E2E;

describe.skipIf(!runE2E)('StageRunner DB 端到端（断点续跑场景）', () => {
  afterAll(async () => {
    // 清理测试数据
    await db.reviewStage.deleteMany({ where: { taskId: { startsWith: 'e2e-stage-' } } });
    await db.$disconnect();
  });

  it('全链路：DONE 落库 → 失败 FAILED → 重试仅失败阶段 attemptCount+1，DONE 阶段跳过', async () => {
    const runner = StageRunner.handle(E2E_TASK, FILE_ID, 'DEC_REVIEW');

    // 1. 阶段1成功：DONE 落库
    const r1 = await runner.runStage('completeness', async () => [
      { issueType: 'COMPLETENESS', originalText: '完整性问题', severity: 'warning' },
    ] as any);
    expect(r1).toHaveLength(1);

    // 2. 阶段2失败：FAILED 落库 + error
    await expect(runner.runStage('smart_judge', async () => {
      throw new Error('LLM 超时模拟');
    })).rejects.toThrow('LLM 超时模拟');

    // 3. 阶段3成功：DONE
    const r3 = await runner.runStage('text_cross', async () => [] as any);
    expect(r3).toHaveLength(0);

    // —— 验证落库状态 ——
    const rows = await db.reviewStage.findMany({ where: { taskId: E2E_TASK } });
    expect(rows.length).toBe(3);
    const byKey = new Map(rows.map(r => [r.stageKey, r]));
    expect(byKey.get('completeness')!.status).toBe('DONE');
    expect(byKey.get('smart_judge')!.status).toBe('FAILED');
    expect(byKey.get('smart_judge')!.error).toContain('LLM 超时模拟');
    expect(byKey.get('smart_judge')!.attemptCount).toBe(1);
    expect(byKey.get('text_cross')!.status).toBe('DONE');
    // payload 裁剪验证：只存核心字段
    expect(byKey.get('completeness')!.payload).toEqual({
      issues: [{ issueType: 'COMPLETENESS', originalText: '完整性问题', severity: 'warning' }],
    });

    // 4. 重试（模拟用户点重新审查）：
    //    completeness DONE → 跳过（不执行）
    const completenessFn = (() => { throw new Error('不应执行 DONE 阶段'); }) as any;
    const resumed1 = await runner.runStage('completeness', completenessFn);
    expect(resumed1).toEqual([{ issueType: 'COMPLETENESS', originalText: '完整性问题', severity: 'warning' }]);

    //    smart_judge FAILED → 重跑（attemptCount 递增）
    const judgeFn = (() => [{ issueType: 'VIOLATION', originalText: '判标恢复', severity: 'warning' }]) as any;
    const resumed2 = await runner.runStage('smart_judge', judgeFn);
    expect(resumed2).toHaveLength(1);
    expect(resumed2[0].originalText).toBe('判标恢复');

    // 5. 最终落库验证：smart_judge attemptCount=2、error 清空、DONE；completeness 记录未变
    const finalRows = await db.reviewStage.findMany({ where: { taskId: E2E_TASK } });
    const finalByKey = new Map(finalRows.map(r => [r.stageKey, r]));
    expect(finalByKey.get('smart_judge')!.attemptCount).toBe(2);
    expect(finalByKey.get('smart_judge')!.status).toBe('DONE');
    expect(finalByKey.get('smart_judge')!.error).toBeNull();
    expect(finalByKey.get('completeness')!.attemptCount).toBe(1);
    expect(finalByKey.get('completeness')!.status).toBe('DONE');

    // 6. hasFailedStage：恢复后无 FAILED
    expect(await StageRunner.hasFailedStage(E2E_TASK)).toBe(false);
    // 7. 摘要：3 条记录可被前端轮询消费
    const summary = await StageRunner.getTaskStageSummary(E2E_TASK);
    expect(summary.length).toBe(3);
    expect(summary.map(s => s.stageKey).sort()).toEqual(['completeness', 'smart_judge', 'text_cross']);
  });
});
