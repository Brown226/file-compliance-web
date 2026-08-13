// RuleLibraryService 测试
// - isExecutableItem 纯逻辑（MANUAL 不可执行 / BUILTIN_PREFIX 需有前缀 / 其他可执行）
// - getExecutionPlan（mock prisma）：前缀聚合、可执行项映射、库不存在抛错
// - assertPublishable：无可用项时拒绝发布
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { RuleLibraryService } from '../rule-library.service';
import db from '../../../config/db';

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    ruleCode: 'TYPO-001',
    ruleName: '错别字检查',
    category: 'TEXT',
    severity: 'warning',
    enabled: true,
    executionType: 'BUILTIN_PREFIX',
    builtinPrefix: 'TYPO',
    targetScope: 'TEXT',
    ...overrides,
  };
}

describe('RuleLibraryService.isExecutableItem', () => {
  it('MANUAL 类型不可执行', () => {
    expect(RuleLibraryService.isExecutableItem(makeItem({ executionType: 'MANUAL' }))).toBe(false);
  });

  it('BUILTIN_PREFIX 且有内置前缀时可执行', () => {
    expect(RuleLibraryService.isExecutableItem(makeItem({ executionType: 'BUILTIN_PREFIX', builtinPrefix: 'TYPO' }))).toBe(true);
  });

  it('BUILTIN_PREFIX 但无前缀映射时不可执行（空前缀/空类别/空 ruleCode）', () => {
    expect(RuleLibraryService.isExecutableItem(makeItem({ executionType: 'BUILTIN_PREFIX', builtinPrefix: null, category: null, ruleCode: null }))).toBe(false);
  });

  it('executionType 缺失时按字段推断（有 builtinPrefix 则按内置前缀）', () => {
    expect(RuleLibraryService.isExecutableItem(makeItem({ executionType: null, builtinPrefix: 'PAGE' }))).toBe(true);
  });

  it('无 executionType 且无可推断前缀时不可执行', () => {
    expect(RuleLibraryService.isExecutableItem(makeItem({ executionType: null, builtinPrefix: null, category: null, ruleCode: null }))).toBe(false);
  });
});

describe('RuleLibraryService.getExecutionPlan', () => {
  let findUniqueMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    findUniqueMock = vi.spyOn(db.ruleLibrary, 'findUnique');
    findUniqueMock.mockReset();
  });

  afterEach(() => {
    findUniqueMock.mockRestore();
  });

  it('聚合启用项的内置前缀并映射可执行项', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'lib-1',
      items: [
        makeItem({ id: 'a', ruleCode: 'TYPO-1', builtinPrefix: 'TYPO' }),
        makeItem({ id: 'b', ruleCode: 'PAGE-1', builtinPrefix: 'PAGE' }),
        makeItem({ id: 'c', ruleCode: 'X-1', executionType: 'MANUAL' }), // 过滤掉
      ],
    });
    const plan = await RuleLibraryService.getExecutionPlan('lib-1');
    expect(plan.libraryId).toBe('lib-1');
    expect(plan.enabledPrefixes).toEqual(expect.arrayContaining(['TYPO', 'PAGE']));
    expect(plan.executableItems).toHaveLength(2);
    expect(plan.executableItems.map(i => i.id)).toEqual(['a', 'b']);
    // findUnique 查询条件：仅 enabled 项
    const where = findUniqueMock.mock.calls[0][0];
    expect(where.include.items.where.enabled).toBe(true);
  });

  it('规则库不存在时抛错', async () => {
    findUniqueMock.mockResolvedValue(null);
    await expect(RuleLibraryService.getExecutionPlan('missing')).rejects.toThrow('规则库不存在');
  });

  it('无任何可执行项时返回空前缀', async () => {
    findUniqueMock.mockResolvedValue({ id: 'lib-1', items: [makeItem({ executionType: 'MANUAL' })] });
    const plan = await RuleLibraryService.getExecutionPlan('lib-1');
    expect(plan.enabledPrefixes).toEqual([]);
    expect(plan.executableItems).toEqual([]);
  });
});

describe('RuleLibraryService.assertPublishable', () => {
  let findUniqueMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    findUniqueMock = vi.spyOn(db.ruleLibrary, 'findUnique');
    findUniqueMock.mockReset();
  });

  afterEach(() => {
    findUniqueMock.mockRestore();
  });

  it('存在启用且可执行的规则时允许发布', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'lib-1',
      items: [makeItem({ enabled: true, executionType: 'BUILTIN_PREFIX', builtinPrefix: 'TYPO' })],
    });
    await expect(RuleLibraryService.assertPublishable('lib-1')).resolves.toBeUndefined();
  });

  it('无启用且可执行的规则时拒绝发布', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'lib-1',
      items: [
        makeItem({ enabled: false, executionType: 'BUILTIN_PREFIX', builtinPrefix: 'TYPO' }),
        makeItem({ enabled: true, executionType: 'MANUAL' }),
      ],
    });
    await expect(RuleLibraryService.assertPublishable('lib-1')).rejects.toThrow('至少需要 1 条启用且可执行的规则');
  });

  it('规则库不存在时抛错', async () => {
    findUniqueMock.mockResolvedValue(null);
    await expect(RuleLibraryService.assertPublishable('missing')).rejects.toThrow('规则库不存在');
  });
});
