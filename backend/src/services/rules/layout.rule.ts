/**
 * 规则 9: 排版/布局检查 (LAYOUT 类)
 * 错误代码: LAYOUT_001
 * 对应报告: T5a 标题不当截断
 */

import { RuleIssue, FileContext } from './types';

export function checkLayout(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];

  if (!ctx.pdfPages || ctx.pdfPages.length === 0) return issues;

  // LAYOUT_001: 检测长文本在页面边界处的断词情况
  // 通过分析逐页文本末尾和开头来检测可能的截断
  for (let i = 0; i < ctx.pdfPages.length - 1; i++) {
    const currentPage = ctx.pdfPages[i];
    const nextPage = ctx.pdfPages[i + 1];

    // 当前页最后一段文字（去掉尾部空白）
    const currentLastPara = currentPage.trim().split('\n').filter(l => l.trim()).pop() || '';
    const nextFirstPara = nextPage.trim().split('\n').filter(l => l.trim())[0] || '';

    // 如果当前页最后一行以非标点结尾且较短，下一页开头紧接着继续
    // 可能是不当截断
    if (
      currentLastPara.length > 0 &&
      currentLastPara.length <= (config?.shortFragmentLength ?? 15) &&  // 短片段（被截断的词通常不长）
      !/[。，！？；：、】）】""''】」』}$—…]+$/.test(currentLastPara) && // 非正常结束符
      nextFirstPara.length > 0 &&
      !nextFirstPara.startsWith(' ') &&  // 下页不以空格开始（说明是续接）
      /[\u4e00-\u9fff]/.test(currentLastPara[currentLastPara.length - 1]) // 以中文结尾
    ) {
      issues.push({
        issueType: 'LAYOUT', ruleCode: 'LAYOUT_001',
        severity: 'info',
        originalText: `第${i + 1}页末: "${currentLastPara}" → 第${i + 2}页首: "${nextFirstPara.slice(0, 20)}"`,
        description: `第${i + 1}页到第${i + 2}页之间存在可能的文本截断。长标题/段落应在适当位置换行，避免在不恰当的位置断词。`,
      });
      break; // 只报一次
    }
  }

  return issues;
}
