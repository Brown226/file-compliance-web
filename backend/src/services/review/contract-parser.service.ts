/**
 * 合同条款解析服务
 *
 * 将合同文本按条款编号拆分为独立的条款块。
 * 支持格式（P2-F 扩展）：
 * - "第X条 XXXX"（中文条款编号）
 * - "Article X" / "Section X"（英文合同）
 * - "1.1.1 XXXX"（多级编号）
 * - "X. XXXX"（数字编号）
 * - "X） XXXX" / "一） XXXX"（中文括号编号）
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
  /** P2-G: 条款类型（payment/penalty/warranty/ip/change/claim/insurance/dispute/other） */
  clauseType?: string;
}

/** P2-G: 核电工程合同专用法规查表 */
const LEGAL_BASIS_BY_CLAUSE_TYPE: Record<string, string> = {
  payment: '《中华人民共和国民法典》合同编第三编第二分编（典型合同·买卖合同/建设工程合同）+《建设工程质量管理条例》',
  penalty: '《中华人民共和国民法典》合同编第八章（违约责任）+《建设工程施工合同司法解释》',
  warranty: '《建设工程质量管理条例》+《核安全法》（涉及核设施时）',
  insurance: '《中华人民共和国保险法》+《建设工程施工合同司法解释》',
  ip: '《中华人民共和国反不正当竞争法》+《中华人民共和国专利法》+《中华人民共和国著作权法》',
  change: '《中华人民共和国民法典》合同编（合同变更与转让）+《建设工程施工合同管理办法》',
  claim: '《中华人民共和国民法典》合同编（违约责任与索赔）+《建设工程施工合同司法解释》',
  dispute: '《中华人民共和国仲裁法》+《中华人民共和国民事诉讼法》',
  other: '《中华人民共和国民法典》合同编及相关司法解释',
};

/** P2-G: 根据条款标题+内容推断 clauseType */
export function inferClauseType(title: string, content: string): string {
  const text = title + content;
  // P0-2 修复：'支付' 是通用动词（"支付违约金/支付赔偿"），不能单独作为 payment 特征，
  // 否则"违约金条款 + 按 30% 支付违约金"会被付款正则抢占误判为 payment。
  // 用负向前瞻排除"支付违约/支付赔偿/支付罚金"，保留"支付合同总价"等真实付款语义。
  if (/付款|预付款|价款|支付(?!违约|赔偿|罚金)/.test(text)) return 'payment';
  if (/违约|赔偿|罚金/.test(text)) return 'penalty';
  if (/质保|保修|质量/.test(text)) return 'warranty';
  if (/保密|知识产权|专利|著作权/.test(text)) return 'ip';
  if (/变更|修改|补充/.test(text)) return 'change';
  if (/索赔|补偿/.test(text)) return 'claim';
  if (/保险|投保/.test(text)) return 'insurance';
  if (/争议|仲裁|诉讼|管辖/.test(text)) return 'dispute';
  return 'other';
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

  const saveCurrent = (endOffset?: number) => {
    if (currentClause.length > 0 && currentNo) {
      const content = currentClause.join('\n');
      clauses.push({
        clauseNo: currentNo,
        clauseTitle: currentTitle,
        clauseContent: content,
        startOffset: currentStart,
        endOffset: endOffset ?? (currentStart + content.length),
        clauseType: inferClauseType(currentTitle, content),
      });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // P2-F: 5 种条款开头正则，按优先级匹配
    // 1. 第X条/第X节（中文）
    const cnArticleMatch = line.match(/^(第[一二三四五六七八九十百千零〇\d]+[条节])[\.\、\s]*(.*)/);
    // 2. Article X / Section X（英文，大小写不敏感）
    const enArticleMatch = line.match(/^(Article\s+\d+|Section\s+\d+|ARTICLE\s+\d+|SECTION\s+\d+)[\.\、\s:]*(.*)/i);
    // 3. 多级编号 1.1.1（至少两级）
    const multiLevelMatch = line.match(/^(\d+(?:\.\d+){1,})[\.\s]*(.*)/);
    // 4. 单级编号 1. / 1、 / 1) / 1）
    const numMatch = line.match(/^(\d+[\.\、\)）])\s*(.*)/);
    // 5. 中文括号编号 一） / 一)
    const cnParenMatch = line.match(/^([一二三四五六七八九十]+[\)）])\s*(.*)/);

    // 优先级：第X条 > Article X > 多级编号 > 单级编号 > 中文括号
    const firstMatch = cnArticleMatch || enArticleMatch || multiLevelMatch || numMatch || cnParenMatch;

    if (firstMatch) {
      // 保存上一条条款
      saveCurrent();

      // 开始新条款
      currentNo = firstMatch[1];
      currentTitle = firstMatch[2] || '';
      currentClause = [line];
      currentStart = lines.slice(0, i).join('\n').length + 1;
    } else if (currentNo) {
      // 当前条款的续行
      currentClause.push(line);
    }
  }

  // 最后一条条款
  saveCurrent();

  // 如果没解析出任何条款，退化为整段
  if (clauses.length === 0) {
    clauses.push({
      clauseNo: '全文',
      clauseTitle: '',
      clauseContent: text,
      startOffset: 0,
      endOffset: text.length,
      clauseType: 'other',
    });
  }

  return clauses;
}

/**
 * 根据条款编号或类型获取默认法律依据
 * P2-G: 优先按 clauseType 查表（核电工程合同专用法规），fallback 到关键词匹配
 * @param clauseTypeOrTitle 条款类型（payment/penalty/...）或条款标题
 * @returns 法律依据文本
 */
export function getDefaultLegalBasis(clauseTypeOrTitle: string): string {
  // 优先按 clauseType 查表
  if (LEGAL_BASIS_BY_CLAUSE_TYPE[clauseTypeOrTitle]) {
    return LEGAL_BASIS_BY_CLAUSE_TYPE[clauseTypeOrTitle];
  }
  // fallback：关键词匹配（兼容旧调用方式，传入标题而非 clauseType）
  const title = clauseTypeOrTitle;
  if (/付款|支付|价款|预付/.test(title)) return LEGAL_BASIS_BY_CLAUSE_TYPE.payment;
  if (/质保|保修|质量/.test(title)) return LEGAL_BASIS_BY_CLAUSE_TYPE.warranty;
  if (/违约|赔偿|责任/.test(title)) return LEGAL_BASIS_BY_CLAUSE_TYPE.penalty;
  if (/保密|知识产权/.test(title)) return LEGAL_BASIS_BY_CLAUSE_TYPE.ip;
  if (/保险|投保/.test(title)) return LEGAL_BASIS_BY_CLAUSE_TYPE.insurance;
  if (/争议|仲裁|诉讼|管辖/.test(title)) return LEGAL_BASIS_BY_CLAUSE_TYPE.dispute;
  return LEGAL_BASIS_BY_CLAUSE_TYPE.other;
}

/**
 * P2-A: 提取每条款的关键参数（付款方/保险责任方/质保期数值/违约金率/管辖法律）
 * 用于跨条款一致性检查（发现参数间矛盾）
 */
export function extractClauseParameters(clauses: ParsedClause[]): Array<{
  clauseNo: string;
  clauseTitle: string;
  clauseType?: string;
  parameters: Record<string, string>;
}> {
  return clauses.map(c => {
    const parameters: Record<string, string> = {};
    const text = c.clauseContent;
    // 付款方（P0-2 修复：排除"支付违约金/支付赔偿"，避免违约金条款被误当付款条款）
    const payerMatch = text.match(/(?:由|甲方|乙方|承包商|业主)[^。\n]*?(?:付款|承担|支付(?!违约|赔偿|罚金))/);
    if (payerMatch) parameters.payer = payerMatch[0].substring(0, 50);
    // 保险责任方
    const insurerMatch = text.match(/(?:甲方|乙方|承包商|业主)[^。\n]*?(?:投保|购买保险|承担保险)/);
    if (insurerMatch) parameters.insurer = insurerMatch[0].substring(0, 50);
    // 质保期
    const warrantyMatch = text.match(/质保期[^。\n]*?(\d+)\s*个?\s*月/);
    if (warrantyMatch) parameters.warrantyMonths = warrantyMatch[1];
    // 违约金率
    const penaltyMatch = text.match(/违约金[^。\n]*?(\d+(?:\.\d+)?)\s*%/);
    if (penaltyMatch) parameters.penaltyRatio = penaltyMatch[1] + '%';
    // 管辖法律/争议解决
    const disputeMatch = text.match(/(?:仲裁|诉讼|管辖)[^。\n]*/);
    if (disputeMatch) parameters.disputeResolution = disputeMatch[0].substring(0, 80);
    return {
      clauseNo: c.clauseNo,
      clauseTitle: c.clauseTitle,
      clauseType: c.clauseType,
      parameters,
    };
  });
}
