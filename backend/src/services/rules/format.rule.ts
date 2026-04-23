/**
 * 规则 6: 格式规范检查 (FORMAT 类)
 * 错误代码: FORMAT_001 ~ FORMAT_005
 * 对应报告: T2a封面字段缺失, T2b目录结构, T2c表格模板, T2d标点空格, T2e列表编号
 */

import { RuleIssue, FileContext } from './types';

/**
 * 辅助方法: 提取封面区域文本（通常是文件的前 25 行或到第一个空行之前的区域）
 */
export function extractCoverArea(text: string): string {
  const lines = text.split('\n');

  // 方法1: 找第一个较长的空行间隔前的内容
  let coverEndLine = 0;
  let consecutiveEmptyLines = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length === 0) {
      consecutiveEmptyLines++;
      if (consecutiveEmptyLines >= 2 && i > 8) {
        coverEndLine = i;
        break;
      }
    } else {
      consecutiveEmptyLines = 0;
    }
  }

  // 如果没找到合适的分割点，取前30行
  if (coverEndLine === 0) {
    coverEndLine = Math.min(30, lines.length);
  }

  return lines.slice(0, coverEndLine).join('\n');
}

export function checkFormatRules(ctx: FileContext, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const text = ctx.extractedText || '';

  // FORMAT_001: 封面必填字段完整性
  issues.push(...checkFormatCoverFields(text, config));

  // FORMAT_002: 目录表头规范性
  issues.push(...checkFormatTableOfContents(text));

  // FORMAT_003: 中英文混排空格规范
  issues.push(...checkFormatCnEnSpacing(text, config));

  // FORMAT_004: 引用文件列表格式
  issues.push(...checkFormatReferenceList(text));

  // FORMAT_005: 表格表头层级规范性（检测是否为复合表头）
  issues.push(...checkFormatTableHeaderStructure(ctx));

  return issues;
}

/**
 * FORMAT_001: 检测封面区域必填字段是否完整存在
 * 必填项: 专业、工种(区分)、版次、状态、设计阶段、图册名称、工程号
 */
function checkFormatCoverFields(text: string, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];

  // 尝试定位封面区域（通常在文本的前30%或包含"封面"/"图 册"等关键词）
  const coverArea = extractCoverArea(text);

  // 封面必填字段列表及对应的正则模式
  const requiredFields: Array<{ label: string; pattern: RegExp; code: string }> = config?.requiredFields || [
    { label: '专业', pattern: /专\s*业[：:\s]/, code: 'FORMAT_001' },
    { label: '工种', pattern: /工\s*种[：:\s]/, code: 'FORMAT_001' },       // 工种和专业是不同字段
    { label: '版次', pattern: /版\s*次[：:\s]/, code: 'FORMAT_001' },
    { label: '状态', pattern: /状\s*态[：:\s]|状态码/, code: 'FORMAT_001' },
    { label: '设计阶段', pattern: /设\s*计\s*阶\s*段[：:\s]/, code: 'FORMAT_001' },
    { label: '工程号', pattern: /工\s*程\s*号[：:\s]|工程编码/, code: 'FORMAT_001' },
    { label: '子项号', pattern: /子\s*项\s*号[：:\s]/, code: 'FORMAT_001' },
    { label: '图册名称/文件名称', pattern: /(图册|文件)\s*(名\s*称)?[：:\s]/, code: 'FORMAT_001' },
  ];

  const missingFields: string[] = [];
  for (const field of requiredFields) {
    if (!field.pattern.test(coverArea)) {
      missingFields.push(field.label);
    }
  }

  if (missingFields.length > 0) {
    issues.push({
      issueType: 'FORMAT', ruleCode: 'FORMAT_001',
      severity: missingFields.includes('专业') || missingFields.includes('版次') ? 'error' : 'warning',
      originalText: `(缺失: ${missingFields.join(', ')})`,
      description: `封面缺少必要字段: ${missingFields.join('、')}。核电工程图册封面应包含完整的属性信息，确保各审批环节可追溯。`,
    });
  }

  return issues;
}

/**
 * FORMAT_002: 检查目录/图纸目录的表头规范性
 * 标准目录表头必须含: 序号、名称、版本、页数
 */
function checkFormatTableOfContents(text: string): RuleIssue[] {
  const issues: RuleIssue[] = [];

  // 定位目录区域（查找"目录"/"图纸目录"/"目 录"/"文件清单"等关键词）
  const tocPatterns = [
    /(?:目\s*录|图纸\s*目\s*录|文件\s*清\s*单|图\s*纸\s*清\s*单)[\s\S]{0,500}/,
  ];

  let tocArea = '';
  for (const pat of tocPatterns) {
    const match = text.match(pat);
    if (match) {
      tocArea = match[0];
      break;
    }
  }

  if (!tocArea) return issues; // 无目录区域则跳过

  // 检查标准目录表头的必备列
  const requiredColumns = [
    { name: '序号', patterns: [/序\s*号/, /No\.?\s*序/, /\bNo\b/] },
    { name: '名称', patterns: [/名\s*称/, /图纸名/, /文件名/] },
    { name: '版本/版次', patterns: [/版\s*[本次]?/, /Rev\.?/] },
    { name: '页数', patterns: [/页\s*数?,?/, /Sheet/] },
  ];

  const foundColumns: string[] = [];
  const missingColumns: string[] = [];

  for (const col of requiredColumns) {
    const found = col.patterns.some(p => p.test(tocArea));
    if (found) {
      foundColumns.push(col.name);
    } else {
      missingColumns.push(col.name);
    }
  }

  if (missingColumns.length > 0) {
    issues.push({
      issueType: 'FORMAT', ruleCode: 'FORMAT_002',
      severity: missingColumns.includes('序号') || missingColumns.includes('名称') ? 'error' : 'warning',
      originalText: `(目录表头缺少: ${missingColumns.join(', ')})`,
      description: `目录表头不规范，缺少必需列: ${missingColumns.join('、')}。标准目录表头应包含: [序号, 文件编号, 名称, 版本, 状态, 页数]。`,
    });
  }

  return issues;
}

/**
 * FORMAT_003: 中英文/数字混排空格规范
 * 规则: 英文/数字 与中文之间应有半角空格分隔
 *
 * config 参数说明:
 *   maxSpacingIssues?: number           — 最大报告数量（默认3）
 *   excludePatterns?: string[]          — 额外排除的正则模式（如 ["\\d+年"]）
 */
function checkFormatCnEnSpacing(text: string, config?: any): RuleIssue[] {
  const issues: RuleIssue[] = [];

  // 匹配中文紧邻英文/数字（无空格）的情况
  // 排除常见的合法无空格情况: 已有的单位符号(kg/m/mm/cm)、百分比(%)
  const spacingPattern = /[\u4e00-\u9fff]([A-Za-z0-9]{2,})|[A-Za-z0-9]{2,}[\u4e00-\u9fff]/g;

  // 排除列表
  const excludePatterns = [
    /\d+[%‰℃°]/,           // 百分比、度数
    /\d+(kg|g|mg|m|cm|mm|km|m²|m³|kPa|MPa|Pa|V|A|W|kW|MW|Hz)\b/i,  // 单位符号
    /[A-Z]\d{2,}[A-Z]/,   // 编码格式如 FJ24A00AC
    /\d{4}[-/年]\d{1,2}/,  // 日期格式
    /v\d+(\.\d+)*/i,       // 版本号
    /ISO\d+|GB\d+/i,       // 标准编号
    ...(config?.excludePatterns || []).map((p: string) => new RegExp(p)),
  ];

  const maxSpacingIssues: number = config?.maxSpacingIssues ?? 3;

  let match: RegExpExecArray | null;
  while ((match = spacingPattern.exec(text)) !== null) {
    const segment = match[0];

    // 跳过排除情况
    const isExcluded = excludePatterns.some(p => p.test(segment));
    if (isExcluded) continue;

    if (issues.length >= maxSpacingIssues) break;

    // 确定插入空格的位置
    let fixedText: string;
    if (/[\u4e00-\u9fff][A-Za-z0-9]/.test(segment)) {
      fixedText = segment[0] + ' ' + segment.slice(1);
    } else {
      fixedText = segment.slice(0, -1) + ' ' + segment[segment.length - 1];
    }

    issues.push({
      issueType: 'FORMAT', ruleCode: 'FORMAT_003',
      severity: 'warning',
      originalText: segment,
      suggestedText: fixedText,
      description: `中英文/数字之间缺少空格。根据排版规范，"${segment}" 应写为 "${fixedText}"。`,
    });
  }

  return issues;
}

/**
 * FORMAT_004: 引用文件列表格式规范
 * 规则: 引用列表应使用标准项目符号(●/■/◆/-)，禁止中文手动编号
 */
function checkFormatReferenceList(text: string): RuleIssue[] {
  const issues: RuleIssue[] = [];

  // 定位引用文件区域
  const refAreaMatch = text.match(/(?:引用\s*文\s*件|参\s*考\s*文\s*件|依\s*据|参\s*照)[\s\S]{0,800}/i);
  if (!refAreaMatch) return issues;

  const refArea = refAreaMatch[0];

  // 检测非标准的引用编号方式
  // 中文数字编号: 《...》一、二、三 或 1. 2. 3. 后跟《》
  const nonStandardPatterns = [
    { pattern: /[《\[].*?[》\]]\s*[一二三四五六七八九十]、/g, desc: '使用中文序号编号引用文件' },
    { pattern: /(?<![•●■◆\-·])\d+[、.．]\s*[《\[]/g, desc: '引用文件使用了阿拉伯数字手动编号，建议统一使用项目符号' },
  ];

  let hasIssue = false;
  for (const np of nonStandardPatterns) {
    if (np.pattern.test(refArea)) {
      const example = np.pattern.exec(refArea)?.[0]?.slice(0, 40);
      issues.push({
        issueType: 'FORMAT', ruleCode: 'FORMAT_004',
        severity: 'warning',
        originalText: example || '(非标准引用编号)',
        description: `引用文件列表格式不规范: ${np.desc}。应使用标准项目符号(●/■/◆/-)统一格式编排。`,
      });
      hasIssue = true;
    }
  }

  return issues;
}

/**
 * FORMAT_005: 表格表头层级规范性
 * 检测数据表格是否使用了公司规定的标准多级表头模板
 */
function checkFormatTableHeaderStructure(ctx: FileContext): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const text = ctx.extractedText || '';

  // 查找表格区域（连续多行包含制表符或大量 | 分隔符的行）
  const tableLines = text.split('\n').filter(line => {
    const tabCount = (line.match(/\t/g) || []).length;
    const pipeCount = (line.match(/\|/g) || []).length;
    return tabCount >= 3 || pipeCount >= 5;
  });

  if (tableLines.length < 3) return issues; // 不像表格

  // 检测表头行特征:
  // - 多级表头: 连续2-3行都有较多分隔符，且第一行列数 > 第二行（有合并单元格）
  const headerLines = tableLines.slice(0, Math.min(3, tableLines.length));
  const headerColCounts = headerLines.map(line => {
    const tabs = (line.match(/\t/g) || []).length;
    const pipes = (line.match(/\|/g) || []).length;
    return Math.max(tabs, pipes);
  });

  // 如果表头只有1行且列数较少，可能不是多级表头
  if (headerColCounts.length >= 1 && headerColCounts[0] < 6) {
    // 对于电缆清单/设备清单类文件，标准要求多级复合表头
    const isCableOrEquipmentList = /电缆|设备|路径|敷设|清单/.test(text);
    if (isCableOrEquipmentList) {
      issues.push({
        issueType: 'FORMAT', ruleCode: 'FORMAT_005',
        severity: 'warning',
        originalText: headerLines[0]?.slice(0, 50) || '(表头)',
        description: '数据表格可能未使用公司规定的标准多级表头模板。电缆/设备清单表格应采用多级复合表头（包含系列、色标、起终点等独立列）。',
      });
    }
  }

  return issues;
}
