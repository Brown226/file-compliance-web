/**
 * DocReviewAgentService — 以文审文条目级对齐 Agent（二期 B）
 *
 * 治本改造 runRefCompareStrategy 的"单跳逐项比对"漏判问题：
 * 把「整块待审文本 + 检索参照 → LLM 自行对齐」改为「条目抽取 → 逐条对齐」两步。
 *
 * 流程：
 *   Step 1 条目抽取：解析参照文件 → LLM 抽"审查条目清单"
 *           每条：{ itemId, topic, requirement, refQuote }
 *           （参照文件过长时按 Embedding 切块，分批抽取后合并去重）
 *   Step 2 逐条对齐（for each 条目）：
 *           ① 用条目 topic/requirement 在待审文件做 Embedding 相似定位 → candidate 段落
 *           ② 判定：reviewText(条目 + candidate) → issue
 *              一致 / 冲突(含差异) / 缺失 / 表述不同但等效
 *           ③ issue.ruleCode = itemId，issue.standardRef = 条目出处，
 *             sourceReferences 绑定该条目 refQuote
 *   Step 3 自检（路线 C）：LLM 判定"一致"但 Embedding 相似度 < 阈值
 *           且条目含数值/日期 → 二次复核（更严格 prompt 重判）
 *           → 仍不一致则标记"需人工确认"（severity 提升 + recommendation 说明）
 *
 * 降级：任一步骤失败 → 回退调用方（review-handlers）的旧 runRefCompareStrategy，
 *       保证审查可用性优先。
 *
 * 复用：EmbeddingService（定位）、LlmService.chat（条目抽取）、
 *       LlmService.reviewText（对齐判定，复用响应解析/保真校验）、
 *       LlmService.splitText、dedupIssues（去重）。
 */

import { LlmService, ReviewIssue } from '../llm/llm.service';
import { EmbeddingService } from '../knowledge/embedding.service';
import { dedupIssues } from '../../utils/issue-dedup';
import { getChunkConcurrency } from '../../utils/system-config';

/** 对齐判定状态 */
export type AlignStatus = 'matched' | 'mismatched' | 'missing' | 'equivalent';

/** 审查条目（Step 1 抽取结果） */
export interface ReviewItem {
  itemId: string;       // 条目 ID（如 ITEM_001）
  topic: string;        // 主题（如"付款期限"）
  requirement: string;  // 要求（如"应在验收后30日内支付"）
  refQuote: string;     // 参照文件原文片段
  refSource?: string;   // 条目出处（参照文件名）
}

/** 条目抽取的 LLM 返回（JSON 数组） */
interface ExtractItemsResult {
  items: Array<Partial<ReviewItem>>;
}

/** 单条目对齐结果（Step 2 产出 issue + 相似度，供 Step 3 自检） */
interface AlignResult {
  issue: ReviewIssue | null;
  similarity: number;
  candidateFound: boolean;
}

// ==================== Prompt 常量（DB 模板缺失时的 fallback） ====================

const EXTRACT_ITEMS_SYSTEM =
  '你是文档条目抽取专家。给定一份参照文件（权威基准），抽取其中"可用于审查待审文件"的约束性条目。' +
  '只抽取可核对的硬性要求（数值、期限、材料、流程、必含要素等），不抽描述性文字。' +
  '输出严格的 JSON 对象：{"items":[{"itemId":"ITEM_001","topic":"主题短语","requirement":"完整要求描述","refQuote":"参照文件原文片段"}]}。' +
  'itemId 从 ITEM_001 递增；topic 简短；requirement 完整保留约束；refQuote 是参照原文中该条目的原话。' +
  '最多输出 20 条。若无硬性要求则输出 {"items":[]}。';

const ALIGN_ITEM_SYSTEM =
  '你是文件一致性审查专家。给定一条参照要求（权威基准）和待审文件的相关段落，' +
  '判定待审文件是否满足该要求。' +
  '输出 JSON 数组，每条问题：{"issueType":"CONSISTENCY|COMPLETENESS|VIOLATION","originalText":"待审文件中对应原文","description":"差异说明","severity":"error|warning|info","status":"matched|mismatched|missing","suggestedText":"如需修改的建议"}' +
  '规则：' +
  '1. 待审内容与要求一致 → status=matched，不作为问题（返回空数组或 status=matched 的条目）' +
  '2. 待审内容与要求冲突（数值/期限/材料不符）→ status=mismatched，issueType=CONSISTENCY，severity=error' +
  '3. 待审文件完全缺失该要素 → status=missing，issueType=COMPLETENESS，severity=warning' +
  '4. 表述不同但要求实质一致 → status=matched（不报）' +
  '5. originalText 必须从待审段落中原文摘录，不得编造；缺失场景 originalText 可为空，description 说明缺什么。';

/** 二次复核 system（Step 3 自检 C，更严格） */
const ALIGN_RECHECK_SYSTEM =
  '你是文件一致性复审专家。某条目含数值/日期类要求，初次判定为"一致"，但检索相似度偏低，需要复核。' +
  '请仔细核对待审段落中的具体数值/日期与要求是否完全一致。' +
  '输出 JSON 数组，规则同上（status=matched/mismatched/missing）。' +
  '若数值/日期确实一致 → 输出空数组或 status=matched；' +
  '若有出入（如 30日 vs 90日）→ status=mismatched，severity=error，description 明确指出差异数值。';

// ==================== Step 1：条目抽取 ====================

/**
 * 从参照文本抽取审查条目清单
 * 参照过长时按 Embedding 切块分批抽取，合并去重（按 topic+requirement 归一化）。
 */
async function extractItems(
  refTexts: Array<{ fileName: string; content: string }>,
  config: { llmMaxTokens?: number; llmTimeout?: number; taskId?: string; mode?: string; traceId?: string },
): Promise<ReviewItem[]> {
  const allItems: ReviewItem[] = [];
  const llmMaxTokens = config.llmMaxTokens || 4096;
  const llmTimeout = config.llmTimeout || 180;

  for (const ref of refTexts) {
    const content = ref.content;
    // 参照文本过长时切块（每块约 8000 字符，条目抽取本身不需要极细粒度）
    const chunks = LlmService.splitText(content, 8000, false) as string[];

    for (const chunk of chunks) {
      try {
        const userContent =
          '## 参照文件（权威基准）\n' +
          `【文件：${ref.fileName}】\n${chunk}\n\n` +
          '请抽取其中可用于审查待审文件的约束性条目。';
        const raw = await LlmService.chat(userContent, {
          systemPrompt: EXTRACT_ITEMS_SYSTEM,
          maxTokens: llmMaxTokens,
          timeout: llmTimeout,
          taskId: config.taskId,
          mode: config.mode,
          traceId: config.traceId,
        });
        const parsed = parseExtractItems(raw);
        for (const it of parsed.items) {
          if (!it.itemId || !it.topic || !it.requirement) continue;
          allItems.push({
            itemId: it.itemId,
            topic: String(it.topic).slice(0, 80),
            requirement: String(it.requirement).slice(0, 600),
            refQuote: String(it.refQuote || '').slice(0, 500),
            refSource: ref.fileName,
          });
        }
      } catch (e: any) {
        console.warn(`[DocReviewAgent] 条目抽取失败（块 ${chunk.slice(0, 30)}...）: ${e.message}`);
      }
    }
  }

  // 去重：按 topic+requirement 归一化去重（避免切块边界重复抽取）
  const seen = new Set<string>();
  const deduped = allItems.filter(it => {
    const key = `${it.topic}|${it.requirement.replace(/\s+/g, '')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.slice(0, 50);
}

/** 解析条目抽取的 LLM 响应（容错 JSON 提取） */
function parseExtractItems(raw: string): ExtractItemsResult {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { items: [] };
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return { items };
  } catch {
    // 尝试数组形式
    const arrMatch = raw.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try {
        const arr = JSON.parse(arrMatch[0]);
        if (Array.isArray(arr)) return { items: arr };
      } catch { /* ignore */ }
    }
    return { items: [] };
  }
}

// ==================== Step 2：逐条对齐 ====================

/** 逐条对齐的全局预算（跨条目共享，防单任务 LLM 调用无封顶） */
interface AlignBudget {
  /** 剩余二次复核（recheck）次数上限 */
  recheckRemaining: number;
}

/**
 * 对单条目，在待审文本中 Embedding 定位相关段落，然后判定。
 * @returns issue（可能为 null：一致/等效不报）
 */
async function alignItem(
  item: ReviewItem,
  targetText: string,
  targetChunks: Array<{ text: string; startIndex: number }>,
  targetVectors: number[][] | null,
  ctx: { fileId?: string; taskId?: string; mode?: string; traceId?: string },
  config: { llmMaxTokens?: number; llmTimeout?: number },
  /** true 表示预嵌入已失败过，逐条目不再重试全量嵌入（防 embedding 服务持续故障时每条目浪费一次调用） */
  skipEmbedRetry = false,
  /** 共享预算：recheck 次数封顶 */
  budget?: AlignBudget,
): Promise<AlignResult> {
  const llmMaxTokens = config.llmMaxTokens || 4096;
  const llmTimeout = config.llmTimeout || 180;

  // ① 用条目 topic+requirement 做查询向量
  const queryText = `${item.topic} ${item.requirement}`;
  let queryVec: number[] | null = null;
  let targetVecs: number[][] | null = targetVectors;
  try {
    queryVec = await EmbeddingService.embedText(queryText);
    if (!targetVecs && !skipEmbedRetry) {
      targetVecs = await EmbeddingService.embedTexts(targetChunks.map(c => c.text));
    }
  } catch (e: any) {
    console.warn(`[DocReviewAgent] 条目 ${item.itemId} 嵌入失败: ${e.message}，退化为整文本判定`);
  }

  // ② 定位最相关分片
  let candidateText: string;
  let similarity = 0;
  let candidateFound = false;

  if (queryVec && targetVecs) {
    const scored = targetChunks.map((c, i) => ({
      chunk: c,
      sim: cosineSimilarity(queryVec!, targetVecs![i]),
    }));
    scored.sort((a, b) => b.sim - a.sim);
    const top = scored[0];
    if (top && top.sim > 0.1) {
      similarity = top.sim;
      candidateFound = true;
      // 取 top-3 拼入候选，让判定有上下文
      const top3 = scored.slice(0, Math.min(3, scored.length)).map(s => s.chunk.text);
      candidateText = top3.join('\n...\n');
    } else {
      candidateText = targetText.slice(0, 3000);
    }
  } else {
    // embedding 失败：退化用前若干字符
    candidateText = targetText.slice(0, 3000);
  }

  // ③ 判定
  const userContent =
    `## 参照要求（权威基准）\n` +
    `条目：${item.topic}\n要求：${item.requirement}\n` +
    (item.refQuote ? `参照原文：${item.refQuote}\n` : '') +
    `\n---\n## 待审文件相关段落\n${candidateText}\n\n` +
    '请判定待审文件是否满足该要求。';

  const issues = await LlmService.reviewText(userContent, {
    maxTokens: llmMaxTokens,
    timeout: llmTimeout,
    systemPrompt: ALIGN_ITEM_SYSTEM,
    skipUserTemplate: true,
    documentId: ctx.fileId,
    taskId: ctx.taskId,
    mode: ctx.mode,
    traceId: ctx.traceId,
  });

  // ④ 产出 issue：绑定条目元数据
  let issue: ReviewIssue | null = null;
  for (const it of issues) {
    if (it.status === 'matched') continue; // 一致/等效不报
    issue = {
      ...it,
      ruleCode: item.itemId,
      standardRef: item.refQuote ? `${item.refSource || '参照文件'} · ${item.topic}` : item.topic,
      sourceReferences: item.refQuote
        ? [{ content: item.refQuote, document_name: item.refSource || '参照文件', similarity }]
        : undefined,
      refSource: item.refSource,
    };
    break;
  }

  // ⑤ 自检（Step 3，路线 C）：判定"一致/无 issue"但相似度低且含数值/日期 → 二次复核
  //    预算保护：recheck 次数全任务封顶（原实现 50 条目 × 每次 180s 超时无上限）
  if (!issue && similarity > 0 && similarity < 0.55 && hasNumericOrDate(item.requirement)) {
    if (budget && budget.recheckRemaining > 0) {
      budget.recheckRemaining -= 1;
      issue = await recheckItem(item, candidateText, ctx, config, similarity);
    }
  }

  return { issue, similarity, candidateFound };
}

/** 判定文本是否含数值/日期类约束（用于触发二次复核） */
function hasNumericOrDate(text: string): boolean {
  return /\d/.test(text) || /日|月|年|天|小时|分钟/.test(text);
}

/** Step 3 自检 C：更严格二次复核 */
async function recheckItem(
  item: ReviewItem,
  candidateText: string,
  ctx: { fileId?: string; taskId?: string; mode?: string; traceId?: string },
  config: { llmMaxTokens?: number; llmTimeout?: number },
  similarity: number,
): Promise<ReviewIssue | null> {
  const llmMaxTokens = config.llmMaxTokens || 4096;
  const llmTimeout = config.llmTimeout || 180;
  try {
    const userContent =
      `## 参照要求（权威基准）\n条目：${item.topic}\n要求：${item.requirement}\n` +
      `\n---\n## 待审文件相关段落\n${candidateText}\n\n` +
      '请仔细核对数值/日期是否完全一致。';

    const issues = await LlmService.reviewText(userContent, {
      maxTokens: llmMaxTokens,
      timeout: llmTimeout,
      systemPrompt: ALIGN_RECHECK_SYSTEM,
      skipUserTemplate: true,
      documentId: ctx.fileId,
      taskId: ctx.taskId,
      mode: ctx.mode,
      traceId: ctx.traceId,
    });
    for (const it of issues) {
      if (it.status === 'matched') continue;
      return {
        ...it,
        ruleCode: item.itemId,
        standardRef: `${item.refSource || '参照文件'} · ${item.topic}`,
        sourceReferences: item.refQuote
          ? [{ content: item.refQuote, document_name: item.refSource || '参照文件', similarity }]
          : undefined,
        refSource: item.refSource,
        // 二次复核仍不一致 → 标"需人工确认"
        severity: it.severity || 'warning',
        description: `【需人工确认】${it.description || '数值/日期疑似不一致'}`,
      };
    }
  } catch (e: any) {
    console.warn(`[DocReviewAgent] 条目 ${item.itemId} 二次复核失败: ${e.message}`);
  }
  return null;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ==================== 主入口 ====================

/**
 * 以文审文条目级对齐 Agent 主入口
 * @param targetText 待审文件全文
 * @param refTexts 参照文件内容列表
 * @param ctx 可观测性上下文
 * @param config 配置
 * @returns issues（条目级对齐结果）+ stats
 */
export async function runRefCompareAgent(
  targetText: string,
  refTexts: Array<{ fileName: string; content: string }>,
  ctx: { fileId?: string; taskId?: string; mode?: string; traceId?: string },
  config: { llmMaxTokens?: number; llmTimeout?: number },
): Promise<{ issues: ReviewIssue[]; engine: string; itemCount: number; alignedCount: number; degraded?: boolean; degradedReason?: string }> {
  // Step 1：条目抽取
  const items = await extractItems(refTexts, { ...config, taskId: ctx.taskId, mode: ctx.mode, traceId: ctx.traceId });
  if (items.length === 0) {
    return {
      issues: [],
      engine: 'doc-review-agent',
      itemCount: 0,
      alignedCount: 0,
      degraded: true,
      degradedReason: '条目抽取为空（参照文件无约束性要求或抽取失败）',
    };
  }

  // 预分块待审文本 + 预嵌入（避免每条目重复嵌入）
  const chunks = (LlmService.splitText(targetText, 4000, true, 300) as Array<{ text: string; startIndex: number }>);
  let targetVectors: number[][] | null = null;
  let embedFailed = false;
  try {
    targetVectors = await EmbeddingService.embedTexts(chunks.map(c => c.text));
  } catch (e: any) {
    embedFailed = true;
    console.warn(`[DocReviewAgent] 待审文本预嵌入失败（逐条目退化，不再重试全量嵌入）: ${e.message}`);
  }

  // 全任务预算：recheck 最多 20 次（每次 LLM 调用 180s 超时，封顶总时长）
  const budget: AlignBudget = { recheckRemaining: 20 };

  // Step 2：逐条对齐（限并发）
  const CONCURRENT_LIMIT = await getChunkConcurrency('doc_review');
  const results = await parallelLimit(items, CONCURRENT_LIMIT, (item) =>
    alignItem(item, targetText, chunks, targetVectors, ctx, config, embedFailed, budget),
  );

  // 收集 issues
  const issues: ReviewIssue[] = [];
  for (const r of results) {
    // parallelLimit 单条失败会写入 null：跳过而非解引用崩溃，保住其余已审结果
    if (!r) continue;
    if (r.issue) issues.push(r.issue);
  }
  const deduped = dedupIssues(issues);

  // P0-D2 修复：统计对齐失败条目数，全部失败且零产出时标记 degraded，
  // 让 handler 能降级到旧策略（此前抽取成功但对齐全失败会静默返回空结果，
  // 用户看到"无问题"而实际是审查过程失败）。
  const failedCount = results.filter(r => !r).length;
  const allFailed = failedCount > 0 && failedCount === items.length;

  return {
    issues: deduped,
    engine: 'doc-review-agent',
    itemCount: items.length,
    alignedCount: results.filter(r => r && r.candidateFound).length,
    ...(allFailed && deduped.length === 0
      ? { degraded: true, degradedReason: `条目对齐全部失败（${failedCount}/${items.length} 条失败），无可用结果` }
      : {}),
  };
}

/** 简易并发限制（复用 parallelLimit 语义，避免额外依赖） */
async function parallelLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try {
        results[i] = await fn(items[i]);
      } catch (e: any) {
        console.warn(`[DocReviewAgent] 条目对齐失败: ${e.message}`);
        results[i] = null as unknown as R;
      }
    }
  });
  await Promise.all(workers);
  return results;
}
