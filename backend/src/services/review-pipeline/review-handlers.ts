/**
 * 审查模式处理器 — 替代原先的 Pipeline 子类体系
 *
 * 每个审查模式对应一个独立的处理函数，自包含其专属 AI 审查逻辑。
 * 文本提取等公共步骤由 ReviewService（两阶段编排层）统一完成，
 * handler 只关注"如何运行该模式的 AI 审查"。
 */

import { PipelineContext, ReviewModeType, getModeScene } from './types';
import { ReviewIssue, SourceReference } from '../llm/llm.service';
import { AiReviewService } from './ai-review.service';
import { TerminologyService } from '../standard/terminology.service';
import { StructuredConsistencyService } from '../review/structured-consistency.service';
import { getEffectiveConfig } from './pipeline-config';
import { DecReviewService } from '../review/dec-review.service';

/** 审查模式处理器签名 */
export type ReviewHandler = (ctx: PipelineContext) => Promise<{
  aiIssues: ReviewIssue[];
  sources?: SourceReference[];
  usedEngine?: string;
}>;

/** 各模式的显示名称与描述 */
const MODE_META: Record<ReviewModeType, { displayName: string; description: string; needsRefFiles: boolean }> = {
  LIBRARY_REVIEW: { displayName: '以库审文', description: '使用标准库+规则引擎+AI进行合规审查', needsRefFiles: false },
  CONSISTENCY:    { displayName: '全文一致性', description: '单文件内一致性检查 + 跨文件参数一致性检查', needsRefFiles: false },
  TYPO_GRAMMAR:   { displayName: '基础校对', description: '文字质量审查（错别字/语法/通顺性/术语一致性等，跳过RAG，直接LLM）', needsRefFiles: false },
  DOC_REVIEW:     { displayName: '以文审文', description: '使用上游参照文件与待审文件进行比对审查', needsRefFiles: true },
  CONTRACT_REVIEW: { displayName: '合同风险审查', description: '审查核电工程合同，识别对业主不利的风险条款', needsRefFiles: false },
  RULE_ONLY:      { displayName: '仅规则审查', description: '仅执行预定义规则引擎检查，不调用 AI，速度最快', needsRefFiles: false },
  SELF_CHECK:     { displayName: '标准引用自检', description: '提取文档中的标准引用并与标准库机械匹配', needsRefFiles: false },
  DEC_REVIEW:     { displayName: 'DEC规范审查', description: '审点工程化 + 双分支并行审核（完整性/遵从性）+ 多层交叉复核 + 规则兜底', needsRefFiles: false },
};

/**
 * RULE_ONLY — 纯规则引擎，无 AI 审查
 *
 * 设计说明：
 * RULE_ONLY 模式的审查逻辑由阶段1（规则引擎）通过 onFastResult 回调完成，
 * 该回调会直接将检查结果写入 task_details。阶段2（AI 审查）不对此模式执行任何操作。
 *
 * 此 handler 返回空数组是预期行为——不要在此添加 AI 审查逻辑。
 * 如需增加 AI 审查能力，请使用 LIBRARY_REVIEW 模式。
 */
const handleCustomRule: ReviewHandler = async (_ctx) => {
  console.log('[Handler] RULE_ONLY: 规则审查已在阶段1完成，跳过 AI 审查');
  return { aiIssues: [], usedEngine: 'rule-only' };
};

/**
 * TYPO_GRAMMAR — 基础校对（文字质量审查）
 * 纯 LLM 调用（跳过 RAG），检查错别字/语法/通顺性/术语/标点/单位，输出经术语白名单过滤。
 */
const handleTypoGrammar: ReviewHandler = async (ctx) => {
  const text = ctx.extractedText || '';
  if (!text.trim()) return { aiIssues: [], usedEngine: 'none' };

  const scene = ctx.scene || getModeScene('TYPO_GRAMMAR');
  const config = getEffectiveConfig(ctx);
  const result = await AiReviewService.runLLMOnlyStrategy(text, ctx, scene, config);

  // 过滤术语白名单
  result.issues = await TerminologyService.filterTerminologyIssues(text, result.issues);

  // 基础校对模式允许 TYPO、FLUENCY 和轻量 CONSISTENCY（上下文数据矛盾），拒绝格式/合规/完整性等超出范围的问题
  const allowedTypes = new Set(['TYPO', 'FLUENCY', 'CONSISTENCY']);
  result.issues = result.issues.filter(issue => allowedTypes.has(issue.issueType));

  // FLUENCE（语病/修辞微调，如"空水→空管"）是低价值噪声，占校对产出过半。
  // 借鉴 TextGuard：修辞类归 info 级，避免淹没 TYPO/CONSISTENCY 等高价值问题。
  // 与前端「仅看实质问题」开关（过滤 FLUENCE + info/prompt）协同，降低信噪比。
  result.issues = result.issues.map(issue =>
    issue.issueType === 'FLUENCE' && issue.severity !== 'info'
      ? { ...issue, severity: 'info' as const }
      : issue,
  );

  return { aiIssues: result.issues, usedEngine: result.engine, sources: result.sources };
};

/**
 * LIBRARY_REVIEW — 以库审文（标准合规审查）
 * 双轨并行：知识库 RAG + 语义规范库逐条匹配，结果去重合并。
 */
const handleLibraryReview: ReviewHandler = async (ctx) => {
  const text = ctx.extractedText || '';
  if (!text.trim()) return { aiIssues: [], usedEngine: 'none' };

  const scene = ctx.scene || getModeScene('LIBRARY_REVIEW');
  const config = getEffectiveConfig(ctx);
  const hasKnowledge = ctx.ruleSource?.includes('STANDARD')
    && (ctx.maxkbKnowledgeIds?.length || ctx.maxkbKnowledgeId);
  const hasSemanticSpec = ctx.semanticItems && ctx.semanticItems.length > 0;

  if (hasKnowledge && hasSemanticSpec) {
    console.log(`[Handler] 双轨审查: 知识库RAG + 语义规范库(${ctx.semanticItems!.length}条)`);
    const [ragResult, specResult] = await Promise.all([
      AiReviewService.runAIReview(text, ctx, scene, config),
      AiReviewService.runSemanticSpecReview(text, ctx, config),
    ]);
    const mergedIssues = [...ragResult.issues];
    // 基于 issueType + 归一化全文 去重，避免"前60字相同"误删不同问题
    const norm = (i: any) => ((i.issueType || '') + '::' + (i.originalText || '').replace(/\s+/g, '').trim());
    const ragKeys = new Set(ragResult.issues.map(norm));
    for (const issue of specResult.issues) {
      const key = norm(issue);
      if (key && !ragKeys.has(key)) mergedIssues.push(issue);
    }
    return { aiIssues: mergedIssues, usedEngine: `${ragResult.engine}+${specResult.engine}` };
  }

  if (hasKnowledge) {
    const result = await AiReviewService.runAIReview(text, ctx, scene, config);
    return { aiIssues: result.issues, usedEngine: result.engine, sources: result.sources };
  }

  if (hasSemanticSpec) {
    console.log(`[Handler] 语义规范库单独审查: ${ctx.semanticItems!.length}条条文`);
    const result = await AiReviewService.runSemanticSpecReview(text, ctx, config);
    return { aiIssues: result.issues, usedEngine: result.engine };
  }

  const result = await AiReviewService.runLLMOnlyStrategy(text, ctx, scene, config);
  return { aiIssues: result.issues, usedEngine: result.engine, sources: result.sources };
};

/**
 * CONSISTENCY — 全文一致性检查（Map-Reduce 架构）
 *
 * 采用"先抽取、再比对"的两阶段策略，解决短上下文模型下分片破坏一致性检测的问题：
 *
 *   Phase A (Map):   每个文本分片 → LLM 抽取结构化摘要（参数/编码/引用）
 *   Phase B (Merge): 合并所有分片摘要，去重、归一化、按参数名分组
 *   Phase C (Reduce): 合并后的摘要 → LLM 做 C1-C4 一致性比对
 *
 * 分片大小自动联动 PipelineReviewConfig.chunkSize 和 LLM 上下文窗口。
 * 跨文件一致性由 ReviewService 阶段2编排层另行处理。
 */
const handleConsistency: ReviewHandler = async (ctx) => {
  const text = ctx.extractedText || '';
  if (!text.trim()) return { aiIssues: [], usedEngine: 'none' };

  const config = getEffectiveConfig(ctx);

  // 短文本（单分片即可覆盖）直接用原 LLM 直调路径，免去抽取开销
  const effectiveChunkSize = Math.min(
    config.chunkSize || 4000,
    (config.contextWindow || 24000) - 1800,
  );
  if (text.length <= effectiveChunkSize) {
    console.log('[Handler] CONSISTENCY: 文本较短，使用直调路径');
    const scene = ctx.scene || getModeScene('CONSISTENCY');
    const result = await AiReviewService.runLLMDirect(text, ctx, scene, config);
    return { aiIssues: result.issues, usedEngine: result.engine, sources: result.sources };
  }

  // 长文本：走 Map-Reduce 结构化一致性审查
  console.log(`[Handler] CONSISTENCY: 文本较长(${text.length}字符)，使用 Map-Reduce 路径`);
  const issues = await StructuredConsistencyService.check(text, ctx, config);
  return { aiIssues: issues, usedEngine: 'structured-consistency' };
};

/**
 * DOC_REVIEW — 以文审文（参照文件比对）
 * 有参照文件时做 LLM 逐分片比对，无参照时降级到标准 AI 审查。
 */
const handleDocReview: ReviewHandler = async (ctx) => {
  const text = ctx.extractedText || '';
  if (!text.trim()) return { aiIssues: [], usedEngine: 'none' };

  const scene = ctx.scene || getModeScene('DOC_REVIEW');
  const config = getEffectiveConfig(ctx);
  const result = await AiReviewService.runRefCompareStrategy(text, ctx, scene, config);
  return { aiIssues: result.issues, usedEngine: result.engine, sources: result.sources };
};

/**
 * CONTRACT_REVIEW — 合同风险审查（完全独立，不复用以文审文逻辑）
 *
 * 与 DOC_REVIEW 的核心区别：
 * - 立场驱动：必须注入 stance（业主/承包商），审查视角完全不同
 * - 可选参照文件：允许无参照文件的纯风险扫描
 * - 可选知识库 RAG：拉取 MaxKB 知识库作为辅助审查依据
 * - 独立 prompt 模板：使用 contract_review 场景
 * - 独立结果解析：输出 riskLevel + clauseType + recommendation
 */
const handleContractReview: ReviewHandler = async (ctx) => {
  const text = ctx.extractedText || '';
  if (!text.trim()) return { aiIssues: [], usedEngine: 'none' };

  const config = getEffectiveConfig(ctx);
  const result = await AiReviewService.runContractReviewStrategy(text, ctx, config);
  return { aiIssues: result.issues, usedEngine: result.engine, sources: result.sources };
};

/**
 * DEC_REVIEW — DEC 规范审查（审点工程化 + 双分支并行 + 多层交叉复核）
 *
 * - 审点工程化：规范条文经 LLM 加工成结构化审点（mandatory/auditDimension/checkPrompt），存 StandardCheckpoint
 * - 双分支并行：完整性审核（骨架级）+ 遵从性审核（内容级）同时运行
 * - 多层容错：遵从性分支内部 3 分支并行 → 3 层交叉复核 → 规则兜底
 * - 依赖 ctx.checkpoints（阶段0 预加载）
 *
 * 若 ctx.checkpoints 未预加载（空），双分支会跑空并记录日志，不抛错。
 */
const handleDecReview: ReviewHandler = async (ctx) => {
  const text = ctx.extractedText || '';
  if (!text.trim()) return { aiIssues: [], usedEngine: 'none' };

  if (!ctx.checkpoints || ctx.checkpoints.length === 0) {
    console.warn('[Handler] DEC_REVIEW: ctx.checkpoints 为空，请确认阶段0 已预加载审点库（StandardCheckpoint）');
  }

  const config = getEffectiveConfig(ctx);
  const result = await DecReviewService.runDecStrategy(text, ctx, config);
  return { aiIssues: result.issues, usedEngine: result.engine, sources: result.sources };
};

// ==================== 处理器映射表 ====================

/** 审查模式 → 处理器函数 */
export const REVIEW_HANDLERS: Record<ReviewModeType, ReviewHandler> = {
  RULE_ONLY:      handleCustomRule,
  TYPO_GRAMMAR:   handleTypoGrammar,
  LIBRARY_REVIEW: handleLibraryReview,
  CONSISTENCY:    handleConsistency,
  DOC_REVIEW:     handleDocReview,
  CONTRACT_REVIEW: handleContractReview,  // 合同风险审查：完全独立的 handler
  // SELF_CHECK 不走 handler 映射表，有独立的 SelfCheckController 处理
  SELF_CHECK:     async (_ctx) => {
    console.warn('[Handler] SELF_CHECK 被 processTask 误调用，请使用独立的 /api/self-check/run 端点');
    return { aiIssues: [], usedEngine: 'self_check' };
  },
  DEC_REVIEW:     handleDecReview,
};

/** 获取模式显示名称 */
export function getModeDisplayName(mode: ReviewModeType): string {
  return MODE_META[mode]?.displayName || mode;
}

// ==================== 对外导出 ====================

/**
 * 获取所有可用的审查模式信息（前端渲染模式选择列表用）
 * 从 mode-config.service 读取运行时启用状态
 */
export async function getAvailableModes(): Promise<Array<{
  mode: ReviewModeType;
  displayName: string;
  description: string;
  needsRefFiles: boolean;
  capabilities: {
    rules: boolean;
    standardRef: boolean;
    ai: boolean;
    aiStrategy: string;
    crossFile: boolean;
  };
}>> {
  const { getModeCapabilitiesConfig } = await import('./mode-config.service');
  const runtimeCaps = await getModeCapabilitiesConfig();
  const allModes = Object.keys(REVIEW_HANDLERS) as ReviewModeType[];

  return allModes
    .filter(mode => {
      const cfg = runtimeCaps[mode];
      return !cfg || cfg.enabled !== false;
    })
    .map(mode => ({
      mode,
      displayName: MODE_META[mode]?.displayName || mode,
      description: MODE_META[mode]?.description || '',
      needsRefFiles: MODE_META[mode]?.needsRefFiles || false,
      capabilities: {
        rules: runtimeCaps[mode]?.rules ?? false,
        standardRef: runtimeCaps[mode]?.standardRef ?? false,
        ai: runtimeCaps[mode]?.ai ?? true,
        aiStrategy: runtimeCaps[mode]?.aiStrategy ?? 'standard',
        crossFile: runtimeCaps[mode]?.crossFile ?? false,
      },
    }));
}

/** 清除模式配置缓存 */
export { clearCapabilitiesCache } from './mode-config.service';
export { getModeCapabilitiesConfig, saveModeCapabilitiesConfig } from './mode-config.service';
/** 重新导出 getModeScene（唯一实现在 types.ts） */
export { getModeScene } from './types';
