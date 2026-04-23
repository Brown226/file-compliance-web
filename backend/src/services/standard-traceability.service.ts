/**
 * 标准条文溯源服务
 *
 * 核心职责：
 * 1. 维护规则编号到标准条文的映射关系
 * 2. 从 LLM 返回的 description 中提取规则编号
 * 3. 为审查结果自动补充标准条文引用（standardRef）
 */

import { ReviewIssue } from './llm.service';

export class StandardTraceabilityService {
  /**
   * 规则编号到标准条文的映射
   * R1-R8 对应 MaxKB prompt 中定义的审查规则
   * STD_* 对应标准引用检查规则
   */
  private static readonly RULE_STANDARD_MAP: Record<string, string[]> = {
    'R1': ['封面完整性检查', 'HAF·J0013-1991 第3.2条', 'EJ/T 1125-2000 第4章'],
    'R2': ['目录规范性', 'GB/T 50265-2010 第5.1节'],
    'R3': ['表格模板规范', '企业标准 QS-CNPE-XX-001'],
    'R4': ['引用文件格式', 'GB/T 1.1-2020 第8.4条'],
    'R5': ['变更标记规则', '企业标准 QS-CNPE-XX-002'],
    'R6': ['电缆/路径数据', 'GB 50217-2018 第4章'],
    'R7': ['文字排版规则', 'GB/T 15834-2011'],
    'R8': ['编码一致性', '企业标准 QS-CNPE-XX-003'],
    'STD_001': ['标准引用规范性', '标准库比对 — 未找到该标准'],
    'STD_002': ['标准引用规范性', '标准库比对 — 编号/名称有误'],
    'STD_003': ['标准引用规范性', '标准库比对 — 标准已废止'],
    'STD_004': ['标准引用规范性', '标准库比对 — 标准尚未实施'],
    'TYPO_001': ['文字正确性', 'GB/T 15834-2011 标点符号用法'],
    'FORMAT_001': ['格式规范性', '企业排版规范'],
    'COMPLETENESS_001': ['完整性检查', 'HAF·J0013-1991 第3.2条'],
    'CONSISTENCY_001': ['一致性检查', '跨文件参数/语义比对'],
    'VIOLATION_001': ['合规性检查', '核工业标准规范'],
  };

  /**
   * 根据规则编号查找对应的标准条文
   */
  static lookupStandardRef(ruleCode: string): string[] {
    return this.RULE_STANDARD_MAP[ruleCode] || [];
  }

  /**
   * 从 LLM description 中提取规则编号
   * 支持多种格式: R1, 规则编号：R1, 违反R1 等
   */
  static extractRuleCodes(description: string): string[] {
    const patterns: RegExp[] = [
      /R(\d)/g,                      // R1-R8
      /规则[编号]?[：:]\s*(R\d)/g,    // 规则编号：R1
      /违反[了]?\s*(R\d)/g,           // 违反R1
    ];

    const codes: string[] = [];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        const code = match[1].startsWith('R') ? match[1] : `R${match[1]}`;
        if (!codes.includes(code)) codes.push(code);
      }
    }
    return codes;
  }

  /**
   * 为审查结果补充标准条文引用
   *
   * 逻辑：
   * 1. 如果 issue 已有 ruleCode，查找映射补充 standardRef
   * 2. 如果 issue 没有 ruleCode 但 description 中包含规则编号，提取并补充
   */
  static enrichWithStandardRef(issues: ReviewIssue[]): ReviewIssue[] {
    return issues.map(issue => {
      // 已有 ruleCode，补充 standardRef
      if (issue.ruleCode) {
        const refs = this.lookupStandardRef(issue.ruleCode);
        if (refs.length > 0 && !issue.standardRef) {
          return { ...issue, standardRef: refs.join('; ') };
        }
      }

      // 尝试从 description 中提取规则编号
      if (!issue.ruleCode && issue.description) {
        const codes = this.extractRuleCodes(issue.description);
        if (codes.length > 0) {
          const refs = codes.flatMap(c => this.lookupStandardRef(c));
          return {
            ...issue,
            ruleCode: codes[0],
            standardRef: refs.length > 0 ? refs.join('; ') : issue.standardRef,
          };
        }
      }

      return issue;
    });
  }
}
