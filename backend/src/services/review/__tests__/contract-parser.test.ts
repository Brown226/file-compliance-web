/**
 * contract-parser.service 单元测试
 *
 * 覆盖：条款切分（5 种编号格式 + 无编号退化）、条款类型推断（含 P0-2 误判回归）、
 * 关键参数提取（跨条款一致性检查输入）。
 */
import { describe, it, expect } from 'vitest';
import { parseContractClauses, inferClauseType, extractClauseParameters } from '../contract-parser.service';

const CONTRACT = `核电工程设备采购合同

第一条 合同标的
甲方采购核岛主泵两台，乙方负责供货。

第二条 付款条款
合同签订后甲方支付预付款 50%，到货验收后支付余款。

第三条 违约金条款
乙方逾期交货的，每逾期一日按合同金额 30% 支付违约金。

第四条 质保条款
质保期为 12 个月，自验收合格之日起计算。

第五条 知识产权
双方确认技术资料的知识产权归甲方所有。

第六条 变更条款
合同变更需双方书面确认。

第七条 索赔条款
因甲方原因造成乙方损失的，乙方有权索赔。

第八条 其他
未尽事宜双方协商解决。`;

describe('parseContractClauses 条款切分', () => {
  it('中文"第X条"编号正确切分为 8 个条款，含类型与偏移', () => {
    const clauses = parseContractClauses(CONTRACT);
    expect(clauses).toHaveLength(8);
    expect(clauses.map((c) => c.clauseNo)).toEqual([
      '第一条', '第二条', '第三条', '第四条', '第五条', '第六条', '第七条', '第八条',
    ]);
    expect(clauses[0].clauseTitle).toBe('合同标的');
    // 条款内容含标题行本身，长度应 > 0
    expect(clauses[1].clauseContent.length).toBeGreaterThan(0);
    // 偏移单调递增
    for (let i = 1; i < clauses.length; i++) {
      expect(clauses[i].startOffset).toBeGreaterThan(clauses[i - 1].startOffset);
    }
  });

  it('无编号自由文本退化为"全文"单条款', () => {
    const clauses = parseContractClauses('本合同约定预付款比例为 40%。质保期为 12 个月。');
    expect(clauses).toHaveLength(1);
    expect(clauses[0].clauseNo).toBe('全文');
    expect(clauses[0].clauseType).toBe('other');
  });

  it('英文 Article/Section 编号可识别', () => {
    const clauses = parseContractClauses('Article 1 Scope\nParty A delivers goods.\nSection 2 Payment\nParty B pays 50%.');
    expect(clauses).toHaveLength(2);
    expect(clauses[0].clauseNo).toBe('Article 1');
    expect(clauses[1].clauseNo).toBe('Section 2');
  });

  it('多级编号（1.1.1）与单级编号（1.）可识别', () => {
    const clauses = parseContractClauses('1.1.1 Scope\ncontent\n1. Payment\ncontent2');
    expect(clauses).toHaveLength(2);
    expect(clauses[0].clauseNo).toBe('1.1.1');
    expect(clauses[1].clauseNo).toBe('1.');
  });
});

describe('inferClauseType 条款类型推断', () => {
  it('违约金条款含"支付违约金"不被 payment 抢占（P0-2 回归）', () => {
    // 修复前：content 中的"支付违约金"命中旧 payment 正则 /付款|支付|价款|预付/ → 误判 payment
    expect(inferClauseType('违约金条款', '乙方逾期交货的，每逾期一日按合同金额 30% 支付违约金。')).toBe('penalty');
  });

  it('真实付款条款仍识别为 payment（"支付"负向前瞻不误伤）', () => {
    expect(inferClauseType('付款条款', '合同签订后甲方支付合同总价的 80%。')).toBe('payment');
    expect(inferClauseType('', '甲方应支付预付款 50%。')).toBe('payment');
  });

  it('"付款与保险条款"这类复合标题按首个命中分类', () => {
    expect(inferClauseType('付款与保险条款', '甲方支付保费，乙方投保。')).toBe('payment');
  });

  it('赔偿条款归 penalty（"赔偿"是违约责任语义）', () => {
    expect(inferClauseType('赔偿条款', '因乙方原因造成损失的，乙方应予以赔偿。')).toBe('penalty');
  });

  it('各类型基础识别', () => {
    expect(inferClauseType('质保条款', '质保期为 24 个月。')).toBe('warranty');
    expect(inferClauseType('知识产权', '专利权归甲方所有。')).toBe('ip');
    expect(inferClauseType('变更条款', '合同变更需双方确认。')).toBe('change');
    expect(inferClauseType('索赔条款', '乙方有权提出索赔。')).toBe('claim');
    expect(inferClauseType('保险条款', '乙方应投保工程保险。')).toBe('insurance');
    expect(inferClauseType('争议解决', '双方争议提交仲裁。')).toBe('dispute');
    expect(inferClauseType('其他', '未尽事宜协商解决。')).toBe('other');
  });
});

describe('extractClauseParameters 参数提取', () => {
  it('提取质保期/违约金率/付款方', () => {
    const params = extractClauseParameters(parseContractClauses(CONTRACT));
    const byNo = Object.fromEntries(params.map((p) => [p.clauseNo, p.parameters]));
    expect(byNo['第二条'].payer).toContain('甲方');
    expect(byNo['第四条'].warrantyMonths).toBe('12');
  });

  it('违约金条款不产生 payer 误提取（P0-2 相关：参数表不被"支付违约金"污染）', () => {
    const params = extractClauseParameters(parseContractClauses(CONTRACT));
    const clause3 = params.find((p) => p.clauseNo === '第三条')!;
    // 修复前"乙方逾期交货的…30% 支付"会被 payer 正则截为付款方，污染跨条款一致性检查
    expect(clause3.parameters.payer).toBeUndefined();
  });
});
