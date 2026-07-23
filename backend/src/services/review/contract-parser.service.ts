/**
 * 合同条款解析服务
 *
 * 将合同文本按条款编号拆分为独立的条款块。
 * 支持格式：
 * - "第X条 XXXX"（中文条款编号）
 * - "X. XXXX"（数字编号）
 * - "X） XXXX"（中文括号编号）
 *
 * 借鉴 ContractReviewSystem 的条款解析逻辑。
 */

export interface ParsedClause {
  clauseNo: string;
  clauseTitle: string;
  clauseContent: string;
  /** 在原文中的起始字符偏移 */
  startOffset: number;
  /** 在原文中的结束字符偏移 */
  endOffset: number;
}

/**
 * 将合同文本解析为条款列表
 * @param text 合同全文
 * @returns 条款列表，按出现顺序排列
 */
export function parseContractClauses(text: string): ParsedClause[] {
  const clauses: ParsedClause[] = [];

  const lines = text.split('\n');
  let currentClause: string[] = [];
  let currentNo = '';
  let currentTitle = '';
  let currentStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // 检测是否为条款开头
    const match = line.match(/^(第[一二三四五六七八九十百千零〇\d]+[条节])[\.\、\s]*(.*)/);
    const numMatch = line.match(/^(\d+[\.\、\)）])\s*(.*)/);

    if (match || numMatch) {
      // 保存上一条条款
      if (currentClause.length > 0 && currentNo) {
        clauses.push({
          clauseNo: currentNo,
          clauseTitle: currentTitle,
          clauseContent: currentClause.join('\n'),
          startOffset: currentStart,
          endOffset: currentStart + currentClause.join('\n').length,
        });
      }

      // 开始新条款
      currentNo = match ? match[1] : (numMatch ? numMatch[1] : '');
      currentTitle = match ? (match[2] || '') : (numMatch ? (numMatch[2] || '') : '');
      currentClause = [line];
      currentStart = lines.slice(0, i).join('\n').length + 1;
    } else if (currentNo) {
      // 当前条款的续行
      currentClause.push(line);
    }
  }

  // 最后一条条款
  if (currentClause.length > 0 && currentNo) {
    clauses.push({
      clauseNo: currentNo,
      clauseTitle: currentTitle,
      clauseContent: currentClause.join('\n'),
      startOffset: currentStart,
      endOffset: currentStart + currentClause.join('\n').length,
    });
  }

  // 如果没解析出任何条款，退化为整段
  if (clauses.length === 0) {
    clauses.push({
      clauseNo: '全文',
      clauseTitle: '',
      clauseContent: text,
      startOffset: 0,
      endOffset: text.length,
    });
  }

  return clauses;
}

/**
 * 根据条款编号获取默认法律依据
 * @param clauseNo 条款编号
 * @returns 法律依据文本
 */
export function getDefaultLegalBasis(clauseNo: string): string {
  const title = clauseNo.includes('付款') || clauseNo.includes('支付') || clauseNo.includes('价款')
    ? '《中华人民共和国民法典》合同编第三编第二分编（典型合同·买卖合同/建设工程合同）'
    : clauseNo.includes('质保') || clauseNo.includes('保修') || clauseNo.includes('质量')
      ? '《中华人民共和国民法典》合同编 + 《中华人民共和国产品质量法》'
      : clauseNo.includes('违约') || clauseNo.includes('赔偿') || clauseNo.includes('责任')
        ? '《中华人民共和国民法典》合同编第八章（违约责任）'
        : clauseNo.includes('保密') || clauseNo.includes('知识产权')
          ? '《中华人民共和国反不正当竞争法》 + 《中华人民共和国专利法》'
          : '《中华人民共和国民法典》合同编及相关司法解释';

  return title;
}
