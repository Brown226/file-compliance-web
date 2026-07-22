/**
 * 错别字与术语规则测试 (TYPO)
 * 测试文件: typo.rule.ts → checkTypo
 *
 * 注意: checkTypo 内部调用 TerminologyService.filterTerminologyIssues，
 * 而 TerminologyService 需要数据库连接（从构造函数加载术语白名单）。
 * TerminologyService 的静态方法 filterTerminologyIssues 会检查 initialized 标志，
 * 未初始化时直接返回原 issues 列表。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { checkTypo } from '../typo.rule';
import { FileContext } from '../types';

function ctx(text: string): FileContext {
  return {
    fileName: 'test.pdf',
    filePath: '/test/test.pdf',
    fileType: 'pdf',
    extractedText: text,
  };
}

describe('Typo Rule (TYPO)', () => {

  /* ===== 正例 ===== */

  it('TYPO_001: should detect common typo "帐号" -> "账号"', () => {
    const issues = checkTypo(ctx('请输入您的帐号和密码'));
    expect(issues.some(i => i.ruleCode === 'TYPO_001' && i.originalText === '帐号')).toBe(true);
  });

  it('TYPO_001: should detect common typo "按装" -> "安装"', () => {
    const issues = checkTypo(ctx('按装工作已完成'));
    expect(issues.some(i => i.ruleCode === 'TYPO_001' && i.originalText === '按装')).toBe(true);
  });

  it('TYPO_001: should detect common typo "布署" -> "部署"', () => {
    const issues = checkTypo(ctx('系统布署方案'));
    expect(issues.some(i => i.ruleCode === 'TYPO_001' && i.originalText === '布署')).toBe(true);
  });

  it('TYPO_001: should detect common typo "幅射" -> "辐射"', () => {
    const issues = checkTypo(ctx('幅射防护措施'));
    expect(issues.some(i => i.ruleCode === 'TYPO_001' && i.originalText === '幅射')).toBe(true);
  });

  it('TYPO_001: should detect common typo "竣工验心" -> "竣工验收"', () => {
    const issues = checkTypo(ctx('项目竣工验心报告'));
    expect(issues.some(i => i.ruleCode === 'TYPO_001' && i.originalText === '竣工验心')).toBe(true);
  });

  it('TYPO_001: should detect multiple typo instances in the same text', () => {
    const issues = checkTypo(ctx('帐户信息已更新，请尊守规定。'));
    const typoTexts = issues.filter(i => i.ruleCode === 'TYPO_001').map(i => i.originalText);
    expect(typoTexts).toContain('帐户');
    expect(typoTexts).toContain('尊守');
  });

  /* ===== 反例 ===== */

  it('should pass clean text without any typos', () => {
    const issues = checkTypo(ctx('所有设备安装工作已经全部完成，请审核。'));
    expect(issues.length).toBe(0);
  });

  it('should return empty for empty text', () => {
    const issues = checkTypo(ctx(''));
    expect(issues.length).toBe(0);
  });

  it('should return empty for whitespace-only text', () => {
    const issues = checkTypo(ctx('   \n\n  '));
    expect(issues.length).toBe(0);
  });

  it('should return empty when text has no known typo patterns', () => {
    const issues = checkTypo(ctx('这是一个完全正确的句子，没有任何错别字。'));
    expect(issues.length).toBe(0);
  });

  it('should respect maxIssues config', () => {
    const text = '帐号 帐户 按装 布署 必竟 幅射 鬼计 宏扬 即然'.repeat(3);
    const issues = checkTypo(ctx(text));
    // With default maxIssues=10, should find at most 10 issues
    expect(issues.length).toBeLessThanOrEqual(10);
  });

});
