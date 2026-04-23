import { Request, Response } from 'express';
import prisma from '../config/db';
import { success, error } from '../utils/response';

/**
 * 获取审查模式控制面板数据
 * 返回每个规则分类（前缀）的统计信息和启用状态
 * 用于 PipelineConfig 页面的卡片展示
 */
export async function getRulePanelData(_req: Request, res: Response): Promise<void> {
  try {
    const allRules = await prisma.reviewRule.findMany({
      orderBy: [{ category: 'asc' }, { ruleCode: 'asc' }],
    });

    // 按前缀分组统计
    const prefixMap = new Map<string, { total: number; enabled: number; category: string; ruleCodes: string[] }>();
    for (const rule of allRules) {
      const prefix = rule.ruleCode.replace(/_\d+$/, '');
      if (!prefixMap.has(prefix)) {
        prefixMap.set(prefix, {
          total: 0,
          enabled: 0,
          category: rule.category,
          ruleCodes: [],
        });
      }
      const entry = prefixMap.get(prefix)!;
      entry.total++;
      if (rule.enabled) entry.enabled++;
      entry.ruleCodes.push(rule.ruleCode);
    }

    // 转为数组，补充描述信息
    const categoryDescriptions: Record<string, string> = {
      NAMING: '检查文件名是否符合规范（不能包含中文、空格、非法字符等）',
      ENCODING: '检查页眉编码与文件名是否一致，是否使用了内部编码',
      ATTRIBUTE: '检查封面属性（版次、状态，专业、设计阶段等）是否符合标准',
      HEADER: '检查页眉内容是否完整，名称与封面是否一致',
      PAGE: '检查 PDF 页码是否连续递增，总页数是否正确',
      FORMAT: '检查文档格式（封面必填字段、目录表头、中英文混排等）',
      COMPLETENESS: '检查必填字段是否缺失，表格数据是否完整',
      CONSISTENCY: '检查项目名称、目录编码与正文内容的一致性',
      LAYOUT: '检查文本截断、换行等排版问题',
      TYPO: '检查文档中的错别字、可疑编码等文字错误',
    };

    const panelData = Array.from(prefixMap.entries()).map(([prefix, info]) => ({
      prefix,
      label: getCategoryLabel(prefix),
      description: categoryDescriptions[prefix] || '',
      totalRules: info.total,
      enabledRules: info.enabled,
      allEnabled: info.enabled === info.total && info.total > 0,
      allDisabled: info.enabled === 0 && info.total > 0,
      partiallyEnabled: info.enabled > 0 && info.enabled < info.total,
      category: info.category,
      ruleCodes: info.ruleCodes,
    }));

    // 按固定顺序排列
    const order = ['NAMING', 'ENCODING', 'ATTRIBUTE', 'HEADER', 'PAGE', 'FORMAT', 'COMPLETENESS', 'CONSISTENCY', 'LAYOUT', 'TYPO'];
    panelData.sort((a, b) => order.indexOf(a.prefix) - order.indexOf(b.prefix));

    success(res, { categories: panelData, totalRules: allRules.length });
  } catch (err: any) {
    error(res, err.message || '获取规则面板数据失败', 500);
  }
}

/**
 * 按前缀批量切换规则启用/禁用状态
 * POST /api/rules/toggle-by-prefix
 * Body: { prefixes: string[], enabled: boolean }
 */
export async function toggleRulesByPrefix(req: Request, res: Response): Promise<void> {
  try {
    const { prefixes, enabled } = req.body;
    if (!Array.isArray(prefixes) || typeof enabled !== 'boolean') {
      error(res, '参数无效: 需要 prefixes 数组和 enabled 布尔值', 400);
      return;
    }

    // 构造正则匹配所有指定前缀的规则编码
    // 如 prefixes = ['NAME'] → 匹配 NAME_001, NAME_002 等
    let result;
    if (enabled) {
      result = await prisma.reviewRule.updateMany({
        where: {
          OR: prefixes.map(p => ({ ruleCode: { startsWith: p + '_' } })),
        },
        data: { enabled: true },
      });
    } else {
      result = await prisma.reviewRule.updateMany({
        where: {
          OR: prefixes.map(p => ({ ruleCode: { startsWith: p + '_' } })),
        },
        data: { enabled: false },
      });
    }

    console.log(`[RulePanel] 批量${enabled ? '启用' : '禁用'}规则: prefixes=[${prefixes.join(',')}], affected=${result.count}`);
    success(res, {
      updatedCount: result.count,
      prefixes,
      enabled,
    }, `已${enabled ? '启用' : '禁用'} ${result.count} 条规则`);
  } catch (err: any) {
    error(res, err.message || '批量切换失败', 500);
  }
}

function getCategoryLabel(prefix: string): string {
  const labels: Record<string, string> = {
    // 完整分类名
    NAMING: '命名规范',
    ENCODING: '编码检查',
    ATTRIBUTE: '属性验证',
    HEADER: '页眉检查',
    PAGE: '页码检查',
    FORMAT: '格式规范',
    COMPLETENESS: '完整性',
    CONSISTENCY: '一致性',
    LAYOUT: '排版布局',
    TYPO: '错别字',
    INTERNAL_CODE: '内部编码',
    // 从 ruleCode 提取的短前缀（如 ATTR_002 → ATTR）
    NAME: '命名规范',
    CODE: '编码检查',
    UNIT: '编码检查',
    ATTR: '属性验证',
    COMPL: '完整性',
    CONSIST: '一致性',
  };
  return labels[prefix] || prefix;
}

/**
 * 获取所有规则列表
 */
export async function getRules(_req: Request, res: Response): Promise<void> {
  try {
    const rules = await prisma.reviewRule.findMany({
      orderBy: [{ category: 'asc' }, { ruleCode: 'asc' }],
    });
    success(res, rules);
  } catch (err: any) {
    error(res, err.message || '获取规则失败', 500);
  }
}

/**
 * 获取单个规则详情
 */
export async function getRuleByCode(req: Request, res: Response): Promise<void> {
  try {
    const { code } = req.params;
    const rule = await prisma.reviewRule.findUnique({
      where: { ruleCode: code },
    });
    if (!rule) {
      error(res, '规则不存在', 404);
      return;
    }
    success(res, rule);
  } catch (err: any) {
    error(res, err.message || '获取规则失败', 500);
  }
}

/**
 * 更新规则（支持高级定制，也支持按 id 更新）
 */
export async function updateRule(req: Request, res: Response): Promise<void> {
  try {
    const { code } = req.params;
    const { name, description, severity, enabled, config } = req.body;

    // 支持 code 为 ruleCode 或 uuid
    const existing = await prisma.reviewRule.findFirst({
      where: { OR: [{ ruleCode: code }, { id: code }] },
    });
    if (!existing) {
      error(res, '规则不存在', 404);
      return;
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (severity !== undefined && ['error', 'warning', 'info'].includes(severity)) {
      updateData.severity = severity;
    }
    if (enabled !== undefined) {
      // 支持 "toggle" 字符串切换
      updateData.enabled = enabled === 'toggle' ? !existing.enabled : Boolean(enabled);
    }
    if (config !== undefined) {
      updateData.config = typeof config === 'object' ? config : JSON.parse(config);
    }

    const rule = await prisma.reviewRule.update({
      where: { id: existing.id },
      data: updateData,
    });

    success(res, rule, '规则更新成功');
  } catch (err: any) {
    error(res, err.message || '更新规则失败', 500);
  }
}

/**
 * 切换单条规则启用/禁用
 */
export async function toggleRule(req: Request, res: Response): Promise<void> {
  try {
    const { code } = req.params;

    const existing = await prisma.reviewRule.findFirst({
      where: { OR: [{ ruleCode: code }, { id: code }] },
    });
    if (!existing) {
      error(res, '规则不存在', 404);
      return;
    }

    const rule = await prisma.reviewRule.update({
      where: { id: existing.id },
      data: { enabled: !existing.enabled },
    });

    success(res, rule, rule.enabled ? '已启用' : '已禁用');
  } catch (err: any) {
    error(res, err.message || '切换失败', 500);
  }
}

/**
 * 获取规则分类列表
 */
export async function getRuleCategories(_req: Request, res: Response): Promise<void> {
  try {
    const categories = await prisma.reviewRule.findMany({
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });
    success(res, categories.map((c: { category: string }) => c.category));
  } catch (err: any) {
    error(res, err.message || '获取分类失败', 500);
  }
}

/**
 * 批量启用/禁用规则
 */
export async function batchToggleRules(req: Request, res: Response): Promise<void> {
  try {
    const { ruleCodes, ids, enabled } = req.body;
    // 兼容前端传 ruleCodes 或 ids（UUID）
    const codes = ruleCodes || ids;
    if (!Array.isArray(codes) || typeof enabled !== 'boolean') {
      error(res, '参数无效: 需要 ruleCodes/ids 数组和 enabled 布尔值', 400);
      return;
    }

    const result = await prisma.reviewRule.updateMany({
      where: { OR: [{ ruleCode: { in: codes } }, { id: { in: codes } }] },
      data: { enabled },
    });

    success(res, { updatedCount: result.count }, `已${enabled ? '启用' : '禁用'} ${result.count} 条规则`);
  } catch (err: any) {
    error(res, err.message || '批量操作失败', 500);
  }
}

/**
 * 重置所有规则为默认配置
 */
export async function resetRulesToDefault(_req: Request, res: Response): Promise<void> {
  try {
    const defaultSeverities: Record<string, string> = {
      // NAMING
      NAME_001: 'error', NAME_002: 'error', NAME_003: 'error',
      NAME_004: 'warning', NAME_005: 'warning', NAME_006: 'warning',
      NAME_007: 'warning', NAME_009: 'warning', NAME_010: 'error',
      // ENCODING
      CODE_001: 'error', CODE_002: 'error', CODE_003: 'warning',
      UNIT_001: 'error',
      // ATTRIBUTE
      ATTR_002: 'error', ATTR_003: 'error', ATTR_007: 'warning',
      ATTR_008: 'warning', ATTR_009: 'warning', ATTR_010: 'error',
      // HEADER / PAGE
      HEADER_001: 'error', HEADER_002: 'warning',
      PAGE_001: 'error', PAGE_003: 'warning',
      // FORMAT (新增)
      FORMAT_001: 'error', FORMAT_002: 'error', FORMAT_003: 'warning',
      FORMAT_004: 'warning', FORMAT_005: 'warning',
      // COMPLETENESS (新增)
      COMPL_001: 'error', COMPL_002: 'warning', COMPL_003: 'error',
      // CONSISTENCY (新增)
      CONSIST_001: 'warning', CONSIST_002: 'error',
      // LAYOUT / TYPO (新增)
      LAYOUT_001: 'info', TYPO_001: 'warning',
    };

    const rules = await prisma.reviewRule.findMany();
    let resetCount = 0;
    for (const rule of rules) {
      const defaultSeverity = defaultSeverities[rule.ruleCode] || 'warning';
      if (rule.severity !== defaultSeverity || rule.enabled !== true) {
        await prisma.reviewRule.update({
          where: { id: rule.id },
          data: { severity: defaultSeverity, enabled: true },
        });
        resetCount++;
      }
    }

    success(res, { resetCount }, `已重置 ${resetCount} 条规则为默认配置`);
  } catch (err: any) {
    error(res, err.message || '重置失败', 500);
  }
}

/**
 * 创建新规则
 */
export async function createRule(req: Request, res: Response): Promise<void> {
  try {
    const { ruleCode, name, category, description, severity, enabled, config } = req.body;

    // 验证必填字段
    if (!ruleCode || !name || !category) {
      error(res, '规则编码、名称和分类为必填项', 400);
      return;
    }

    // 检查规则编码是否已存在
    const existing = await prisma.reviewRule.findUnique({
      where: { ruleCode },
    });
    if (existing) {
      error(res, `规则编码 "${ruleCode}" 已存在`, 400);
      return;
    }

    // 验证严重程度
    if (severity && !['error', 'warning', 'info'].includes(severity)) {
      error(res, '严重程度必须是 error、warning 或 info', 400);
      return;
    }

    const rule = await prisma.reviewRule.create({
      data: {
        ruleCode,
        name,
        category,
        description: description || '',
        severity: severity || 'warning',
        enabled: enabled !== undefined ? Boolean(enabled) : true,
        config: config ? (typeof config === 'object' ? config : JSON.parse(config)) : null,
      },
    });

    success(res, rule, '规则创建成功');
  } catch (err: any) {
    error(res, err.message || '创建规则失败', 500);
  }
}

/**
 * 删除规则
 */
export async function deleteRule(req: Request, res: Response): Promise<void> {
  try {
    const { code } = req.params;

    const existing = await prisma.reviewRule.findFirst({
      where: { OR: [{ ruleCode: code }, { id: code }] },
    });
    if (!existing) {
      error(res, '规则不存在', 404);
      return;
    }

    await prisma.reviewRule.delete({
      where: { id: existing.id },
    });

    success(res, null, '规则删除成功');
  } catch (err: any) {
    error(res, err.message || '删除规则失败', 500);
  }
}

/**
 * 测试规则匹配效果
 */
export async function testRuleMatch(req: Request, res: Response): Promise<void> {
  try {
    const { ruleCode, testText } = req.body;

    if (!ruleCode || !testText) {
      error(res, '规则编码和测试文本为必填项', 400);
      return;
    }

    const rule = await prisma.reviewRule.findUnique({
      where: { ruleCode },
    });
    if (!rule) {
      error(res, '规则不存在', 404);
      return;
    }

    // 根据规则类型进行简单的匹配测试
    const config = rule.config || {};
    let matched = false;
    let matchedContent = '';
    let matchDetails = '';

    // 支持正则匹配
    if (config.pattern) {
      try {
        const regex = new RegExp(config.pattern, 'gi');
        const matches = testText.match(regex);
        if (matches && matches.length > 0) {
          matched = true;
          matchedContent = matches.slice(0, 5).join('; '); // 最多显示5个匹配
          matchDetails = `正则模式 ${config.pattern} 匹配到 ${matches.length} 处`;
        }
      } catch (e) {
        matchDetails = `正则表达式无效: ${config.pattern}`;
      }
    }

    // 支持关键词匹配
    if (config.keywords && Array.isArray(config.keywords)) {
      const foundKeywords = config.keywords.filter((kw: string) => 
        testText.toLowerCase().includes(kw.toLowerCase())
      );
      if (foundKeywords.length > 0) {
        matched = true;
        matchedContent = foundKeywords.join(', ');
        matchDetails = `关键词匹配: ${foundKeywords.length} 个`;
      }
    }

    // 如果没有任何匹配配置，返回文本长度信息
    if (!config.pattern && !config.keywords) {
      matchDetails = `规则 "${rule.name}" 不包含可测试的配置（无正则或关键词）`;
      // 根据规则类型模拟匹配
      if (rule.category === 'NAMING' && testText.length > 0) {
        matched = true;
        matchedContent = testText.substring(0, 50);
        matchDetails = '命名规则测试：文本已提供';
      }
    }

    success(res, {
      ruleCode,
      ruleName: rule.name,
      matched,
      matchedContent,
      matchDetails,
      testTextLength: testText.length,
    });
  } catch (err: any) {
    error(res, err.message || '测试匹配失败', 500);
  }
}

/**
 * 批量导入规则
 */
export async function importRules(req: Request, res: Response): Promise<void> {
  try {
    const { rules: importRules } = req.body;

    if (!Array.isArray(importRules) || importRules.length === 0) {
      error(res, '请提供有效的规则数组', 400);
      return;
    }

    let importedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (const item of importRules) {
      try {
        const { ruleCode, name, category, description, severity, enabled, config } = item;

        if (!ruleCode || !name || !category) {
          errors.push(`规则 ${ruleCode || name || '未知'}: 缺少必填字段`);
          skippedCount++;
          continue;
        }

        // 检查是否已存在
        const existing = await prisma.reviewRule.findUnique({
          where: { ruleCode },
        });

        if (existing) {
          // 更新现有规则
          await prisma.reviewRule.update({
            where: { ruleCode },
            data: {
              name,
              description: description || existing.description,
              severity: ['error', 'warning', 'info'].includes(severity) ? severity : existing.severity,
              enabled: enabled !== undefined ? Boolean(enabled) : existing.enabled,
              config: config ? (typeof config === 'object' ? config : JSON.parse(config)) : existing.config,
            },
          });
        } else {
          // 创建新规则
          await prisma.reviewRule.create({
            data: {
              ruleCode,
              name,
              category,
              description: description || '',
              severity: ['error', 'warning', 'info'].includes(severity) ? severity : 'warning',
              enabled: enabled !== undefined ? Boolean(enabled) : true,
              config: config ? (typeof config === 'object' ? config : null) : null,
            },
          });
        }
        importedCount++;
      } catch (e: any) {
        errors.push(`导入规则时出错: ${e.message}`);
        skippedCount++;
      }
    }

    success(res, {
      importedCount,
      skippedCount,
      total: importRules.length,
      errors: errors.slice(0, 10), // 最多返回10条错误
    }, `导入完成：成功 ${importedCount} 条，跳过 ${skippedCount} 条`);
  } catch (err: any) {
    error(res, err.message || '导入规则失败', 500);
  }
}
