/**
 * 规则: 错别字和语法规则检查
 *
 * 检测文档中常见的错别字、用词错误和语法问题
 * 注意：深度语义级别的错别字检测由 LLM 完成，这里仅做确定性模式匹配
 */

import { RuleIssue, FileContext } from './types';
import { TerminologyService } from '../terminology.service';

// 常见错别字映射表（确定性检查）
const TYPO_MAP: Record<string, string> = {
  // 形近字
  '帐号': '账号',
  '帐户': '账户',
  '按装': '安装',
  '按奈': '按捺',
  '暴炸': '爆炸',
  '必竟': '毕竟',
  '布署': '部署',
  '苍桑': '沧桑',
  '穿流不息': '川流不息',
  '渡过难关': '度过难关',
  '防患未燃': '防患未然',
  '幅射': '辐射',
  '鬼计': '诡计',
  '宏扬': '弘扬',
  '即然': '既然',
  '记帐': '记账',
  '秸杆': '秸秆',
  '竞竞业业': '兢兢业业',
  '刻服': '克服',
  '脉博': '脉搏',
  '密秘': '秘密',
  '棉棉不断': '绵绵不断',
  '磨擦': '摩擦',
  '脑怒': '恼怒',
  '偏辟': '偏僻',
  '迫不急待': '迫不及待',
  '气慨': '气概',
  '揉躪': '蹂躏',
  '散慢': '散漫',
  '善长': '擅长',
  '声张正义': '伸张正义',
  '提心掉胆': '提心吊胆',
  '通谍': '通牒',
  '委糜': '委靡',
  '消遥': '逍遥',
  '修养生息': '休养生息',
  '渲泄': '宣泄',
  '一愁莫展': '一筹莫展',
  '饮鸠止渴': '饮鸩止渴',
  '元霄': '元宵',
  '震憾': '震撼',
  '尊守': '遵守',
  '座落': '坐落',
  // 工程文件常见错别字
  '竣工验心': '竣工验收',
  '工程结账': '工程结算',
};

/**
 * 错别字和语法确定性检查
 */
export function checkTypo(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const text = ctx.extractedText || '';

  if (!text || text.trim().length === 0) return issues;

  // 允许通过 config.customTypoMap 覆盖/扩展错别字映射
  const typoMap: Record<string, string> = {
    ...TYPO_MAP,
    ...(config?.customTypoMap || {}),
  };

  const maxIssues = config?.maxIssues ?? 10;  // 默认最多报10个

  for (const [wrong, correct] of Object.entries(typoMap)) {
    if (wrong === correct) continue;  // 跳过自映射（仅用于过滤）

    // 查找文本中的错别字
    const regex = new RegExp(wrong, 'g');
    let match;
    let count = 0;

    while ((match = regex.exec(text)) !== null) {
      if (count >= 3) break;  // 每种错别字最多报3个实例
      if (issues.length >= maxIssues) break;

      // 提取上下文（前后各30字）
      const start = Math.max(0, match.index - 30);
      const end = Math.min(text.length, match.index + wrong.length + 30);
      const context = text.slice(start, end);

      issues.push({
        issueType: 'TYPO',
        ruleCode: 'TYPO_001',
        severity: 'warning',
        originalText: wrong,
        suggestedText: correct,
        description: `疑似错别字: "${wrong}" → "${correct}"。上下文: ...${context}...`,
      });
      count++;
    }

    if (issues.length >= maxIssues) break;
  }

  // 过滤专业术语白名单（避免正确术语被误报为错别字）
  const filteredIssues = TerminologyService.filterTerminologyIssues(text, issues);

  return filteredIssues;
}
