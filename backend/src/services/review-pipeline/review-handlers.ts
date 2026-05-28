/**
 * 审查模式处理器 — 替代原先的 Pipeline 子类体系
 *
 * 每个审查模式对应一个独立的处理函数，自包含其专属 AI 审查逻辑。
 * 文本提取等公共步骤由 ReviewService（两阶段编排层）统一完成，
 * handler 只关注"如何运行该模式的 AI 审查"。
 */

import { PipelineContext, ReviewModeType } from './types';
import { ReviewIssue, SourceReference } from '../llm.service';
import { AiReviewService } from './ai-review.service';
import { TerminologyService } from '../terminology.service';
import { StructuredConsistencyService } from '../structured-consistency.service';
import { getEffectiveConfig } from './pipeline-config';

/** 审查模式处理器签名 */
export type ReviewHandler = (ctx: PipelineContext) => Promise<{
  aiIssues: ReviewIssue[];
  sources?: SourceReference[];
  usedEngine?: string;
}>;

/** 模式到场景名的映射（用于加载提示词模板） */
const MODE_SCENE: Record<ReviewModeType, string> = {
  LIBRARY_REVIEW: 'library_review',
  CONSISTENCY:    'consistency',
  TYPO_GRAMMAR:   'typo_grammar',
  DOC_REVIEW:     'doc_review',
  MULTIMODAL:     'multimodal',
  RULE_ONLY:      'library_review',
  SELF_CHECK:     'self_check',
};

/** 各模式的显示名称与描述 */
const MODE_META: Record<ReviewModeType, { displayName: string; description: string; needsRefFiles: boolean }> = {
  LIBRARY_REVIEW: { displayName: '以库审文', description: '使用标准库+规则引擎+AI进行合规审查', needsRefFiles: false },
  CONSISTENCY:    { displayName: '全文一致性', description: '单文件内一致性检查 + 跨文件参数一致性检查', needsRefFiles: false },
  TYPO_GRAMMAR:   { displayName: '基础校对', description: '文字质量审查（错别字/语法/通顺性/术语一致性等，跳过RAG，直接LLM）', needsRefFiles: false },
  DOC_REVIEW:     { displayName: '以文审文', description: '使用上游参照文件与待审文件进行比对审查', needsRefFiles: true },
  MULTIMODAL:     { displayName: '结构化审查', description: '表格数据/数值/公式/图纸标注的结构化审查', needsRefFiles: false },
  RULE_ONLY:      { displayName: '仅规则审查', description: '仅执行预定义规则引擎检查，不调用 AI，速度最快', needsRefFiles: false },
  SELF_CHECK:     { displayName: '标准引用自检', description: '提取文档中的标准引用并与标准库机械匹配', needsRefFiles: false },
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

  const scene = ctx.scene || MODE_SCENE.TYPO_GRAMMAR;
  const config = getEffectiveConfig(ctx);
  const result = await AiReviewService.runLLMOnlyStrategy(text, ctx, scene, config);
  result.issues = await TerminologyService.filterTerminologyIssues(text, result.issues);
  return { aiIssues: result.issues, usedEngine: result.engine, sources: result.sources };
};

/**
 * LIBRARY_REVIEW — 以库审文（标准合规审查）
 * 双轨并行：知识库 RAG + 语义规范库逐条匹配，结果去重合并。
 */
const handleLibraryReview: ReviewHandler = async (ctx) => {
  const text = ctx.extractedText || '';
  if (!text.trim()) return { aiIssues: [], usedEngine: 'none' };

  const scene = ctx.scene || MODE_SCENE.LIBRARY_REVIEW;
  const config = getEffectiveConfig(ctx);
  const hasKnowledge = ctx.ruleSource?.includes('STANDARD')
    && (ctx.knowledgeCategoryIds?.length || ctx.knowledgeCategoryId);
  const hasSemanticSpec = ctx.semanticItems && ctx.semanticItems.length > 0;

  if (hasKnowledge && hasSemanticSpec) {
    console.log(`[Handler] 双轨审查: 知识库RAG + 语义规范库(${ctx.semanticItems!.length}条)`);
    const [ragResult, specResult] = await Promise.all([
      AiReviewService.runAIReview(text, ctx, scene, config),
      AiReviewService.runSemanticSpecReview(text, ctx, config),
    ]);
    const mergedIssues = [...ragResult.issues];
    const ragKeys = new Set(ragResult.issues.map(i => (i.originalText || '').slice(0, 60).trim()));
    for (const issue of specResult.issues) {
      const key = (issue.originalText || '').slice(0, 60).trim();
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
    const scene = ctx.scene || MODE_SCENE.CONSISTENCY;
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

  const scene = ctx.scene || MODE_SCENE.DOC_REVIEW;
  const config = getEffectiveConfig(ctx);
  const result = await AiReviewService.runRefCompareStrategy(text, ctx, scene, config);
  return { aiIssues: result.issues, usedEngine: result.engine, sources: result.sources };
};

/**
 * MULTIMODAL — 结构化审查
 * 直接调用 LLM，对表格数据/数值/公式/图纸标注进行结构化审查。
 * 注意：表格/公式的规则级检测已在阶段1完成，此处只做 AI 审查。
 */
const handleMultimodal: ReviewHandler = async (ctx) => {
  const text = ctx.extractedText || '';
  if (!text.trim()) return { aiIssues: [], usedEngine: 'none' };

  const scene = ctx.scene || MODE_SCENE.MULTIMODAL;
  const config = getEffectiveConfig(ctx);
  const result = await AiReviewService.runLLMDirect(text, ctx, scene, config);
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
  // SELF_CHECK 不走 handler 映射表，有独立的 SelfCheckController 处理
  SELF_CHECK:     async (_ctx) => {
    console.warn('[Handler] SELF_CHECK 被 processTask 误调用，请使用独立的 /api/self-check/run 端点');
    return { aiIssues: [], usedEngine: 'self_check' };
  },
  MULTIMODAL:     handleMultimodal,
};

/** 获取模式显示名称 */
export function getModeDisplayName(mode: ReviewModeType): string {
  return MODE_META[mode]?.displayName || mode;
}

/** 获取模式场景名 */
export function getModeScene(mode: ReviewModeType): string {
  return MODE_SCENE[mode] || 'library_review';
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
