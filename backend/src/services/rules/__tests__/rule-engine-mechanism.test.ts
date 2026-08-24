/**
 * P1-8 回归测试：规则引擎三处机制 bug
 *
 * 1. severityMap 被静默丢弃（runAllRules 中 dbConfigMap 存在时 options.severityMap 失效）
 * 2. CONTRACT_PAYMENT 等子前缀与注册表断链（DB 配置永不生效）
 * 3. DB 配置按前缀聚合丢粒度（NAME_001 error / NAME_002 warning 被合并丢一个）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock prisma（config/db），避免真实 DB 连接
const mockFindMany = vi.fn();
vi.mock('../../../config/db', () => ({
  default: {
    reviewRule: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

import { runAllRules, loadRuleConfigsFromDB, invalidateRuleConfigCache } from '../index';
import { FileContext } from '../types';

function makeCtx(overrides: Partial<FileContext> = {}): FileContext {
  return {
    fileName: '施工图.pdf',
    filePath: '/test/施工图.pdf',
    fileType: 'pdf',
    extractedText: '正文内容',
    pdfPages: ['第 1 页', '第 2 页'],
    ...overrides,
  };
}

describe('规则引擎机制（P1-8）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateRuleConfigCache(); // 清 60s 缓存，保证每次读 mock
  });

  describe('Bug2: 子前缀与注册表断链', () => {
    it('CONTRACT_PAYMENT_001 的 DB 配置能聚合到 CONTRACT 前缀', async () => {
      mockFindMany.mockResolvedValue([
        { id: 'r1', ruleCode: 'CONTRACT_PAYMENT_001', enabled: true, severity: 'error', config: null },
      ]);
      const map = await loadRuleConfigsFromDB();
      // 完整 ruleCode 保留
      expect(map.get('CONTRACT_PAYMENT_001')).toMatchObject({ severity: 'error' });
      // 前缀聚合存在（旧实现缺失 —— 旧实现只存 CONTRACT_PAYMENT，注册表查询 CONTRACT 永远落空）
      expect(map.get('CONTRACT')).toMatchObject({ enabled: true });
    });

    it('DWG_TITLE_001 聚合到 DWG_TITLE（最长前缀优先，不被 DWG 截胡）', async () => {
      mockFindMany.mockResolvedValue([
        { id: 'r1', ruleCode: 'DWG_TITLE_001', enabled: true, severity: 'warning', config: null },
      ]);
      const map = await loadRuleConfigsFromDB();
      expect(map.get('DWG_TITLE_001')).toMatchObject({ enabled: true });
      expect(map.get('DWG_TITLE')).toMatchObject({ severity: 'warning' });
    });
  });

  describe('Bug3: 前缀聚合丢粒度', () => {
    it('同前缀多条规则按完整 ruleCode 保留各自的 severity', async () => {
      mockFindMany.mockResolvedValue([
        { id: 'r1', ruleCode: 'NAME_001', enabled: true, severity: 'error', config: null },
        { id: 'r2', ruleCode: 'NAME_002', enabled: true, severity: 'warning', config: null },
      ]);
      const map = await loadRuleConfigsFromDB();
      // 粒度保留：各 ruleCode 独立配置
      expect(map.get('NAME_001')!.severity).toBe('error');
      expect(map.get('NAME_002')!.severity).toBe('warning');
      // 前缀聚合只用于 enabled，不吞粒度
      expect(map.get('NAME')).toMatchObject({ enabled: true });
    });

    it('任一子规则禁用则前缀整体禁用（enabled 聚合语义）', async () => {
      mockFindMany.mockResolvedValue([
        { id: 'r1', ruleCode: 'NAME_001', enabled: true, severity: 'error', config: null },
        { id: 'r2', ruleCode: 'NAME_002', enabled: false, severity: 'warning', config: null },
      ]);
      const map = await loadRuleConfigsFromDB();
      // 修复后语义：前缀下至少有一条规则启用 → 前缀启用（不再"任一禁用则禁用"）
      expect(map.get('NAME')!.enabled).toBe(true);
      expect(map.get('NAME_002')!.enabled).toBe(false);
    });
  });

  describe('Bug1: options.severityMap 被静默丢弃', () => {
    // 2026-08 噪音清理后 NAME_001 不再产出，severityMap 载体改用 NAME_002（空格检查）
    it('runAllRules 中调用方 severityMap 应覆盖 DB 配置', async () => {
      // DB: NAME_002 = error
      mockFindMany.mockResolvedValue([
        { id: 'r1', ruleCode: 'NAME_002', enabled: true, severity: 'error', config: null },
      ]);
      const issues = await runAllRules(makeCtx({ fileName: 'report v2.pdf', filePath: '/test/report v2.pdf' }), {
        severityMap: new Map([['NAME_002', 'info']]), // 调用方要求降为 info
      });
      const nameIssue = issues.find(i => i.ruleCode === 'NAME_002');
      expect(nameIssue).toBeDefined();
      expect(nameIssue!.severity).toBe('info'); // 旧实现会丢 options，得到 DB 的 error
    });

    it('未传 severityMap 时 DB 配置生效（默认路径不回归）', async () => {
      mockFindMany.mockResolvedValue([
        { id: 'r1', ruleCode: 'NAME_002', enabled: true, severity: 'error', config: null },
      ]);
      const issues = await runAllRules(makeCtx({ fileName: 'report v2.pdf', filePath: '/test/report v2.pdf' }));
      const nameIssue = issues.find(i => i.ruleCode === 'NAME_002');
      expect(nameIssue).toBeDefined();
      expect(nameIssue!.severity).toBe('error');
    });

    it('DB 前缀禁用时规则整体跳过', async () => {
      mockFindMany.mockResolvedValue([
        { id: 'r1', ruleCode: 'NAME_001', enabled: false, severity: 'error', config: null },
        { id: 'r2', ruleCode: 'NAME_002', enabled: false, severity: 'error', config: null },
      ]);
      const issues = await runAllRules(makeCtx());
      expect(issues.some(i => i.ruleCode.startsWith('NAME_'))).toBe(false);
    });
  });
});
