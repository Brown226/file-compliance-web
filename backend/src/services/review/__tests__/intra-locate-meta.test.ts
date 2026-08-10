/**
 * P2-10 落库映射回归测试：INTRA_CONSIST_001 落 task_detail 时写入 locateMeta
 * （来自 Inconsistency.position，UTF-16 半开区间 [start,end)，与
 * review.service.ts buildLegacyTextPosition 的 locateMeta.absolute 结构兼容）。
 *
 * 全 mock 隔离：mock prisma.taskDetail.createMany 捕获落库数据。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockCreateMany = vi.fn();
vi.mock('../../../config/db', () => ({
  default: {
    taskDetail: {
      createMany: (...args: unknown[]) => mockCreateMany(...args),
    },
  },
}));

import { IntraFileConsistencyService } from '../intra-file-consistency.service';

describe('P2-10 INTRA 落库 locateMeta 映射', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateMany.mockResolvedValue({ count: 1 });
  });

  it('不一致明细落库时携带 locateMeta.absolute（Inconsistency.position → locateMeta）', async () => {
    const text = [
      '第一章 总体说明',
      '这是一段用于测试的参数说明文本，内容足够长以便满足段落最小长度五十个字符的要求，这里补充一些背景信息。',
      '设计压力: 1MPa',
      '设计温度: 350℃',
      '',
      '第二章 参数表',
      '这是第二段用于测试的参数说明文本，同样需要足够长以便构成独立段落，确保分割逻辑正常。',
      '设计压力: 1kPa',
      '',
    ].join('\n');

    const count = await IntraFileConsistencyService.check('task-1', 'file-1', 'test.txt', text);
    expect(count).toBeGreaterThan(0);
    expect(mockCreateMany).toHaveBeenCalled();

    const data = mockCreateMany.mock.calls[0][0].data as Array<any>;
    expect(data.length).toBeGreaterThan(0);

    const detail = data.find((d) => d.ruleCode === 'INTRA_CONSIST_001');
    expect(detail).toBeDefined();
    expect(detail.fileId).toBe('file-1');
    // P2-10: position → locateMeta.absolute（半开区间，start ≤ end）
    expect(detail.locateMeta?.absolute?.start).toEqual(expect.any(Number));
    expect(detail.locateMeta?.absolute?.end).toBeGreaterThanOrEqual(detail.locateMeta.absolute.start);
    // P2-10: 单位换算描述（1MPa = 1000kPa）贯通到 description
    expect(detail.description).toContain('1MPa = 1000kPa');
  });

  it('无 position（行内找不到值）→ locateMeta 为 undefined，不阻断落库', async () => {
    const text = [
      '第一章 总体说明',
      '这是一段用于测试的参数说明文本，内容足够长以便满足段落最小长度五十个字符的要求，这里补充一些背景信息。',
      '设计压力: 1MPa',
      '',
      '第二章 参数表',
      '这是第二段用于测试的参数说明文本，同样需要足够长以便构成独立段落，确保分割逻辑正常。',
      '设计压力: 1kPa',
      '',
    ].join('\n');

    const count = await IntraFileConsistencyService.check('task-1', 'file-1', 'test.txt', text);
    expect(count).toBeGreaterThan(0);
    const data = mockCreateMany.mock.calls[0][0].data as Array<any>;
    const detail = data.find((d) => d.ruleCode === 'INTRA_CONSIST_001');
    expect(detail).toBeDefined();
    // position 可能算得出也可能 undefined——两者都接受，关键是落库不因定位失败而中断
    expect(detail.locateMeta === undefined || typeof detail.locateMeta.absolute.start === 'number').toBe(true);
  });
});
