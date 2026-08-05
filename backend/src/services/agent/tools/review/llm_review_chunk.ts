/**
 * llm_review_chunk 工具 — 对文本片段执行 LLM 审查
 *
 * 工作流：
 * 1. 确定 module：mode || 'doc_review'（默认用 doc_review 模板）
 * 2. 通过 PromptLoader.resolve 加载 system 模板（DB → Registry → 兜底）
 * 3. 如果有 focus，在 systemPrompt 末尾追加「当前审查关注点」段
 * 4. 如果有 context（如 RAG 检索结果），在 systemPrompt 末尾追加「参考知识」段 + standardRef 约束
 *    （无 context 时不追加约束，避免 LLM 编造条文引用）
 * 5. 调 LlmService.reviewText(text, { systemPrompt, mode, skipUserTemplate: true })
 *    skipUserTemplate=true 表示调用方已自行组装 user 内容（直接用 text）
 * 6. 后处理：ruleCode 存在但 standardRef 为空的 issue，用 search_standard_checkpoints 反查审点库回填
 *    （查不到保持空，绝不覆盖 LLM 已填的 standardRef）
 * 7. 返回 ReviewIssue[]
 *
 * 注意：结果去重（同一问题跨 chunk 只上报一次）由 P1-⑫ 工具钩子完成——
 * register-tool-hooks.ts 注册的 afterToolCall 钩子对 llm_review_chunk 结果
 * 经 issue-dedup 过滤，本工具内部不重复去重（保持工具职责单一）。
 *
 * 注意：工具场景下没有完整 PipelineContext，不能用 AiReviewService.injectSemanticContext
 * （它需要 taskId/fileId/extractedText 等完整字段），改为直接拼接 focus 到 systemPrompt。
 */

import { z } from 'zod';
import { PromptLoader } from '../../../prompts';
import { LlmService, type ReviewIssue } from '../../../llm/llm.service';
import type { ToolContext } from '../file/upload_file';
import { createSearchStandardCheckpointsTool } from '../knowledge/search_standard_checkpoints';
import FalsePositiveLibraryService from '../../../review/falsePositiveLibrary.service';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 系统提示词最终兜底（PromptLoader.resolve 的 fallback 参数） */
const SYSTEM_PROMPT_FALLBACK =
  '你是文件审查专家，请按规范输出问题列表。每个问题必须包含 issueType 和 originalText 字段，严格按照 JSON 数组格式输出。';

/**
 * 有参考知识（context）注入时的 standardRef 约束段。
 * 仅在 context 注入时追加：要求引用审点必须带 standardRef，且禁止编造条文；
 * 无 context 时不追加，避免 LLM 幻觉编造不存在的标准引用。
 */
const STANDARD_REF_CONSTRAINT =
  '\n\n## 审查依据要求\n' +
  '每个问题必须填写 standardRef 字段（审查依据的标准条文引用），格式为「标准编号 + 条文编号 + 标准名称」，' +
  '例如 "GB/T 50265-2010 第5.2.1条"。依据只能来自上方「参考知识」中的审点条文，禁止编造不存在的标准或条文；' +
  '若参考知识中没有对应条文，standardRef 可省略。';

/** search_standard_checkpoints 结果的最小类型（回填用，与工具实现字段保持一致） */
interface BackfillStandard {
  id: string;
  title: string;
  standardNo: string | null;
  standardName: string | null;
}

interface BackfillCheckpoint {
  id: string;
  clauseCode: string | null;
  clauseText: string;
}

type BackfillSearchResult =
  | { mode: 'list_standards'; standards: BackfillStandard[] }
  | { mode: 'list_checkpoints'; checkpoints: BackfillCheckpoint[] };

/**
 * standardRef 后处理回填（P1-⑦ 审查依据条文可解释）
 *
 * 对 ruleCode 存在但 standardRef 为空的 issue：
 * 1. 用 search_standard_checkpoints 列出现行标准
 * 2. 逐个标准按 ruleCode 关键词反查审点（clauseCode/clauseText/checkPrompt 模糊匹配）
 * 3. 优先 clauseCode 精确匹配的审点，拼装「标准编号 + 标准名称 + 第X条」回填
 * 4. 查不到保持空；**绝不覆盖 LLM 已填的 standardRef**
 *
 * 反查失败仅告警，不影响审查结果返回。
 */
export async function backfillStandardRefs(
  issues: ReviewIssue[],
  searchTool: ReturnType<typeof createSearchStandardCheckpointsTool>,
): Promise<ReviewIssue[]> {
  const missing = issues.filter((i) => !i.standardRef && i.ruleCode);
  if (missing.length === 0) return issues;

  try {
    // 1. 列出所有现行标准
    const listResult = (await searchTool.execute({ topNumber: 50 }, { toolCallId: "llm_review_backfill", messages: [], context: {} })) as BackfillSearchResult;
    if (listResult.mode !== 'list_standards' || listResult.standards.length === 0) {
      return issues;
    }

    // 2. 按 ruleCode 去重反查，找到即停（逐标准早退）
    const refByRuleCode = new Map<string, string | null>();
    for (const issue of missing) {
      const ruleCode = String(issue.ruleCode).trim();
      if (!ruleCode || refByRuleCode.has(ruleCode)) continue;

      let ref: string | null = null;
      for (const std of listResult.standards) {
        if (ref) break;
        const cpRes = (await searchTool.execute(
          {
            standardId: std.id,
            keyword: ruleCode,
            topNumber: 50,
          },
          { toolCallId: "llm_review_backfill", messages: [], context: {} },
        )) as BackfillSearchResult;
        if (cpRes.mode !== 'list_checkpoints' || cpRes.checkpoints.length === 0) continue;

        // 优先 clauseCode 精确匹配，其次取第一个模糊命中
        const lower = ruleCode.toLowerCase();
        const exact = cpRes.checkpoints.find(
          (cp) => cp.clauseCode && cp.clauseCode.trim().toLowerCase() === lower,
        );
        const hit = exact || cpRes.checkpoints[0];
        if (hit) {
          const stdNo = std.standardNo || '';
          const stdName = std.standardName || std.title || '';
          const clause = hit.clauseCode ? `第${hit.clauseCode}条` : '';
          ref = [stdNo, stdName, clause].filter(Boolean).join(' ');
        }
      }
      refByRuleCode.set(ruleCode, ref);
    }

    // 3. 回填（仅当仍为空，绝不覆盖）
    for (const issue of missing) {
      const ruleCode = String(issue.ruleCode).trim();
      const ref = refByRuleCode.get(ruleCode);
      if (ref && !issue.standardRef) {
        issue.standardRef = ref;
      }
    }
  } catch (e) {
    console.warn('[llm_review_chunk] standardRef 反查回填失败（不影响审查结果）:', e);
  }

  return issues;
}

/**
 * P2-⑧ 误报过滤 — 与 review-pipeline 行为一致
 *
 * 用误报库（falsePositiveLibrary）中的原文归一化集合过滤 LLM 产出的 issue：
 * - 一次 batchCheck 全量加载误报库到内存，归一化匹配（去空白标点/NFKC/小写）
 * - 与 review.service.ts 的 fpLibrarySet.has(normalizeText(issue.originalText)) 同一语义
 * - 误报库加载失败仅告警，不影响审查结果返回
 */
export async function filterFalsePositives(issues: ReviewIssue[]): Promise<ReviewIssue[]> {
  if (issues.length === 0) return issues;
  try {
    const texts = issues.map((i) => i.originalText || '');
    const fpMap = await FalsePositiveLibraryService.batchCheck(texts);
    const filtered = issues.filter((i) => !fpMap.get(i.originalText));
    const removed = issues.length - filtered.length;
    if (removed > 0) {
      console.log(`[llm_review_chunk] 误报库过滤 ${removed} 条 (${issues.length} → ${filtered.length})`);
    }
    return filtered;
  } catch (e) {
    console.warn('[llm_review_chunk] 误报库过滤失败（不影响审查结果）:', e);
    return issues;
  }
}

/**
 * P2-⑬ 行号定位补充 — 为 issue 生成 locateMeta
 *
 * 用待审查文本 text 与 issue.originalText 定位：
 * - 精确/归一化匹配文本区间（buildLocateMeta 内部处理 exact/trimmed/normalized）
 * - 优先用 lineHint 转成「行号」：原文本中绝对偏移 → 行号
 * - 命中则带 chunk.index；无 absolute 定位（如纯 CAD handle）时保留 fallback hint
 */
export function enrichLocateMeta(issues: ReviewIssue[], text: string): ReviewIssue[] {
  const lineStarts: number[] = [];
  {
    let idx = 0;
    lineStarts.push(0);
    while ((idx = text.indexOf('\n', idx)) !== -1) {
      idx += 1;
      lineStarts.push(idx);
    }
  }
  const offsetToLine = (off: number): number => {
    // 二分：最后一个 <= off 的行起点，行号 = 其索引 + 1
    let lo = 0;
    let hi = lineStarts.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid] <= off) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans + 1;
  };

  for (const issue of issues) {
    if (!issue.originalText) continue;
    const loc = LlmService.buildLocateMeta(text, issue.originalText, {});
    if (!loc) continue;
    if (loc.absolute) {
      const startLine = offsetToLine(loc.absolute.start);
      const endLine = offsetToLine(loc.absolute.end);
      loc.hint = loc.hint || {};
      loc.hint.lineHint = startLine;
      // 行号区间（起止行相同则只填 start）
      (loc.hint as any).lineHintEnd = endLine > startLine ? endLine : undefined;
    }
    issue.locateMeta = loc;
  }
  return issues;
}

/**
 * 创建 llm_review_chunk 工具
 *
 * 参数：
 * - text: 待审查文本
 * - focus: 审查关注点（如"条款一致性"、"金额规范"、"签字栏"）
 * - mode: 审查模式（如 contract_review / doc_review / consistency）
 * - context: 额外上下文（如知识库检索结果）
 */
export function createLlmReviewChunkTool(_context: ToolContext) {
  return tool({
    description: '对文本片段执行 LLM 审查。可指定 focus 聚焦特定维度（如条款一致性、金额规范、签字栏），可传入 context 作为参考知识。返回结构化的 ReviewIssue[] 数组。',
    inputSchema: z.object({
      text: z.string().describe('待审查的文本片段'),
      focus: z.string().optional().describe('审查关注点，如"条款一致性"、"金额规范"、"签字栏"'),
      mode: z.string().optional().describe('审查模式，如 contract_review / doc_review / consistency'),
      context: z.string().optional().describe('额外上下文，如相关知识库检索结果'),
    }),
    execute: async ({ text, focus, mode, context }): Promise<ReviewIssue[]> => {
      // 1. 确定 module（默认 doc_review）
      const module = mode || 'doc_review';

      // 2. 加载 system 模板（DB → Registry → 兜底）
      let systemPrompt = await PromptLoader.resolve(
        module,
        'system',
        'default',
        SYSTEM_PROMPT_FALLBACK,
      );

      // 3. 追加审查关注点（直接拼接到末尾，不用 injectSemanticContext）
      if (focus) {
        systemPrompt += `\n\n## 当前审查关注点\n请重点关注：${focus}`;
      }

      // 4. 追加参考知识（如 RAG 检索结果）+ standardRef 约束
      //    有 context（审点/知识库上下文）注入时，要求 issue 带 standardRef（条文编号+名称）；
      //    无 context 时不追加约束，避免 LLM 编造不存在的条文引用
      if (context) {
        systemPrompt += `\n\n## 参考知识\n${context}`;
        systemPrompt += STANDARD_REF_CONSTRAINT;
      }

      // 5. 调 LlmService.reviewText
      //    skipUserTemplate=true：直接用 text 作为 user content（调用方已自行组装）
      //    mode=module：用于 LlmCallLog 可观测性关联
      let issues = await LlmService.reviewText(text, {
        systemPrompt,
        mode: module,
        skipUserTemplate: true,
      });

      // 6. 后处理：ruleCode 存在但 standardRef 为空时，反查审点库回填（查不到保持空，不覆盖已有引用）
      const searchTool = createSearchStandardCheckpointsTool(_context);
      await backfillStandardRefs(issues, searchTool);

      // 7. 后处理：P2-⑧ 误报库过滤（与 review-pipeline 的 fpLibrarySet 归一化匹配同一语义）
      issues = await filterFalsePositives(issues);

      // 8. 后处理：P2-⑬ 为 issue 补充 locateMeta 行号定位（文本绝对偏移 → 行号）
      issues = enrichLocateMeta(issues, text);

      return issues;
    },
  });
}
