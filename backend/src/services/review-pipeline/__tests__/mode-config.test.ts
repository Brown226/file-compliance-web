/**
 * 审查模式默认配置单元测试
 *
 * 回归保护：standardRef 默认关闭导致 STD_* 标准引用问题在主审查流程默认不产出
 * （修复于 2026-08：LIBRARY_REVIEW / SELF_CHECK 默认开启 standardRef）。
 */

const { mockFindUnique } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
}));

vi.mock('../../../config/db', () => ({
  default: {
    systemConfig: { findUnique: mockFindUnique },
  },
}));

import { describe, it, expect, beforeEach } from 'vitest';
import { getModeCapabilitiesConfig } from '../mode-config.service';

describe('mode-config 默认配置（无 DB 覆盖时）', () => {
  beforeEach(() => {
    mockFindUnique.mockResolvedValue(null);
  });

  it('LIBRARY_REVIEW 与 SELF_CHECK 的 standardRef 默认开启', async () => {
    const cfg = await getModeCapabilitiesConfig();
    expect(cfg.LIBRARY_REVIEW.standardRef).toBe(true);
    expect(cfg.SELF_CHECK.standardRef).toBe(true);
  });

  it('其余模式 standardRef 保持关闭（避免 DEC 审点路径重复产出）', async () => {
    const cfg = await getModeCapabilitiesConfig();
    expect(cfg.DOC_REVIEW.standardRef).toBe(false);
    expect(cfg.CONSISTENCY.standardRef).toBe(false);
    expect(cfg.TYPO_GRAMMAR.standardRef).toBe(false);
    expect(cfg.RULE_ONLY.standardRef).toBe(false);
    expect(cfg.CONTRACT_REVIEW.standardRef).toBe(false);
    expect(cfg.DEC_REVIEW.standardRef).toBe(false);
  });

  it('8 个模式全部存在且 enabled 默认 true', async () => {
    const cfg = await getModeCapabilitiesConfig();
    const modes = ['LIBRARY_REVIEW', 'DOC_REVIEW', 'CONSISTENCY', 'TYPO_GRAMMAR', 'RULE_ONLY', 'SELF_CHECK', 'CONTRACT_REVIEW', 'DEC_REVIEW'];
    for (const m of modes) {
      expect(cfg[m as keyof typeof cfg]).toBeDefined();
      expect(cfg[m as keyof typeof cfg].enabled).toBe(true);
    }
  });

  it('DB 记录覆盖优先于默认值（字符串 JSON）', async () => {
    mockFindUnique.mockResolvedValue({ value: JSON.stringify({ LIBRARY_REVIEW: { standardRef: false } }) });
    const cfg = await getModeCapabilitiesConfig();
    expect(cfg.LIBRARY_REVIEW.standardRef).toBe(false);
    // 未覆盖的模式仍走默认
    expect(cfg.SELF_CHECK.standardRef).toBe(true);
  });

  it('DB 记录覆盖优先于默认值（对象结构）', async () => {
    mockFindUnique.mockResolvedValue({ value: { SELF_CHECK: { standardRef: false } } });
    const cfg = await getModeCapabilitiesConfig();
    expect(cfg.SELF_CHECK.standardRef).toBe(false);
    expect(cfg.LIBRARY_REVIEW.standardRef).toBe(true);
  });

  it('DB 读取异常时回退默认配置', async () => {
    mockFindUnique.mockRejectedValue(new Error('db down'));
    const cfg = await getModeCapabilitiesConfig();
    expect(cfg.LIBRARY_REVIEW.standardRef).toBe(true);
  });
});
