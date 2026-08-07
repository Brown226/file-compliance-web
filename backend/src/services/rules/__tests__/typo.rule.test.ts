/**
 * OPT-002: typo.rule 黄金测试集
 */
import { describe, it, expect } from 'vitest';
import { checkTypo } from '../typo.rule';
import { FileContext } from '../types';

function makeCtx(text: string): FileContext {
  return {
    fileName: 'test.docx',
    filePath: '/uploads/test.docx',
    fileType: 'docx',
    extractedText: text,
  };
}

describe('checkTypo', () => {
  // ===== 正例：应检出 =====

  it('检出"帐号"→"账号"', () => {
    const issues = checkTypo(makeCtx('请输入帐号信息'));
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].originalText).toBe('帐号');
    expect(issues[0].suggestedText).toBe('账号');
    expect(issues[0].issueType).toBe('TYPO');
    expect(issues[0].ruleCode).toBe('TYPO_001');
  });

  it('检出"按装"→"安装"', () => {
    const issues = checkTypo(makeCtx('设备按装完成后进行调试'));
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].originalText).toBe('按装');
    expect(issues[0].suggestedText).toBe('安装');
  });

  it('检出"布署"→"部署"', () => {
    const issues = checkTypo(makeCtx('系统布署方案'));
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].originalText).toBe('布署');
  });

  it('检出"迫不急待"→"迫不及待"', () => {
    const issues = checkTypo(makeCtx('用户迫不急待地使用新功能'));
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].originalText).toBe('迫不急待');
  });

  it('检出"座落"→"坐落"', () => {
    const issues = checkTypo(makeCtx('本项目座落于深圳市南山区'));
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].originalText).toBe('座落');
  });

  it('同一错别字出现多次时最多报3个', () => {
    const text = '帐号帐号帐号帐号帐号';
    const issues = checkTypo(makeCtx(text));
    const typoIssues = issues.filter(i => i.originalText === '帐号');
    expect(typoIssues.length).toBeLessThanOrEqual(3);
  });

  // ===== 反例：不应检出 =====

  it('正确文本不报错', () => {
    const issues = checkTypo(makeCtx('请输入账号信息，完成安装部署。'));
    expect(issues).toHaveLength(0);
  });

  it('空文本不报错', () => {
    const issues = checkTypo(makeCtx(''));
    expect(issues).toHaveLength(0);
  });

  it('无提取文本不报错', () => {
    const ctx: FileContext = { fileName: 'a.docx', filePath: '/a', fileType: 'docx' };
    const issues = checkTypo(ctx);
    expect(issues).toHaveLength(0);
  });

  it('正确成语"川流不息"不误报', () => {
    const issues = checkTypo(makeCtx('车辆川流不息'));
    expect(issues).toHaveLength(0);
  });

  it('正确用词"迫不及待"不误报', () => {
    const issues = checkTypo(makeCtx('迫不及待地开始'));
    expect(issues).toHaveLength(0);
  });

  // ===== 配置测试 =====

  it('maxIssues 限制生效', () => {
    const text = '帐号 按装 布署 座落 刻服 密秘';
    const issues = checkTypo(makeCtx(text), { maxIssues: 2 });
    expect(issues.length).toBeLessThanOrEqual(2);
  });

  it('customTypoMap 扩展生效', () => {
    const issues = checkTypo(makeCtx('自定义错词测试'), { customTypoMap: { '自定义错词': '自定义对词' } });
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].originalText).toBe('自定义错词');
  });
});
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
    // 显式传 maxIssues=10：规则默认 30，必须显式配置才验证截断生效
    const issues = checkTypo(makeCtx(text), { maxIssues: 10 });
    expect(issues.length).toBeLessThanOrEqual(10);
  });

  // ===== 2026-08 字典误配清理回归：规范词不再被标错 =====

  it('不再误标"渡过难关"（规范写法）', () => {
    const issues = checkTypo(makeCtx('他们最终渡过了难关。'));
    expect(issues.some(i => i.originalText === '渡过难关')).toBe(false);
  });

  it('不再误标"泄露"（泄露消息为规范用法）', () => {
    const issues = checkTypo(makeCtx('严禁泄露公司机密信息。'));
    expect(issues.some(i => i.originalText === '泄露')).toBe(false);
  });

  it('不再误标"蒸气"（水蒸气为规范写法）', () => {
    const issues = checkTypo(makeCtx('水蒸气凝结成水滴。'));
    expect(issues.some(i => i.originalText === '蒸气')).toBe(false);
  });

  it('不再误标"其它"与"漫延"', () => {
    const issues = checkTypo(makeCtx('其它事项另行通知。河水漫延至岸边。'));
    expect(issues.some(i => ['其它', '漫延'].includes(i.originalText))).toBe(false);
  });

  it('仍然检出真错字"按装"（回归确认字典未被过度清理）', () => {
    const issues = checkTypo(makeCtx('设备按装完成后进行调试'));
    expect(issues.some(i => i.originalText === '按装')).toBe(true);
  });

});
